/**
 * Local UI: enter a URL → download PNG with DeeperDive widget injected.
 *   npm run serve
 *   open http://127.0.0.1:3847
 */

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { capturePageToPng } from "./capture.mjs";

const PORT = Number(process.env.PORT) || 3847;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>URL → PNG (DeeperDive widget)</title>
  <style>
    :root { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    body { max-width: 960px; margin: 48px auto; padding: 0 20px; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; }
    label { display: block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 6px; }
    input[type="url"], input[type="text"], textarea {
      width: 100%; padding: 12px 14px; border-radius: 8px; border: 1px solid #334155;
      background: #1e293b; color: #f1f5f9; font-size: 1rem; box-sizing: border-box;
      font-family: inherit;
    }
    textarea { resize: vertical; min-height: 72px; line-height: 1.5; }
    input:focus, textarea:focus { outline: 2px solid #38bdf8; outline-offset: 1px; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 16px; }
    button {
      padding: 12px 20px; border-radius: 8px; border: none;
      background: #38bdf8; color: #0f172a; font-weight: 600; font-size: 0.95rem; cursor: pointer;
    }
    button.secondary { background: #334155; color: #e2e8f0; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .err { color: #f87171; font-size: 0.875rem; margin-top: 12px; }
    .hint { margin-top: 20px; font-size: 0.8rem; color: #64748b; }
    code { background: #1e293b; padding: 2px 6px; border-radius: 4px; }
    .device-toggle { display: inline-flex; border-radius: 8px; overflow: hidden; border: 1px solid #334155; margin-top: 6px; }
    .device-toggle input { display: none; }
    .device-toggle label {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 10px 18px; font-size: 0.85rem; font-weight: 500; color: #94a3b8;
      background: #1e293b; cursor: pointer; margin: 0; text-transform: none; letter-spacing: 0;
      border-right: 1px solid #334155; transition: background 0.15s, color 0.15s;
    }
    .device-toggle label:last-of-type { border-right: none; }
    .device-toggle input:checked + label { background: #38bdf8; color: #0f172a; }
    .preview-wrap {
      margin-top: 28px; padding: 16px; border-radius: 12px; border: 1px solid #334155;
      background: #1e293b; display: none;
    }
    .preview-wrap.visible { display: block; }
    .preview-wrap h2 { font-size: 0.9rem; font-weight: 600; color: #94a3b8; margin: 0 0 12px; }
    .preview-wrap img {
      max-width: 100%; height: auto; display: block; border-radius: 8px;
      border: 1px solid #334155; background: #0f172a;
    }
    .preview-grid { display: flex; gap: 16px; align-items: flex-start; }
    .preview-col { flex: 1; min-width: 0; }
    .preview-col.mobile-col { flex: 0 0 auto; max-width: 240px; }
    .preview-col h3 { font-size: 0.8rem; font-weight: 600; color: #64748b; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em; }
    .preview-col button { margin-top: 10px; font-size: 0.8rem; padding: 8px 14px; }
    .status { font-size: 0.85rem; color: #64748b; margin-top: 8px; min-height: 1.2em; }
    .content-editor { display: none; margin-top: 24px; padding: 20px; border-radius: 12px; border: 1px solid #334155; background: #1e293b; }
    .content-editor.visible { display: block; }
    .content-editor h2 { font-size: 0.9rem; font-weight: 600; color: #94a3b8; margin: 0 0 16px; }
    .field-group { margin-bottom: 16px; }
    .field-row { display: flex; gap: 8px; align-items: flex-start; }
    .field-row input[type="text"], .field-row textarea { flex: 1; }
    .btn-refresh {
      padding: 10px 14px; border-radius: 8px; border: 1px solid #475569;
      background: transparent; color: #94a3b8; font-size: 0.8rem; cursor: pointer;
      white-space: nowrap; flex-shrink: 0; margin-top: 1px;
    }
    .btn-refresh:hover { border-color: #38bdf8; color: #38bdf8; }
    @media (max-width: 640px) {
      body { margin: 20px auto; padding: 0 14px; }
      h1 { font-size: 1.1rem; }
      .row { flex-direction: column; align-items: stretch; }
      .row button { width: 100%; text-align: center; }
      .device-toggle { display: flex; width: 100%; }
      .device-toggle label { flex: 1; justify-content: center; padding: 10px 8px; font-size: 0.8rem; }
      .preview-grid { flex-direction: column; }
      .preview-col.mobile-col { max-width: 100%; }
      .field-row { flex-direction: column; }
      .btn-refresh { width: 100%; text-align: center; }
    }
  </style>
</head>
<body>
  <h1>Static page mock + DeeperDive widget</h1>
  <p>Paste any article URL and click <strong>Generate preview</strong>. The widget is automatically placed before the first body paragraph. To target a specific element instead, enter a CSS selector below.</p>
  <form id="f" method="post" action="#" autocomplete="off">
    <label for="url">Page URL</label>
    <input id="url" name="url" type="url" placeholder="https://www.example.com/news/..." required autocomplete="off" />

    <div style="margin-top: 14px;">
      <label>Device mockup</label>
      <div class="device-toggle">
        <input type="radio" name="device" id="devDesktop" value="desktop" checked />
        <label for="devDesktop">Desktop</label>
        <input type="radio" name="device" id="devMobile" value="mobile" />
        <label for="devMobile">Mobile</label>
        <input type="radio" name="device" id="devBoth" value="both" />
        <label for="devBoth">Both</label>
      </div>
    </div>

    <div style="margin-top: 14px;">
      <label for="cssSelector">Widget placement override <span style="text-transform:none;letter-spacing:0;color:#475569">(optional — leave empty for automatic placement)</span></label>
      <input id="cssSelector" name="cssSelector" type="text" placeholder="e.g. #article-body, .post-content > p, [data-component=&quot;text-block&quot;]" autocomplete="off" />
      <p style="margin:6px 0 0;font-size:0.8rem;color:#64748b;line-height:1.4;">Enter a CSS selector for the element DeeperDive should appear ABOVE. If left empty, the widget is placed before the first body paragraph automatically.</p>
    </div>
    <div class="row">
      <button type="submit" id="go">Generate preview</button>
    </div>
    <p class="status" id="status"></p>
    <p class="err" id="err" hidden></p>
  </form>

  <section class="content-editor" id="editorSection">
    <h2>Widget content</h2>
    <p style="margin:-8px 0 16px;font-size:0.8rem;color:#64748b;">Edit the summary and questions, then click <strong style="color:#e2e8f0;">Regenerate mockup</strong> to update the preview.</p>
    <div class="field-group">
      <label for="editSummary">Summary</label>
      <textarea id="editSummary" rows="3"></textarea>
    </div>
    <div class="field-group">
      <label for="editQ1">Suggested question 1</label>
      <div class="field-row">
        <input id="editQ1" type="text" />
        <button type="button" class="btn-refresh" id="refreshQ1" title="Generate a new question">↻ Refresh</button>
      </div>
    </div>
    <div class="field-group">
      <label for="editQ2">Suggested question 2</label>
      <div class="field-row">
        <input id="editQ2" type="text" />
        <button type="button" class="btn-refresh" id="refreshQ2" title="Generate a new question">↻ Refresh</button>
      </div>
    </div>
    <div class="row" style="margin-top:8px;">
      <button type="button" id="regen">Regenerate mockup</button>
    </div>
  </section>

  <section class="preview-wrap" id="previewSection" aria-live="polite">
    <div id="previewSingle">
      <h2>Preview</h2>
      <img id="previewImg" alt="Generated mock screenshot" />
      <button type="button" class="secondary" id="dl" style="margin-top:12px" disabled>Download PNG</button>
    </div>
    <div id="previewDual" style="display:none">
      <h2>Preview</h2>
      <div class="preview-grid">
        <div class="preview-col">
          <h3>Desktop</h3>
          <img id="previewDesktop" alt="Desktop mock" />
          <button type="button" class="secondary" id="dlDesktop">Download Desktop PNG</button>
        </div>
        <div class="preview-col mobile-col">
          <h3>Mobile</h3>
          <img id="previewMobile" alt="Mobile mock" />
          <button type="button" class="secondary" id="dlMobile">Download Mobile PNG</button>
        </div>
      </div>
    </div>
  </section>
  <p class="hint">CLI: <code>node capture.mjs -u "https://..." -o out.png</code></p>
  <script>
    const f = document.getElementById("f");
    const err = document.getElementById("err");
    const go = document.getElementById("go");
    const regen = document.getElementById("regen");
    const status = document.getElementById("status");
    const previewSection = document.getElementById("previewSection");
    const editorSection = document.getElementById("editorSection");
    const editSummary = document.getElementById("editSummary");
    const editQ1 = document.getElementById("editQ1");
    const editQ2 = document.getElementById("editQ2");
    const refreshQ1 = document.getElementById("refreshQ1");
    const refreshQ2 = document.getElementById("refreshQ2");

    const previewSingle = document.getElementById("previewSingle");
    const previewDual = document.getElementById("previewDual");
    const previewImg = document.getElementById("previewImg");
    const previewDesktop = document.getElementById("previewDesktop");
    const previewMobile = document.getElementById("previewMobile");
    const dl = document.getElementById("dl");
    const dlDesktop = document.getElementById("dlDesktop");
    const dlMobile = document.getElementById("dlMobile");

    let urls = { single: null, desktop: null, mobile: null };
    let candidatePool = [];

    function getDevice() {
      return document.querySelector('input[name="device"]:checked')?.value || "desktop";
    }

    function downloadUrl(objUrl, filename) {
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      a.click();
    }

    function revokeAll() {
      for (const k of Object.keys(urls)) {
        if (urls[k]) URL.revokeObjectURL(urls[k]);
        urls[k] = null;
      }
    }

    function base64ToBlob(b64, mime) {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: mime || "image/png" });
    }

    function showSinglePreview(b64, filename) {
      revokeAll();
      urls.single = URL.createObjectURL(base64ToBlob(b64));
      previewImg.src = urls.single;
      previewSingle.style.display = "";
      previewDual.style.display = "none";
      dl.disabled = false;
      dl.onclick = () => downloadUrl(urls.single, filename);
      previewSection.classList.add("visible");
    }

    function showDualPreview(desktopB64, mobileB64) {
      revokeAll();
      urls.desktop = URL.createObjectURL(base64ToBlob(desktopB64));
      urls.mobile = URL.createObjectURL(base64ToBlob(mobileB64));
      previewDesktop.src = urls.desktop;
      previewMobile.src = urls.mobile;
      previewSingle.style.display = "none";
      previewDual.style.display = "";
      dlDesktop.onclick = () => downloadUrl(urls.desktop, "page-with-deeperdive-desktop.png");
      dlMobile.onclick = () => downloadUrl(urls.mobile, "page-with-deeperdive-mobile.png");
      previewSection.classList.add("visible");
    }

    function populateEditor(content) {
      editSummary.value = content.summary || "";
      editQ1.value = content.question1 || "";
      editQ2.value = content.question2 || "";
      candidatePool = content.candidateQuestions || [];
      editorSection.classList.add("visible");
    }

    function nextCandidate(currentVal, skipVal) {
      if (candidatePool.length === 0) return currentVal;
      let idx = candidatePool.indexOf(currentVal);
      for (let i = 0; i < candidatePool.length; i++) {
        idx = (idx + 1) % candidatePool.length;
        if (candidatePool[idx] !== skipVal) return candidatePool[idx];
      }
      return candidatePool[(idx + 1) % candidatePool.length];
    }

    refreshQ1.addEventListener("click", () => { editQ1.value = nextCandidate(editQ1.value, editQ2.value); });
    refreshQ2.addEventListener("click", () => { editQ2.value = nextCandidate(editQ2.value, editQ1.value); });

    async function runCapture(overrides) {
      err.hidden = true;
      go.disabled = true;
      regen.disabled = true;
      dl.disabled = true;
      previewSection.classList.remove("visible");
      const device = getDevice();
      const hint = device === "both" ? "Generating desktop + mobile… this can take a couple of minutes." : "Generating… this can take a minute.";
      status.textContent = hint;
      try {
        const pageUrl = document.getElementById("url").value.trim();
        const cssSelector = document.getElementById("cssSelector").value.trim() || undefined;
        const payload = { url: pageUrl, cssSelector, device, ...overrides };
        const res = await fetch("/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text() || res.statusText);
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("Unexpected response — refresh and try again.");
        const data = await res.json();

        if (data.device === "both") {
          if (!data.desktopBase64 || !data.mobileBase64) throw new Error("Invalid dual preview payload.");
          showDualPreview(data.desktopBase64, data.mobileBase64);
        } else {
          if (!data.imageBase64) throw new Error("Invalid preview payload.");
          showSinglePreview(data.imageBase64, data.filename || "page-with-deeperdive.png");
        }

        if (data.generatedContent) populateEditor(data.generatedContent);
        status.textContent = "Preview ready — edit the content below or download.";
      } catch (x) {
        err.textContent = x.message || String(x);
        err.hidden = false;
        status.textContent = "";
        revokeAll();
      } finally {
        go.disabled = false;
        regen.disabled = false;
      }
    }

    f.addEventListener("submit", (e) => {
      e.preventDefault();
      editorSection.classList.remove("visible");
      runCapture();
    });

    regen.addEventListener("click", () => {
      runCapture({
        summary: editSummary.value.trim(),
        question1: editQ1.value.trim(),
        question2: editQ2.value.trim(),
      });
    });
  </script>
</body>
</html>`;

function parseJsonBody(req, limit = 16_384) {
	return new Promise((resolve, reject) => {
		let buf = "";
		req.on("data", (c) => {
			buf += c;
			if (buf.length > limit) {
				reject(new Error("Body too large"));
				req.destroy();
			}
		});
		req.on("end", () => {
			try {
				resolve(buf ? JSON.parse(buf) : {});
			} catch {
				reject(new Error("Invalid JSON"));
			}
		});
		req.on("error", reject);
	});
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

	if (req.method === "GET" && url.pathname === "/") {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(INDEX_HTML);
		return;
	}

	if (req.method === "GET" && url.pathname === "/health") {
		try {
			const puppeteer = await import("puppeteer");
			const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
			const b = await puppeteer.default.launch({
				headless: "new",
				timeout: 30_000,
				args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
				...(execPath ? { executablePath: execPath } : {}),
			});
			const version = await b.version();
			await b.close();
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true, chrome: version, executablePath: execPath || "bundled" }));
		} catch (e) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: e.message }));
		}
		return;
	}

	if (req.method === "POST" && url.pathname === "/capture") {
		try {
			const body = await parseJsonBody(req);
			const pageUrl = typeof body.url === "string" ? body.url.trim() : "";
			if (!pageUrl) {
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end("Missing url");
				return;
			}

			const outDir = path.join(__dirname, ".output");
			const stamp = Date.now();
			const device = (body.device === "mobile" || body.device === "both") ? body.device : "desktop";

			const widgetOptions = {};
			if (typeof body.summary === "string" && body.summary) widgetOptions.summary = body.summary;
			if (typeof body.question1 === "string" && body.question1) widgetOptions.question1 = body.question1;
			if (typeof body.question2 === "string" && body.question2) widgetOptions.question2 = body.question2;

			const baseOpts = {
				url: pageUrl,
				waitUntil: "domcontentloaded",
				timeout: 60_000,
				publication: typeof body.publication === "string" ? body.publication : "Daily Star",
				cssSelector: typeof body.cssSelector === "string" ? body.cssSelector.trim() : "",
				widgetOptions,
			};

			if (device === "both") {
				const desktopPath = path.join(outDir, `capture-${stamp}-desktop.png`);
				const desktopResult = await capturePageToPng({ ...baseOpts, outputPath: desktopPath, device: "desktop" });

				const gc = desktopResult.generatedContent;
				const mobileOpts = {
					...baseOpts,
					outputPath: path.join(outDir, `capture-${stamp}-mobile.png`),
					device: "mobile",
					widgetOptions: {
						...widgetOptions,
						summary: gc.summary,
						question1: gc.question1,
						question2: gc.question2,
					},
				};
				const mobileResult = await capturePageToPng(mobileOpts);

				const payload = JSON.stringify({
					ok: true,
					device: "both",
					desktopBase64: readFileSync(desktopPath).toString("base64"),
					mobileBase64: readFileSync(mobileResult.outputPath).toString("base64"),
					generatedContent: gc,
				});
				res.writeHead(200, {
					"Content-Type": "application/json; charset=utf-8",
					"Content-Length": Buffer.byteLength(payload),
					"Cache-Control": "no-store",
				});
				res.end(payload);
			} else {
				const outputPath = path.join(outDir, `capture-${stamp}.png`);
				const result = await capturePageToPng({ ...baseOpts, outputPath, device });

				const payload = JSON.stringify({
					ok: true,
					device,
					imageBase64: readFileSync(outputPath).toString("base64"),
					filename: `page-with-deeperdive-${device}.png`,
					generatedContent: result.generatedContent,
				});
				res.writeHead(200, {
					"Content-Type": "application/json; charset=utf-8",
					"Content-Length": Buffer.byteLength(payload),
					"Cache-Control": "no-store",
				});
				res.end(payload);
			}
		} catch (e) {
			res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
			res.end(e.message || String(e));
		}
		return;
	}

	res.writeHead(404);
	res.end("Not found");
});

const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
	console.log(`URL mockup tool: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});
