import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Expand, X } from "lucide-react";
import {
	htmlPreviewReferenceKey,
	parseHtmlPreviewReference,
	readHtmlPreviewHeight,
	sandboxHtmlDocument,
	type HtmlPreviewDocument,
} from "../shared/html-preview";

export function HtmlPreviewReference({
	source,
	documents = [],
	finalized = true,
}: {
	source: string;
	documents?: HtmlPreviewDocument[];
	finalized?: boolean;
}) {
	try {
		const reference = parseHtmlPreviewReference(source);
		const key = htmlPreviewReferenceKey(reference);
		const document = documents.find((item) => htmlPreviewReferenceKey(item) === key);
		if (document?.html !== undefined)
			return (
				<HtmlPreview
					html={document.html}
					previewHtml={document.previewHtml}
					previewError={document.previewError}
					title={reference.title ?? "HTML preview"}
				/>
			);
		return (
			<div className="html-preview-state">
				<strong>{reference.title ?? "HTML preview"}</strong>
				<p>
					{!finalized
						? "Preparing preview…"
						: (document?.error ?? "The HTML file was not attached to this response.")}
				</p>
				<code>{reference.path}</code>
			</div>
		);
	} catch {
		return (
			<pre>
				<code>{source}</code>
			</pre>
		);
	}
}

function HtmlPreviewFrame({
	html,
	title,
	autoSize = false,
}: {
	html: string;
	title: string;
	autoSize?: boolean;
}) {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const source = useMemo(() => {
		const id = autoSize ? crypto.randomUUID() : undefined;
		return { id, html: sandboxHtmlDocument(html, id) };
	}, [html, autoSize]);
	const [measurement, setMeasurement] = useState<{ id: string; height: number } | null>(null);
	const requestMeasure = () => {
		if (!source.id) return;
		frameRef.current?.contentWindow?.postMessage(
			{ type: "rhyza:html-preview-measure", id: source.id },
			"*",
		);
	};
	useEffect(() => {
		const id = source.id;
		if (!id) return;
		const resize = (event: MessageEvent<unknown>) => {
			if (event.source !== frameRef.current?.contentWindow) return;
			const height = readHtmlPreviewHeight(event.data, id);
			if (height !== null) {
				setMeasurement((previous) =>
					previous?.id === id && previous.height === height ? previous : { id, height },
				);
			}
		};
		window.addEventListener("message", resize);
		frameRef.current?.contentWindow?.postMessage({ type: "rhyza:html-preview-measure", id }, "*");
		return () => window.removeEventListener("message", resize);
	}, [source]);
	return (
		<iframe
			ref={frameRef}
			title={title}
			srcDoc={source.html}
			style={
				autoSize ? { height: measurement?.id === source.id ? measurement?.height : 150 } : undefined
			}
			onLoad={requestMeasure}
			sandbox="allow-scripts allow-downloads"
			referrerPolicy="no-referrer"
		/>
	);
}

export function HtmlPreview({
	html,
	previewHtml,
	previewError,
	title = "HTML preview",
}: {
	html: string;
	previewHtml?: string;
	previewError?: string;
	title?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	useEffect(() => {
		if (!expanded) return;
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape") setExpanded(false);
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [expanded]);
	const download = () => {
		const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${title.replace(/[^\p{L}\p{N}_-]+/gu, "-") || "preview"}.html`;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};
	return (
		<>
			<section className="html-preview">
				<header>
					<strong>{title}</strong>
					<button
						type="button"
						className="icon-button"
						aria-label="Download HTML"
						onClick={download}
					>
						<Download size={16} />
					</button>
					<button
						type="button"
						className="icon-button"
						aria-label="Expand HTML preview"
						onClick={() => setExpanded(true)}
					>
						<Expand size={16} />
					</button>
				</header>
				{previewError !== undefined && (
					<div className="html-preview-state" role="status">
						Compact preview unavailable. Showing the full HTML document. {previewError}
					</div>
				)}
				<HtmlPreviewFrame
					html={previewError === undefined ? (previewHtml ?? html) : html}
					title={title}
					autoSize
				/>
			</section>
			{expanded &&
				createPortal(
					<div
						className="html-preview-backdrop"
						onMouseDown={(event) => {
							if (event.target === event.currentTarget) setExpanded(false);
						}}
					>
						<section
							className="html-preview-dialog"
							role="dialog"
							aria-modal="true"
							aria-label={title}
						>
							<header>
								<strong>{title}</strong>
								<button
									type="button"
									className="icon-button"
									aria-label="Close HTML preview"
									autoFocus
									onClick={() => setExpanded(false)}
								>
									<X size={18} />
								</button>
							</header>
							<HtmlPreviewFrame html={html} title={title} />
						</section>
					</div>,
					document.body,
				)}
		</>
	);
}
