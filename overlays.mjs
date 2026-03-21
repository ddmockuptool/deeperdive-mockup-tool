/**
 * CMP consent + overlay stripping so captures are unobstructed.
 * CMPs often live in Shadow DOM or cross-origin iframes — we traverse both and click “accept”
 * patterns; we also remove dimmers / high-z overlays that block the shot.
 */

const CONSENT_CLICK_SELECTORS = [
	/* OneTrust */
	"#onetrust-accept-btn-handler",
	"#accept-recommended-btn-handler",
	".ot-sdk-container .accept-btn-handler",
	".ot-sdk-container button[aria-label*='Accept' i]",
	"#onetrust-pc-btn-handler",
	"button.onetrust-close-btn-handler",
	/* Sourcepoint / Funding Choices */
	".message-component button.sp_choice_type_11",
	".message-component button[title*='Accept' i]",
	"button.sp_choice_type_11",
	"button[title*='I Accept' i]",
	/* Quantcast */
	".qc-cmp2-summary-buttons button.qc-cmp-button",
	".qc-cmp2-summary-buttons button:first-child",
	"button[mode='primary']",
	/* Cookiebot */
	"#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
	"#CybotCookiebotDialogBodyButtonAccept",
	".CybotCookiebotDialogBodyButtonAccept",
	/* TrustArc */
	"#truste-consent-button",
	".trustarc-agree-btn",
	/* Didomi */
	"#didomi-notice-agree-button",
	".didomi-continue-without-agreeing",
	/* Usercentrics */
	"#uc-btn-accept-banner",
	"#uc-btn-save-banner",
	".uc-accept-button",
	/* generic */
	'[data-cookiebanner="accept_button"]',
	'[data-testid="cookie-accept-all"]',
	'[data-testid="uc-accept-all-banner"]',
	'button[id*="accept"][id*="cookie" i]',
	"#cookiescript_accept",
	".cc-allow",
	".cc-btn.cc-allow",
	".js-cookie-consent-accept",
	".evidon-banner-acceptbutton",
];

const FRAME_CONSENT_SELECTORS = [
	"button.sp_choice_type_11",
	"button[title*='Accept' i]",
	"button[title*='I Accept' i]",
	"button[aria-label*='Accept' i]",
	"button[aria-label*='I Accept' i]",
	".message-button:first-child button",
	"#acceptAll",
	"button.accept",
	"button.primary",
];

const REMOVE_SELECTORS = [
	"#onetrust-consent-sdk",
	"#onetrust-banner-sdk",
	".onetrust-pc-dark-filter",
	".ot-sdk-container",
	"#sp_message_container",
	'[id^="sp_message_iframe"]',
	'[id^="sp_message_panel"]',
	".sp_veil",
	".sp_veil_container",
	"[class*='sp_veil']",
	"#sp_notification",
	".fc-consent-root",
	".fc-dialog-container",
	".qc-cmp2-container",
	".qc-cmp-cleanslate",
	".trustarc-banner",
	"#cmpbox",
	"#CybotCookiebotDialog",
	"#CybotCookiebotDialogBodyUnderlay",
	"#cookie-law-info-bar",
	".cookie-banner",
	".cc-banner",
	".cc-window",
	'[data-testid="cookie-banner"]',
	"#didomi-host",
	".didomi-popup-container",
	".ReactModal__Overlay",
	".modal-backdrop",
	".modal-backdrop.show",
	".newsletter-popup",
	".newsletter-modal",
	'[class*="interstitial"]',
	'[id*="interstitial"]',
	".tp-modal",
	".tp-backdrop",
	".tp-iframe-wrapper",
	".piano-offer",
	".piano-inline",
	".overlay--visible",
	"#walliframe",
	'[class*="privacy-overlay"]',
	'[class*="consent-modal"]',
	'[id*="consent-banner"]',
];

const DEFAULT_ROUNDS = 4;

/**
 * Injected into page / iframe context. Returns true if something was clicked.
 */
