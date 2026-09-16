/** An explicit, provider-neutral Markdown attachment declaration. */
export interface HtmlPreviewReference {
	version: 1;
	path: string;
	title?: string;
}

/** Persisted with the response so previews survive file deletion and extension removal. */
export interface HtmlPreviewDocument extends HtmlPreviewReference {
	html?: string;
	error?: string;
}

export function isHtmlPreviewBlock(className?: string): boolean {
	return /(?:^|\s)language-html-preview(?:\s|$)/i.test(className ?? "");
}

export function parseHtmlPreviewReference(source: string): HtmlPreviewReference {
	const value = JSON.parse(source);
	if (
		!value ||
		value.version !== 1 ||
		typeof value.path !== "string" ||
		!value.path.trim() ||
		value.path.length > 2048 ||
		/[\u0000-\u001f]/.test(value.path) ||
		(value.title !== undefined && (typeof value.title !== "string" || value.title.length > 200))
	) {
		throw new Error(
			"Invalid HTML preview reference. Expected version 1, path, and optional title.",
		);
	}
	return { version: 1, path: value.path, ...(value.title ? { title: value.title } : {}) };
}

export function extractHtmlPreviewReferences(markdown: string): HtmlPreviewReference[] {
	const references = new Map<string, HtmlPreviewReference>();
	for (const match of markdown.matchAll(
		/^```html-preview[^\S\r\n]*\r?\n([\s\S]*?)^```[ \t]*$/gim,
	)) {
		try {
			const reference = parseHtmlPreviewReference(match[1]);
			if (!references.has(reference.path)) references.set(reference.path, reference);
		} catch {
			// Invalid declarations remain visible as source instead of failing the response.
		}
	}
	return [...references.values()].slice(0, 8);
}

/** The iframe has an opaque origin and cannot use the host bridge or network. */
export function sandboxHtmlDocument(html: string): string {
	const policy =
		"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
	// Put CSP before any supplied content, even when the document omits <head>.
	return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">${html}`;
}
