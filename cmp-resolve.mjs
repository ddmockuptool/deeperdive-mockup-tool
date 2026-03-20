/**
 * Fast CMP consent + cleanup. One pass of clicks, one cleanup, move on.
 */

import {
	dismissOverlays,
	tryClickConsentButtons,
	tryClickConsentInIframes,
	clickConsentByVisibleText,
	tryClickConsentIframeRegions,
	tryKeyboardDismiss,
} from "./overlays.mjs";

/**
 * Single fast consent + cleanup pass.
 * @param {import('puppeteer').Page} page
 */
async function consentAndClean(page) {
	await tryClickConsentButtons(page);
	await tryClickConsentInIframes(page);
	await clickConsentByVisibleText(page);
	await tryKeyboardDismiss(page);
	await dismissOverlays(page);
}

/**
 * Wait a short beat for CMP to appear, consent once, clean up, move on.
 * No polling loop, no network idle wait.
 * @param {import('puppeteer').Page} page
 */
export async function waitUntilCmpResolvedAndSettled(page) {
	await new Promise((r) => setTimeout(r, 1500));
	await consentAndClean(page);
	await new Promise((r) => setTimeout(r, 500));
	await tryClickConsentIframeRegions(page);
	await consentAndClean(page);
	await new Promise((r) => setTimeout(r, 300));
	await dismissOverlays(page);
}