function clickConsentClickablesInDocument() {
	const reject =
		/reject(\s+all)?|declin|refus|necessary\s+only|only\s+necessary|essential\s+only|deny|opt\s*out/i;

	function looksLikeAccept(raw) {
		const s = raw.replace(/\s+/g, " ").trim();
		if (!s || s.length > 160) return false;
		if (reject.test(s)) return false;
		if (/^more\s+options$/i.test(s)) return false;
		if (/settings|preferences|customize|manage(\s+cookies)?$/i.test(s) && !/accept/i.test(s)) {
			return false;
		}
		return (
			/^i\s+accept$/i.test(s) ||
			/^accept$/i.test(s) ||
			/^accept(\s+all)?$/i.test(s) ||
			/^accept(\s+cookies)?$/i.test(s) ||
			/^allow(\s+all)?$/i.test(s) ||
			/^agree(\s+to\s+all)?$/i.test(s) ||
			/^i\s+agree$/i.test(s) ||
			/^ok(,?\s+accept)?$/i.test(s) ||
			/^consent$/i.test(s) ||
			/^yes(,?\s+i\s+accept)?$/i.test(s) ||
			/^got\s+it$/i.test(s) ||
			/^continue$/i.test(s) ||
			/^allow$/i.test(s) ||
			/^alle\s+zustimmen$/i.test(s) ||
			/^tout\s+accepter$/i.test(s) ||
			/^aceptar\s+todo$/i.test(s) ||
			/^accetta\s+tutto$/i.test(s) ||
			(/^accept/i.test(s) && !/settings|preferences|customize|more\s+options/i.test(s))
		);
	}

	function isInteractive(el) {
		if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
		const tag = el.tagName;
		const role = el.getAttribute("role");
		const type = el.getAttribute("type");
		return (
			tag === "BUTTON" ||
			role === "button" ||
			(tag === "A" && role === "button") ||
			(tag === "INPUT" && (type === "submit" || type === "button"))
		);
	}

	/** Depth-first: light DOM + every open shadow root */
	function visit(node, out) {
		if (!node) return;
		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node;
			if (isInteractive(el)) out.push(el);
			if (el.shadowRoot) visit(el.shadowRoot, out);
			for (const child of el.children) visit(child, out);
		} else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
			for (const child of node.children) visit(child, out);
		}
	}

	const candidates = [];
	visit(document.documentElement, candidates);

	for (const el of candidates) {
		const st = window.getComputedStyle(el);
		if (st.visibility === "hidden" || st.display === "none" || Number.parseFloat(st.opacity) === 0) {
			continue;
		}
		const t = (el.textContent || /** @type {HTMLInputElement} */ (el).value || "")
			.replace(/\s+/g, " ")
			.trim();
		if (looksLikeAccept(t)) {
			el.click();
			return true;
		}
	}
	return false;
}

/** @param {import('puppeteer').Page} page */
export async function tryClickConsentButtons(page) {
	for (const sel of CONSENT_CLICK_SELECTORS) {
		try {
			const h = await page.$(sel);
			if (h) {
				const box = await h.boundingBox();
				if (box && box.width > 2 && box.height > 2) {
					await h.click({ delay: 20 });
				}
				await h.dispose();
			}
		} catch {
			/* ignore */
		}
	}
}

/** @param {import('puppeteer').Page} page */
export async function tryClickConsentInIframes(page) {
	const main = page.mainFrame();
	for (const frame of page.frames()) {
		if (frame === main) continue;
		if (frame.url() === "about:blank") continue;
		// Cap per-frame processing to 2 seconds to avoid hanging on slow iframes
		await Promise.race([
			(async () => {
				for (const sel of FRAME_CONSENT_SELECTORS) {
					try {
						const h = await frame.$(sel);
						if (h) {
							await h.click({ delay: 20 });
							await h.dispose();
						}
					} catch {
						/* ignore */
					}
				}
				try {
					await frame.evaluate(clickConsentClickablesInDocument);
				} catch {
					/* cross-origin or blocked */
				}
			})(),
			new Promise((r) => setTimeout(r, 2000)),
		]);
	}
}

/** Main frame: Shadow DOM + normal DOM */
export async function clickConsentByVisibleText(page) {
	const clicked = await page.evaluate(clickConsentClickablesInDocument);
	return clicked;
}

/** @param {import('puppeteer').Page} page */
export async function tryKeyboardDismiss(page) {
	try {
		await page.keyboard.press("Escape");
	} catch {
		/* ignore */
	}
}

/**
 * Sourcepoint / similar: consent UI in iframe; if script clicks fail, hit likely button area.
 * @param {import('puppeteer').Page} page
 */
