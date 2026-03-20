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
    input[type="url"] {
      width: 100%; padding: 12px 14px; border-radius: 8px; border: 1px solid #334155;
      background: #1e293b; color: #f1f5f9; font-size: 1rem; box-sizing: border-box;
    }
    input:focus { outline: 2px solid #38bdf8; outline-offset: 1px; }
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
    .status { font-size: 0.85rem; color: #64748b; margin-top: 8px; min-height: 1.2em; }
  </style>
</head>
<body>
  <h1>Static page mock + DeeperDive widget</h1>
  <p>Paste any article URL and click <strong>Generate preview</strong>. The widget is automatically placed before the first body paragraph. To target a specific element instead, enter a CSS selector below. Once the preview looks right, use <strong>Download PNG</strong>.</p>
  <form id="f" method="post" action="#" autocomplete="off">
    <label for="url">Page URL</label>
    <input id="url" name="url" type="url" placeholder="https://www.example.com/news/..." required autocomplete="off" />
    <div style="margin-top: 14px;">
      <label for="cssSelector">Widget placement override <span style="text-transform:none;letter-spacing:0;color:#475569">(optional — leave empty for automatic placement)</span></label>
      <input id="cssSelector" name="cssSelector" type="text" placeholder="e.g. #article-body, .post-content > p, [data-component=&quot;text-block&quot;]" autocomplete="off"
             style="width:100%;padding:12px 14px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#f1f5f9;font-size:1rem;box-sizing:border-box;" />
      <p style="margin:6px 0 0;font-size:0.8rem;color:#64748b;line-height:1.4;">Enter a CSS selector for the element DeeperDive should appear ABOVE. Accepts IDs (<code style="color:#94a3b8">#main-content</code>), classes (<code style="color:#94a3b8">.article-body</code>), or any valid selector. If left empty, the widget is placed before the first body paragraph automatically.</p>
    </div>
    <div class="row">
      <button type="submit" id="go">Generate preview</button>
      <button type="button" class="secondary" id="dl" disabled>Download PNG</button>
    </div>
    <p class="status" id="status"></p>
    <p class="err" id="err" hidden></p>
  </form>
  <p class="hint">CLI: <code>node capture.mjs -u "https://..." -o out.png</code></p>
  <section class="preview-wrap" id="previewSection" aria-live="polite">
    <h2>Preview</h2>
    <img id="previewImg" alt="Generated mock screenshot" />
  </section>
  <script>
    const f = document.getElementById("f");
    const err = document.getElementById("err");
    const go = document.getElementById("go");
    const dl = document.getElementById("dl");
    const status = document.getElementById("status");
    const previewSection = document.getElementById("previewSection");
    const previewImg = document.getElementById("previewImg");
    let previewObjectUrl = null;

    function setPreviewFromBlob(blob) {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = URL.createObjectURL(blob);
      previewImg.src = previewObjectUrl;
      previewSection.classList.add("visible");
      dl.disabled = false;
    }

    dl.addEventListener("click", () => {
      if (!previewObjectUrl) return;
      const a = document.createElement("a");
      a.href = previewObjectUrl;
      a.download = "page-with-deeperdive.png";
      a.click();
    });

    function base64ToBlob(b64, mime) {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: mime || "image/png" });
    }

    async function runGenerate() {
      err.hidden = true;
      go.disabled = true;
      dl.disabled = true;
      previewSection.classList.remove("visible");
      previewImg.removeAttribute("src");
      status.textContent = "Generating… this can take a minute.";
      try {
        const pageUrl = document.getElementById("url").value.trim();
        const cssSelector = document.getElementById("cssSelector").value.trim() || undefined;
        const res = await fetch("/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ url: pageUrl, cssSelector }),
        });
        const ct = res.headers.get("content-type") || "";
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || res.statusText);
        }
        if (!ct.includes("application/json")) {
          throw new Error("Unexpected response — refresh the page and try again.");
        }
        const data = await res.json();
        if (!data || !data.imageBase64) {
          throw new Error("Invalid preview payload from server.");
        }
        const blob = base64ToBlob(data.imageBase64, "image/png");
        setPreviewFromBlob(blob);
        status.textContent = "Preview ready — download if it looks good.";
      } catch (x) {
        err.textContent = x.message || String(x);
        err.hidden = false;
        status.textContent = "";
        if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
      } finally {
        go.disabled = false;
      }
    }

    f.addEventListener("submit", (e) => {
      e.preventDefault();
      runGenerate();
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
			const outputPath = path.join(outDir, `capture-${stamp}.png`);

			await capturePageToPng({
				url: pageUrl,
				outputPath,
				waitUntil: "domcontentloaded",
				timeout: 30_000,
				publication: typeof body.publication === "string" ? body.publication : "Daily Star",
				cssSelector: typeof body.cssSelector === "string" ? body.cssSelector.trim() : "",
			});

			const png = readFileSync(outputPath);
			const imageBase64 = png.toString("base64");
			const payload = JSON.stringify({
				ok: true,
				imageBase64,
				filename: "page-with-deeperdive.png",
			});
			res.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Content-Length": Buffer.byteLength(payload),
				"Cache-Control": "no-store",
			});
			res.end(payload);
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
