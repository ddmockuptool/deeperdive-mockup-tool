#!/usr/bin/env node
/**
 * Load a URL in headless Chrome, inject the DeeperDive widget below the og:image (or largest image),
 * strip common pop-ups/cookie walls, then save a PNG of the article region only (not the whole site).
 *
 * Usage:
 *   node capture.mjs --url https://www.example.com/article -o ./mock.png
 *   npm run serve   # then open http://127.0.0.1:3847
 */

import { mkdirSync } from "node:fs";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { waitUntilCmpResolvedAndSettled } from "./cmp-resolve.mjs";
import { buildWidgetMarkup } from "./widget.mjs";

const DEFAULT_VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 2 };

export function parseArgs(argv) {
	const out = {
		url: "",
		output: "page-with-widget.png",
		waitUntil: "networkidle2",
		timeout: 45_000,
		publication: "Daily Star",
	};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		const next = argv[i + 1];
		if (a === "--url" || a === "-u") {
			out.url = next ?? "";
			i++;
		} else if (a === "--out" || a === "-o") {
			out.output = next ?? out.output;
			i++;
		} else if (a === "--timeout" || a === "-t") {
			out.timeout = Number(next) || out.timeout;
			i++;
		} else if (a === "--wait" || a === "-w") {
			const w = next;
			if (w === "load" || w === "domcontentloaded" || w === "networkidle0" || w === "networkidle2") {
				out.waitUntil = w;
			}
			i++;
		} else if (a === "--publication" || a === "-p") {
			out.publication = next ?? out.publication;
			i++;
		} else if (a === "--help" || a === "-h") {
			console.log(`Usage: node capture.mjs --url <https://...> [--out file.png] [--wait networkidle2|domcontentloaded|load] [--timeout ms] [--publication "Daily Star"]

Captures the article region as PNG after the CMP/consent layer is gone and network has settled, then injects the widget below og:image (fallback: largest image).`);
			process.exit(0);
		}
	}
	return out;
}

function assertHttpUrl(urlString) {
	let u;
	try {
		u = new URL(urlString);
	} catch {
		throw new Error("Invalid URL");
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") {
		throw new Error("Only http(s) URLs are allowed");
	}
	return u.href;
}

/**
 * @param {{ url: string; outputPath: string; waitUntil: string; timeout: number; publication: string; widgetOptions?: object }} opts
 */