export async function tryClickConsentIframeRegions(page) {
	const handles = await page.$$(
		'iframe[id*="sp_message"], iframe[id*="privacy"], iframe[src*="privacy-mgmt"], iframe[src*="consent"], iframe[src*="sp_message"]',
	);
	for (const h of handles) {
		try {
			const box = await h.boundingBox();
			if (!box || box.width < 80 || box.height < 80) continue;
			/* Primary action often lower half / center */
			await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.72);
			await new Promise((r) => setTimeout(r, 80));
			await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
		} catch {
			/* ignore */
		} finally {
			await h.dispose();
		}
	}
}

/** @param {import('puppeteer').Page} page */
export async function dismissOverlays(page) {
	await page.evaluate((removeSelectors) => {
		for (const sel of removeSelectors) {
			try {
				document.querySelectorAll(sel).forEach((el) => el.remove());
			} catch {
				/* ignore invalid selectors */
			}
		}

		document.querySelectorAll('[role="dialog"], [aria-modal="true"]').forEach((el) => {
			const r = el.getBoundingClientRect();
			if (r.width > 160 && r.height > 60) el.remove();
		});

		document.body.classList.remove("modal-open", "overflow-hidden", "no-scroll", "with-overlay");
		document.documentElement.classList.remove("modal-open", "overflow-hidden");
		document.body.style.overflow = "";
		document.documentElement.style.overflow = "";
		document.body.style.position = "";
		document.body.removeAttribute("data-scroll-locked");
		document.documentElement.style.position = "";

		const vw = window.innerWidth;
		const vh = window.innerHeight;

		/* Full-viewport fixed dimmers (lower bar: many CMPs use z-index 999 / 10000) */
		document.querySelectorAll("body > *").forEach((el) => {
			const st = window.getComputedStyle(el);
			if (st.display === "none") return;
			if (st.position !== "fixed") return;
			const r = el.getBoundingClientRect();
			if (r.width >= vw * 0.85 && r.height >= vh * 0.45) {
				el.remove();
			}
		});

		/* Dark rgba backdrops */
		document.querySelectorAll("body *").forEach((el) => {
			if (el === document.body || el === document.documentElement) return;
			const st = window.getComputedStyle(el);
			if (st.display === "none" || st.visibility === "hidden") return;
			if (st.position !== "fixed" && st.position !== "absolute") return;
			const bg = st.backgroundColor || "";
			const isDarkOverlay =
				/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.[0-9]+\)/.test(bg) ||
				/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[1-9]/.test(bg);
			if (!isDarkOverlay) return;
			const r = el.getBoundingClientRect();
			const cover = (r.width * r.height) / (vw * vh);
			if (cover >= 0.35 && r.width > 120 && r.height > 120) {
				el.remove();
			}
		});

		/* High z-index layers covering a large fraction of the viewport */
		document.querySelectorAll("body *").forEach((el) => {
			if (el === document.body || el === document.documentElement) return;
			const st = window.getComputedStyle(el);
			if (st.display === "none" || st.visibility === "hidden") return;
			if (st.position !== "fixed" && st.position !== "absolute") return;
			const z = Number.parseInt(st.zIndex, 10);
			if (Number.isNaN(z) || z < 50) return;
			const r = el.getBoundingClientRect();
			const cover = (r.width * r.height) / (vw * vh);
			if (cover >= 0.22 && r.width > 140 && r.height > 100) {
				el.remove();
			}
		});
	}, REMOVE_SELECTORS);
}

/** One full attempt: frames, selectors, shadow text, iframe taps, escape, DOM cleanup */
export async function runOneConsentPass(page) {
	await tryClickConsentInIframes(page);
	await tryClickConsentButtons(page);
	await clickConsentByVisibleText(page);
	await tryClickConsentIframeRegions(page);
	await tryKeyboardDismiss(page);
	await dismissOverlays(page);
}

/**
 * Repeated consent + cleanup so late CMP scripts still get handled.
 * Prefer `waitUntilCmpResolvedAndSettled` (cmp-resolve.mjs) before screenshots.
 * @param {import('puppeteer').Page} page
 * @param {{ rounds?: number }} [opts]
 */
export async function stripPopupsForCapture(page, opts = {}) {
	const rounds = typeof opts.rounds === "number" ? opts.rounds : DEFAULT_ROUNDS;
	await new Promise((r) => setTimeout(r, 900));
	for (let round = 0; round < rounds; round++) {
		await runOneConsentPass(page);
		await new Promise((r) => setTimeout(r, round === 0 ? 200 : 320));
	}
}
