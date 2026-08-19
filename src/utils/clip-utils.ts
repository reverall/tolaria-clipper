import Defuddle from 'defuddle/full';
import { setElementHTML } from './dom-utils';
import { stripInjectedUi } from './clipper-dom';

// Parse document content for clipping. In reader mode, extracts from
// the article's original HTML to avoid reader UI artifacts.
export function parseForClip(doc: Document) {
	const readerArticle = doc.querySelector('.tolaria-reader-active .tolaria-reader-content article');
	if (readerArticle) {
		const readerDoc = doc.implementation.createHTMLDocument();
		const originalHtml = readerArticle.getAttribute('data-original-html');
		if (originalHtml) {
			setElementHTML(readerDoc.body, originalHtml);
		} else {
			readerDoc.body.replaceChildren(
				...Array.from(readerArticle.childNodes).map(n => readerDoc.importNode(n, true))
			);
		}
		return cleanResult(new Defuddle(readerDoc, { url: '' }).parse());
	}
	return cleanResult(new Defuddle(doc, { url: doc.URL }).parse());
}

/**
 * Defuddle reads the live document, which contains the clipper's own side
 * panel. Strip it from the extracted content before anything downstream sees
 * it.
 */
function cleanResult<T extends { content: string }>(result: T): T {
	return { ...result, content: stripInjectedUi(result.content) };
}
