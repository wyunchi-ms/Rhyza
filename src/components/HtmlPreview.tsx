import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Expand, X } from "lucide-react";
import {
	parseHtmlPreviewReference,
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
		const document = documents.find((item) => item.path === reference.path);
		if (document?.html !== undefined)
			return <HtmlPreview html={document.html} title={reference.title ?? "HTML preview"} />;
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

export function HtmlPreview({ html, title = "HTML preview" }: { html: string; title?: string }) {
	const [expanded, setExpanded] = useState(false);
	const source = useMemo(() => sandboxHtmlDocument(html), [html]);
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
	const frame = (
		<iframe
			title={title}
			srcDoc={source}
			sandbox="allow-scripts allow-downloads"
			referrerPolicy="no-referrer"
		/>
	);
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
				{frame}
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
							{frame}
						</section>
					</div>,
					document.body,
				)}
		</>
	);
}
