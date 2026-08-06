// Identifiers for the UI this extension injects into a page, and removal of
// injected UI from extracted content.
//
// Ids are namespaced so the upstream Obsidian Web Clipper can be installed
// alongside this one without the two fighting over the same nodes.

export const CLIPPER_CONTAINER_ID = 'tolaria-clipper-container';
export const CLIPPER_IFRAME_ID = 'tolaria-clipper-iframe';

/**
 * Elements that are browser-extension UI rather than page content.
 *
 * Defuddle is handed the live document, so without this the side panel's own
 * `<iframe src="chrome-extension://…/side-panel.html?context=iframe">` is
 * captured as part of the page — which is exactly how it ended up in clipped
 * notes. The extension-scheme selectors also catch UI injected by *other*
 * extensions, a long-standing source of junk at the end of clips.
 */
const INJECTED_SELECTORS = [
	`#${CLIPPER_CONTAINER_ID}`,
	`#${CLIPPER_IFRAME_ID}`,
	// Legacy ids, so pages still carrying an older build's UI clip cleanly.
	'#obsidian-clipper-container',
	'#obsidian-clipper-iframe',
	'[src^="chrome-extension://"]',
	'[src^="moz-extension://"]',
	'[src^="safari-web-extension://"]',
];

/**
 * Remove injected extension UI from a fragment of extracted HTML.
 *
 * Applied after parsing rather than by detaching nodes from the live document:
 * re-inserting an `<iframe>` reloads it, and in embedded mode that iframe is
 * the very panel driving the clip.
 *
 * Returns the input unchanged if it contains nothing to strip, so the common
 * case costs one substring check.
 */
export function stripInjectedUi(html: string): string {
	if (!html || !containsInjectedUi(html)) return html;

	try {
		const parsed = new DOMParser().parseFromString(html, 'text/html');
		let removed = false;

		for (const selector of INJECTED_SELECTORS) {
			for (const node of Array.from(parsed.body.querySelectorAll(selector))) {
				node.remove();
				removed = true;
			}
		}

		return removed ? parsed.body.innerHTML : html;
	} catch {
		// Never let sanitisation lose a clip.
		return html;
	}
}

function containsInjectedUi(html: string): boolean {
	return html.includes('-extension://')
		|| html.includes('clipper-container')
		|| html.includes('clipper-iframe');
}
