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

export function readHtmlPreviewHeight(data: unknown, id: string): number | null {
	if (
		typeof data !== "object" ||
		data === null ||
		!("type" in data) ||
		data.type !== "rhyza:html-preview-resize" ||
		!("id" in data) ||
		data.id !== id ||
		!("height" in data) ||
		typeof data.height !== "number" ||
		!Number.isFinite(data.height) ||
		data.height <= 0
	) {
		return null;
	}
	return Math.ceil(data.height);
}

function htmlPreviewSizingScript(id: string): string {
	const encodedId = JSON.stringify(id).replace(/</g, "\\u003c");
	return `<style>
		:root {
			overflow-y: hidden !important;
		}
		:root, :root > body {
			height: auto !important;
			min-height: 0 !important;
		}
	</style><script>
	(() => {
		const id = ${encodedId};
		let frame = 0;
		let lastHeight = 0;
		let shrinkCandidate = null;
		let stopped = false;
		const measure = () => {
			frame = 0;
			const root = document.documentElement;
			const body = document.body;
			if (!body) return;
			const rect = body.getBoundingClientRect();
			const bottomMargin = parseFloat(getComputedStyle(body).marginBottom) || 0;
			// Root scrollHeight is floored at the previous viewport height and cannot shrink.
			const contentHeight = Math.max(
				root.getBoundingClientRect().height,
				rect.bottom + window.scrollY + bottomMargin,
				rect.top + window.scrollY + body.scrollHeight
			);
			const scrollbarHeight = Math.max(0, window.innerHeight - root.clientHeight);
			const height = Math.max(1, Math.ceil(contentHeight + scrollbarHeight));
			// Resize handlers can temporarily remove footer space while the page reflows.
			if (height < lastHeight - 1) {
				if (shrinkCandidate?.height !== height) {
					shrinkCandidate = { height, startedAt: performance.now(), frames: 0 };
				}
				shrinkCandidate.frames++;
				if (shrinkCandidate.frames < 6 || performance.now() - shrinkCandidate.startedAt < 150) {
					schedule();
					return;
				}
			}
			shrinkCandidate = null;
			// Keep the larger pixel when fractional layout rounds back and forth.
			if (height <= lastHeight && lastHeight - height <= 1) return;
			lastHeight = height;
			parent.postMessage({ type: "rhyza:html-preview-resize", id, height }, "*");
		};
		const schedule = () => {
			if (!stopped && !frame) frame = requestAnimationFrame(measure);
		};
		const requestMeasure = (event) => {
			if (
				event.source !== parent ||
				event.data?.type !== "rhyza:html-preview-measure" ||
				event.data.id !== id
			) return;
			lastHeight = 0;
			schedule();
		};
		const start = () => {
			const resizeObserver = new ResizeObserver(schedule);
			resizeObserver.observe(document.documentElement);
			if (document.body) resizeObserver.observe(document.body);
			const mutationObserver = new MutationObserver(schedule);
			mutationObserver.observe(document.documentElement, {
				attributes: true,
				childList: true,
				subtree: true,
				characterData: true
			});
			window.addEventListener("resize", schedule);
			window.addEventListener("message", requestMeasure);
			document.addEventListener("load", schedule, true);
			document.fonts.ready.then(schedule);
			window.addEventListener("pagehide", () => {
				stopped = true;
				cancelAnimationFrame(frame);
				resizeObserver.disconnect();
				mutationObserver.disconnect();
				window.removeEventListener("resize", schedule);
				window.removeEventListener("message", requestMeasure);
				document.removeEventListener("load", schedule, true);
			}, { once: true });
			schedule();
		};
		document.addEventListener("DOMContentLoaded", start, { once: true });
	})();
	</script>`;
}

/** The iframe has an opaque origin and cannot use the host bridge or network. */
export function sandboxHtmlDocument(html: string, resizeId?: string): string {
	const policy =
		"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
	// Put CSP before any supplied content, even when the document omits <head>.
	return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">${resizeId ? htmlPreviewSizingScript(resizeId) : ""}${html}`;
}