export async function capturePageToPng(opts) {
	const {
		url,
		outputPath,
		waitUntil,
		timeout,
		publication,
		cssSelector = "",
		widgetOptions = {},
	} = opts;

	const href = assertHttpUrl(url);
	const widgetHtml = buildWidgetMarkup({ publication, ...widgetOptions });

	const launchOpts = {
		headless: "new",
		timeout: 60_000,
		protocolTimeout: 90_000,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
			"--disable-gpu",
			"--no-first-run",
			"--no-zygote",
			"--disable-extensions",
		],
	};
	if (process.env.PUPPETEER_EXECUTABLE_PATH) {
		launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
	}

	let browser;
	try {
		browser = await puppeteer.launch(launchOpts);
	} catch (err) {
		throw new Error(`Chrome failed to start: ${err.message}`);
	}

	try {
		const page = await browser.newPage();
		await page.setViewport(DEFAULT_VIEWPORT);

		await page.goto(href, { waitUntil, timeout });
		await waitUntilCmpResolvedAndSettled(page);

	const placement = await page.evaluate((html, selectorOverride) => {
		const existing = document.querySelector("[data-deeperdive-mock]");
		if (existing) existing.remove();

		const tpl = document.createElement("template");
		tpl.innerHTML = html.trim();
		const node = tpl.content.firstElementChild;
		if (!node) return { ok: false, reason: "parse" };

		// If a CSS selector override was provided, insert above that element
		if (selectorOverride) {
			try {
				const target = document.querySelector(selectorOverride);
				if (target) {
					target.insertAdjacentElement("beforebegin", node);
					return { ok: true, placement: "before-selector", selector: selectorOverride };
				}
			} catch (e) {
				return { ok: false, reason: "invalid-selector", selector: selectorOverride, message: e.message };
			}
			return { ok: false, reason: "selector-not-found", selector: selectorOverride };
		}

		const paraSelectors = [
			'article [itemprop="articleBody"] p',
			'[itemprop="articleBody"] p',
			"article .article-body p",
			"article .post-content p",
			"article .entry-content p",
			"article p",
			'[role="article"] p',
			".article-body p",
			".post-content p",
			".entry-content p",
			"#mw-content-text p",
			"main p",
		];

		const NON_BODY_CONTAINERS = [
			"figure", "figcaption", "aside", "footer", "nav",
			"blockquote", "form", "table",
			'[class*="caption"]', '[class*="credit"]',
			'[class*="byline"]', '[class*="author"]',
			'[class*="tag"]', '[class*="related"]',
			'[class*="comment"]', '[class*="share"]',
			'[class*="newsletter"]', '[class*="signup"]',
			'[class*="header"]', '[class*="dek"]',
			'[class*="standfirst"]', '[class*="subtitle"]',
			'[class*="summary"]', '[class*="excerpt"]',
			'[class*="teaser"]', '[class*="promo"]',
			'[class*="meta"]', '[class*="timestamp"]',
		].join(", ");

		function isBodyParagraph(el) {
			const st = window.getComputedStyle(el);
			if (st.display === "none" || st.visibility === "hidden") return false;
			const r = el.getBoundingClientRect();
			if (r.height < 10 || r.width < 100) return false;
			if ((el.textContent || "").trim().length < 50) return false;
			if (el.closest(NON_BODY_CONTAINERS)) return false;
			return true;
		}

		// Find the first visible body-text paragraph
		let firstPara = null;
		for (const sel of paraSelectors) {
			const els = document.querySelectorAll(sel);
			for (const el of els) {
				if (!isBodyParagraph(el)) continue;
				firstPara = el;
				break;
			}
			if (firstPara) break;
		}

		if (firstPara) {
			firstPara.insertAdjacentElement("beforebegin", node);
			return { ok: true, placement: "before-first-paragraph" };
		}

		const main =
			document.querySelector("article") ||
			document.querySelector("main") ||
			document.querySelector('[role="main"]') ||
			document.body;
		main.insertBefore(node, main.firstChild);
		return { ok: true, placement: "fallback-top-of-article" };
	}, widgetHtml, cssSelector || "");

		if (!placement?.ok) {
			if (placement?.reason === "invalid-selector") {
				throw new Error(`Invalid CSS selector "${placement.selector}": ${placement.message}`);
			}
			if (placement?.reason === "selector-not-found") {
				throw new Error(`No element matched the selector "${placement.selector}" on this page`);
			}
			throw new Error("Failed to parse widget markup");
		}

		await page.evaluate(() => {
		const widget = document.querySelector("[data-deeperdive-mock]");
		if (!widget) return;

		const selectors = [
			'article [itemprop="articleBody"] p',
			'[itemprop="articleBody"] p',
			"article .article-body p",
			"article .post-content p",
			"article .entry-content p",
			"article p",
			'[role="article"] p',
			".article-body p",
			".post-content p",
			".entry-content p",
			"#mw-content-text p",
			"main p",
		];

		const NON_BODY_CONTAINERS = [
			"figure", "figcaption", "aside", "footer", "nav",
			"blockquote", "form", "table",
			'[class*="caption"]', '[class*="credit"]',
			'[class*="byline"]', '[class*="author"]',
			'[class*="tag"]', '[class*="related"]',
			'[class*="comment"]', '[class*="share"]',
			'[class*="newsletter"]', '[class*="signup"]',
			'[class*="header"]', '[class*="dek"]',
			'[class*="standfirst"]', '[class*="subtitle"]',
			'[class*="summary"]', '[class*="excerpt"]',
			'[class*="teaser"]', '[class*="promo"]',
			'[class*="meta"]', '[class*="timestamp"]',
		].join(", ");

		// Collect all visible body-text paragraphs (skip captions,
		// bylines, credits, headers, asides, figures, etc.)
		let fontRef = null;
		const widthBuckets = {};

		for (const sel of selectors) {
			try {
				for (const el of document.querySelectorAll(sel)) {
					if (el.closest("[data-deeperdive-mock]")) continue;
					const st = window.getComputedStyle(el);
					if (st.display === "none" || st.visibility === "hidden") continue;
					const r = el.getBoundingClientRect();
					if (r.height < 10 || r.width < 100) continue;
					if ((el.textContent || "").trim().length < 50) continue;
					if (el.closest(NON_BODY_CONTAINERS)) continue;

					if (!fontRef) fontRef = el;

					// Bucket widths (rounded to 10px) to find the
					// most common body-text column width
					const bucket = Math.round(r.width / 10) * 10;
					if (!widthBuckets[bucket]) widthBuckets[bucket] = { count: 0, width: r.width, el };
					widthBuckets[bucket].count++;
				}
			} catch {}
		}

		// The body-text column is the most common width
		let widestEl = null;
		let bestCount = 0;
		for (const b of Object.values(widthBuckets)) {
			if (b.count > bestCount) { bestCount = b.count; widestEl = b.el; }
		}

		const ref = fontRef || widestEl;
		if (!ref) return;

		const st = window.getComputedStyle(ref);
		const family = st.fontFamily;
		const size = st.fontSize;
		const basePx = Number.parseFloat(size);

		const rules = [];
		const titlePx = basePx ? (basePx * 1.15).toFixed(1) : null;

		const contentSelectors = [
			".dd-mock-title",
			".dd-mock-summary",
			".dd-mock-link-row",
			".dd-mock-link-text",
			".dd-mock-interests-label",
			".dd-mock-chevron",
		];

		if (family) {
			for (const sel of contentSelectors) {
				rules.push(`${sel} { font-family: ${family} !important; }`);
			}
		}
		if (basePx >= 8 && basePx <= 40) {
			rules.push(`.dd-mock-title { font-size: ${titlePx}px !important; }`);
			for (const sel of contentSelectors.filter(s => s !== ".dd-mock-title")) {
				rules.push(`${sel} { font-size: ${basePx}px !important; }`);
			}
		}

		// Constrain widget width to the widest body text paragraph
		const bodyWidth = widestEl ? widestEl.getBoundingClientRect().width : 0;
		if (bodyWidth >= 200) {
			rules.push(`.dd-mock-root { max-width: ${Math.round(bodyWidth)}px !important; }`);
		}

		// Match the article body background color
		let bgColor = null;
		let el = ref;
		while (el && el !== document.documentElement) {
			const bg = window.getComputedStyle(el).backgroundColor;
			if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
				bgColor = bg;
				break;
			}
			el = el.parentElement;
		}
		if (bgColor) {
			rules.push(`.dd-mock-card { background: ${bgColor} !important; }`);
			rules.push(`.dd-mock-bar { background: ${bgColor} !important; }`);
			rules.push(`.dd-mock-summary::after { background: linear-gradient(to right, rgba(255,255,255,0), ${bgColor} 65%) !important; }`);
		}

		if (rules.length > 0) {
			const style = document.createElement("style");
			style.textContent = rules.join("\n");
			widget.prepend(style);
		}
	});

		// ── Extract publisher brand color from logo ──
		await page.evaluate(() => {
			const widget = document.querySelector("[data-deeperdive-mock]");
			if (!widget) return;

			function parseColor(str) {
				if (!str) return null;
				str = str.trim();
				const hexMatch = str.match(/^#([0-9a-f]{3,8})$/i);
				if (hexMatch) {
					let hex = hexMatch[1];
					if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
					return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
				}
				const rgbMatch = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
				if (rgbMatch) return [+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]];
				return null;
			}

			function isViable(r,g,b) {
				const max = Math.max(r,g,b), min = Math.min(r,g,b);
				if (min > 210) return false; // near-white
				if (max < 40) return false;  // near-black
				if (max - min < 25) return false; // gray / low saturation
				return true;
			}

			function firstViableBg(el) {
				while (el && el !== document.documentElement) {
					const bg = window.getComputedStyle(el).backgroundColor;
					const c = parseColor(bg);
					if (c && isViable(...c)) return c;
					el = el.parentElement;
				}
				return null;
			}

			function applyBrandColor(color) {
				const s = widget.querySelector("style") || document.createElement("style");
				s.textContent += `\n.dd-mock-readmore { background: ${color} !important; }`;
				s.textContent += `\n.dd-mock-submit { background: ${color} !important; }`;
				if (!s.parentElement) widget.prepend(s);
			}

			// 1. <meta name="theme-color">
			const meta = document.querySelector('meta[name="theme-color"]');
			if (meta) {
				const c = parseColor(meta.getAttribute("content"));
				if (c && isViable(...c)) {
					applyBrandColor(`rgb(${c[0]},${c[1]},${c[2]})`);
					return;
				}
			}

			// 2. Logo image — extract dominant color via canvas
			const logoImgSelectors = [
				'header [class*="logo"] img', 'nav [class*="logo"] img',
				'[class*="logo"] img', '[id*="logo"] img',
				'header a > img', 'a[class*="logo"] img', 'a[href="/"] img',
				'header img[alt*="logo" i]', 'img[class*="logo"]', 'img[id*="logo"]',
			];
			let logoImg = null;
			for (const sel of logoImgSelectors) {
				try {
					const el = document.querySelector(sel);
					if (el && el.naturalWidth > 0 && el.complete) { logoImg = el; break; }
				} catch {}
			}
			if (logoImg) {
				try {
					const canvas = document.createElement("canvas");
					const size = 64;
					canvas.width = size; canvas.height = size;
					const ctx = canvas.getContext("2d");
					ctx.drawImage(logoImg, 0, 0, size, size);
					const data = ctx.getImageData(0, 0, size, size).data;
					const buckets = {};
					for (let i = 0; i < data.length; i += 4) {
						const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
						if (a < 128) continue;
						if (!isViable(r,g,b)) continue;
						const qr = (r >> 4) << 4, qg = (g >> 4) << 4, qb = (b >> 4) << 4;
						const key = `${qr},${qg},${qb}`;
						buckets[key] = (buckets[key] || 0) + 1;
					}
					let best = null, bestCount = 0;
					for (const [key, count] of Object.entries(buckets)) {
						if (count > bestCount) { bestCount = count; best = key; }
					}
					if (best && bestCount >= 5) {
						applyBrandColor(`rgb(${best})`);
						return;
					}
				} catch {}
			}

			// 3. SVG logo — check fill attributes, then background behind it
			const svgSelectors = [
				'header [class*="logo"] svg', 'nav [class*="logo"] svg',
				'[class*="logo"] svg', 'a[href="/"] svg',
			];
			for (const sel of svgSelectors) {
				try {
					const svg = document.querySelector(sel);
					if (!svg) continue;
					for (const f of svg.querySelectorAll("[fill]")) {
						const c = parseColor(f.getAttribute("fill"));
						if (c && isViable(...c)) {
							applyBrandColor(`rgb(${c[0]},${c[1]},${c[2]})`);
							return;
						}
					}
					// SVG is white/transparent — the brand color is the background behind it
					const bg = firstViableBg(svg);
					if (bg) {
						applyBrandColor(`rgb(${bg[0]},${bg[1]},${bg[2]})`);
						return;
					}
				} catch {}
			}

			// 4. Header/nav background color
			for (const sel of ["header", "nav", '[class*="masthead"]', '[class*="subnav"]', '[class*="topbar"]']) {
				try {
					const el = document.querySelector(sel);
					if (!el) continue;
					const c = parseColor(window.getComputedStyle(el).backgroundColor);
					if (c && isViable(...c)) {
						applyBrandColor(`rgb(${c[0]},${c[1]},${c[2]})`);
						return;
					}
				} catch {}
			}

			// 5. Dominant link color (excluding black/white/gray)
			const linkBuckets = {};
			for (const a of document.querySelectorAll("a")) {
				const c = parseColor(window.getComputedStyle(a).color);
				if (!c || !isViable(...c)) continue;
				const key = c.join(",");
				linkBuckets[key] = (linkBuckets[key] || 0) + 1;
			}
			let bestLink = null, bestLinkCount = 0;
			for (const [key, count] of Object.entries(linkBuckets)) {
				if (count > bestLinkCount) { bestLinkCount = count; bestLink = key; }
			}
			if (bestLink && bestLinkCount >= 2) {
				applyBrandColor(`rgb(${bestLink})`);
				return;
			}

			// 6. Prominent colored UI element (sub-nav, accent bar, etc.)
			for (const el of document.querySelectorAll("div, section, span, nav")) {
				const r = el.getBoundingClientRect();
				if (r.width < 200 || r.height < 5) continue;
				const c = parseColor(window.getComputedStyle(el).backgroundColor);
				if (c && isViable(...c)) {
					applyBrandColor(`rgb(${c[0]},${c[1]},${c[2]})`);
					return;
				}
			}

			// 7. msapplication-TileColor
			const tile = document.querySelector('meta[name="msapplication-TileColor"]');
			if (tile) {
				const c = parseColor(tile.getAttribute("content"));
				if (c && isViable(...c)) {
					applyBrandColor(`rgb(${c[0]},${c[1]},${c[2]})`);
					return;
				}
			}
		});

		// ── Universal page cleanup ──
		// Strip ads, sidebars, related sections, social bars, empty spacers,
		// and other non-article clutter so the mockup is clean on any site.
		await page.evaluate(() => {
			const W = "[data-deeperdive-mock]";
			function safe(el) {
				return el.closest(W) || el.querySelector?.(W);
			}
			function hide(selectors) {
				for (const sel of selectors) {
					try {
						for (const el of document.querySelectorAll(sel)) {
							if (safe(el)) continue;
							el.style.setProperty("display", "none", "important");
						}
					} catch { /* invalid selector on this page */ }
				}
			}

			// ── 1. Ads (class, id, data-attr, iframes) ──
			hide([
				'[class*="advertisement"]', '[class*="ad-slot"]',
				'[class*="ad-unit"]',       '[class*="ad-wrapper"]',
				'[class*="ad-container"]',  '[class*="ad-holder"]',
				'[class*="ad-placeholder"]','[class*="ad-break"]',
				'[class*="advert-"]',       '[class*="advert_"]',
				'[class*="inline-ad"]',     '[class*="mid-article"]',
				'[class*="dfp-"]',          '[class*="gpt-ad"]',
				'[class*="google-ad"]',     '[class*="sponsor"]',
				'[id*="google_ads"]',       '[id*="div-gpt-ad"]',
				'[id*="taboola"]',          '[id*="outbrain"]',
				'[id*="ad-slot"]',          '[id*="ad-unit"]',
				'[data-ad]',               '[data-ad-slot]',
				'[data-ad-unit]',          '[data-google-query-id]',
				'iframe[src*="doubleclick"]',
				'iframe[src*="googlesyndication"]',
				'iframe[src*="amazon-adsystem"]',
			]);

			// ── 2. Sidebars ──
			// Only hide elements that look like actual sidebars (narrow), not
			// full-width wrapper divs whose class name happens to mention "rail".
			const vw = window.innerWidth;
			const sidebarSels = [
				'[class*="sidebar"]',  '[class*="side-bar"]',
				'[class*="Sidebar"]',  '[class*="SideBar"]',
				'[class*="right-rail"]','[class*="left-rail"]',
				'[class*="rightRail"]', '[class*="right_rail"]',
				'[class*="side-column"]','[class*="aside-column"]',
				'[id*="sidebar"]',     '[id*="side-bar"]',
				'[id*="right-rail"]',  '[id*="left-rail"]',
				'[role="complementary"]',
			];
			for (const sel of sidebarSels) {
				try {
					for (const el of document.querySelectorAll(sel)) {
						if (safe(el)) continue;
						if (el.getBoundingClientRect().width > vw * 0.5) continue;
						el.style.setProperty("display", "none", "important");
					}
				} catch {}
			}
			for (const aside of document.querySelectorAll("aside")) {
				if (safe(aside)) continue;
				if (aside.getBoundingClientRect().width > vw * 0.5) continue;
				aside.style.setProperty("display", "none", "important");
			}

			// ── 3. Related / recommended / recirc / trending ──
			hide([
				'[class*="related-article"]','[class*="related_article"]',
				'[class*="relatedArticle"]', '[class*="RelatedArticle"]',
				'[class*="recommended"]',    '[class*="recirc"]',
				'[class*="more-stories"]',   '[class*="more-from"]',
				'[class*="trending"]',       '[class*="most-read"]',
				'[class*="popular-"]',       '[class*="also-read"]',
				'[class*="you-may-like"]',   '[class*="around-the-web"]',
				'[data-testid*="related"]',  '[data-component*="related"]',
			]);

			// ── 4. Social share bars, newsletter, comments ──
			hide([
				'[class*="share-bar"]',     '[class*="social-share"]',
				'[class*="sharing-"]',      '[class*="share-tools"]',
				'[class*="newsletter"]',    '[class*="subscribe-"]',
				'[class*="signup-"]',       '[class*="sign-up-"]',
				'[class*="comment-section"]','#comments', '#disqus_thread',
			]);

			// ── 5. Collapse empty spacer divs (unfilled ad slots) ──
			// Headless Chrome doesn't load most ads, leaving tall empty rectangles.
			// Check for media via DOM presence (src attr), not rendered dimensions,
			// because earlier hide() calls can trigger reflows that zero-out sizes.
			for (const el of document.querySelectorAll("div, section")) {
				if (safe(el)) continue;
				if (el.closest("figure, picture")) continue;
				const r = el.getBoundingClientRect();
				if (r.height < 90 || r.height > 600 || r.width < 200) continue;
				const text = (el.textContent || "").replace(/\s+/g, " ").trim();
				if (text.length > 30) continue;
				if (el.querySelector("img[src], img[data-src], video, canvas, svg, picture")) continue;
				if (el.querySelector("p, h1, h2, h3, h4, h5, h6")) continue;
				el.style.setProperty("display", "none", "important");
			}

			// ── 6. Hide fixed/sticky nav bars that would overlay the screenshot ──
			for (const el of document.querySelectorAll("nav, header, [class*='nav-']")) {
				const st = window.getComputedStyle(el);
				if (st.position === "fixed" || st.position === "sticky") {
					el.style.setProperty("display", "none", "important");
				}
			}
		});

		await new Promise((r) => setTimeout(r, 250));

		const out = resolve(outputPath);
		mkdirSync(dirname(out), { recursive: true });

		const clip = await page.evaluate(() => {
			const vw = window.innerWidth;
			const W = "[data-deeperdive-mock]";

			// Collect every visible element that belongs to the article:
			// headline, hero image, widget, body paragraphs, blockquotes.
			const candidates = [
				...document.querySelectorAll(
					'article p, article h1, article h2, article h3, ' +
					'article figure, article img, article blockquote, ' +
					'[role="article"] p, [role="article"] figure, ' +
					'main p, main h1, main h2, main figure, ' +
					'.article-body p, .post-content p, .entry-content p, ' +
					'#mw-content-text p, #mw-content-text figure',
				),
				// Include headline even if it sits outside <article>
				document.querySelector("h1"),
				document.querySelector(W),
			].filter(Boolean);

			let top = Infinity;
			let bottom = 0;
			let left = Infinity;
			let right = 0;

			for (const el of candidates) {
				const st = window.getComputedStyle(el);
				if (st.display === "none" || st.visibility === "hidden") continue;
				const r = el.getBoundingClientRect();
				if (r.height < 2 || r.width < 40) continue;
				// Ignore elements that span nearly the full viewport (likely
				// full-width wrappers, not content elements).
				if (r.width > vw * 0.92 && el.tagName !== "IMG" && el.tagName !== "FIGURE") continue;
				top = Math.min(top, r.top);
				bottom = Math.max(bottom, r.bottom);
				left = Math.min(left, r.left);
				right = Math.max(right, r.right);
			}

			if (top >= bottom || left >= right) return null;

			const pad = 20;
			return {
				x: Math.max(0, left - pad),
				y: Math.max(0, top + window.scrollY - pad),
				width: right - left + pad * 2,
				height: bottom - top + pad * 2,
			};
		});

		if (clip) {
			await page.screenshot({ path: out, type: "png", clip });
		} else {
			await page.screenshot({ path: out, type: "png" });
		}

		return { outputPath: out, placement };
	} finally {
		await browser.close();
	}
}

async function main() {
	const opts = parseArgs(process.argv);
	if (!opts.url) {
		console.error("Missing --url <https://...>");
		process.exit(1);
	}
	const { outputPath, placement } = await capturePageToPng({
		url: opts.url,
		outputPath: resolve(process.cwd(), opts.output),
		waitUntil: opts.waitUntil,
		timeout: opts.timeout,
		publication: opts.publication,
	});
	console.log(`Saved ${outputPath} (${placement.placement})`);
}

const __filename = fileURLToPath(import.meta.url);
const invokedAsCli =
	process.argv[1] &&
	path.resolve(process.cwd(), process.argv[1]) === path.resolve(__filename);

if (invokedAsCli) {
	main().catch((err) => {
		console.error(err.message || err);
		process.exit(1);
	});
}
