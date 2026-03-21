/**
 * Static HTML/CSS for the DeeperDive “What You Need To Know” widget (mock).
 * Tweak copy via options for different publications.
 */
export function buildWidgetMarkup(options = {}) {
	const {
		publication = "Daily Star",
		summary =
			"Royal Air Philippines has entered administration and cancelled all commercial flights, leaving thousands of passengers stranded",
		question1 = "Why did Royal Air Philippines suspend flights?",
		question2 = "How did reduced Chinese arrivals affect airlines?",
		interestQuestion = "What are the latest developments in this story?",
		askPlaceholder = null,
		title = "What You Need To Know",
		readMore = "Read more",
		interestsLabel = "Based on your interests",
	} = options;

	const ask = askPlaceholder ?? `Ask ${publication} anything`;

	return `
<div id="deeperdive-mock-widget-host" class="dd-mock-root" data-deeperdive-mock="1">
<style>
.dd-mock-root {
  display: block;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  margin: 20px 0 24px;
  padding: 0;
  clear: both;
  line-height: normal;
}
.dd-mock-root *, .dd-mock-root *::before, .dd-mock-root *::after { box-sizing: border-box; }
.dd-mock-card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: #ffffff;
  color: #111111;
  border: none;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: none;
}
.dd-mock-readmore,
.dd-mock-info,
.dd-mock-bar,
.dd-mock-bar * {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
}
.dd-mock-section { padding: 16px 18px; }
.dd-mock-headline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.dd-mock-title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.dd-mock-info {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid #c4c4c4;
  color: #888888;
  font-size: 11px;
  font-weight: 600;
  font-style: italic;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.dd-mock-summary-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.dd-mock-summary {
  flex: 1 1 220px;
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
  color: #111111;
  position: relative;
  max-height: 4.35em;
  overflow: hidden;
}
.dd-mock-summary::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  width: 40%;
  height: 1.45em;
  background: linear-gradient(to right, rgba(255,255,255,0), #ffffff 65%);
  pointer-events: none;
}
.dd-mock-readmore {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #E60023;
  color: #ffffff !important;
  text-decoration: none !important;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 18px;
  border-radius: 999px;
  white-space: nowrap;
  border: none;
  cursor: default;
}
.dd-mock-readmore span { font-size: 16px; line-height: 1; }
.dd-mock-divider { height: 1px; background: #eeeeee; margin: 0; border: 0; }
.dd-mock-link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  font-size: 15px;
  line-height: 1.35;
  color: #111111;
  text-decoration: none !important;
  cursor: default;
}
.dd-mock-link-row:hover { background: #fafafa; }
.dd-mock-link-text { flex: 1; }
.dd-mock-chevron { font-size: 18px; color: #111111; flex-shrink: 0; }
.dd-mock-interests-label {
  font-weight: 700;
  display: block;
  margin-bottom: 6px;
  font-size: 15px;
}
.dd-mock-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 18px 18px;
  padding: 10px 12px 10px 16px;
  border: 1.5px solid #111111;
  border-radius: 999px;
  background: #ffffff;
}
.dd-mock-brand {
  font-size: 15px;
  color: #111111;
  white-space: nowrap;
  font-weight: 400;
}
.dd-mock-brand-bold {
  font-weight: 700;
}
.dd-mock-bar-sep {
  width: 1px;
  height: 22px;
  background: #d0d0d0;
  flex-shrink: 0;
}
.dd-mock-bar-placeholder {
  flex: 1;
  font-size: 15px;
  color: #888888;
  min-width: 0;
}
.dd-mock-submit {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: #E60023;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 18px;
  flex-shrink: 0;
  cursor: default;
}
</style>
<div class="dd-mock-card">
  <div class="dd-mock-section">
    <div class="dd-mock-headline">
      <span class="dd-mock-title">${escapeHtml(title)}</span>
      <span class="dd-mock-info" title="Info">i</span>
    </div>
    <div class="dd-mock-summary-row">
      <p class="dd-mock-summary">${escapeHtml(summary)}</p>
      <a class="dd-mock-readmore" role="button">${escapeHtml(readMore)} <span aria-hidden="true">→</span></a>
    </div>
  </div>
  <hr class="dd-mock-divider" />
  <div class="dd-mock-link-row" role="button">
    <span class="dd-mock-link-text">${escapeHtml(question1)}</span>
    <span class="dd-mock-chevron" aria-hidden="true">›</span>
  </div>
  <hr class="dd-mock-divider" />
  <div class="dd-mock-link-row" role="button">
    <span class="dd-mock-link-text">${escapeHtml(question2)}</span>
    <span class="dd-mock-chevron" aria-hidden="true">›</span>
  </div>
  <hr class="dd-mock-divider" />
  <div class="dd-mock-link-row" role="button">
    <span class="dd-mock-link-text">
      <span class="dd-mock-interests-label">${escapeHtml(interestsLabel)}</span>
      ${escapeHtml(interestQuestion)}
    </span>
    <span class="dd-mock-chevron" aria-hidden="true">›</span>
  </div>
  <div class="dd-mock-bar" role="search">
    <span class="dd-mock-brand"><span class="dd-mock-brand-bold">Deeper</span>Dive</span>
    <span class="dd-mock-bar-sep" aria-hidden="true"></span>
    <span class="dd-mock-bar-placeholder">${escapeHtml(ask)}</span>
    <button type="button" class="dd-mock-submit" aria-label="Submit">→</button>
  </div>
</div>
</div>`;
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
