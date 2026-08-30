import { AlertTriangle, Expand, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getKnowbranchBridge } from "../hooks/useKnowbranchBridge";
import type { ArchifyRenderResponse } from "../shared/ipc";
import { archifyToMermaid, parseArchifySource } from "../shared/archify";
import { prepareArchifyViewerHtml } from "../shared/archify-viewer";
import { useAppStore } from "../store";
import { MermaidDiagram } from "./MermaidDiagram";

export function ArchifyDiagram({ source, onHtmlRendered }: { source: string; onHtmlRendered?: (html: string) => void }) {
	const enabled = useAppStore((state) => state.settings.diagramRenderer === "archify");
	const theme = useAppStore((state) => state.settings.theme);
	const [result, setResult] = useState<ArchifyRenderResponse>();
	const [expanded, setExpanded] = useState(false);
	const [inlineHeight, setInlineHeight] = useState(460);
	const inlineContainerRef = useRef<HTMLDivElement>(null);
	const inlineFrameRef = useRef<HTMLIFrameElement>(null);
	const lastInlineWidth = useRef(0);
	const parsed = useMemo(() => {
		try {
			return { value: parseArchifySource(source) } as const;
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) } as const;
		}
	}, [source]);
	const fallbackMermaid = useMemo(() => {
		try {
			return archifyToMermaid(source);
		} catch {
			return "";
		}
	}, [source]);

	useEffect(() => {
		if (!enabled || !("value" in parsed)) return;
		const bridge = getKnowbranchBridge();
		if (!bridge) {
			setResult({ ok: false, error: "Interactive Archify rendering requires the Electron desktop runtime.", fallbackMermaid });
			return;
		}
		let canceled = false;
		setResult(undefined);
		setInlineHeight(460);
		void bridge.renderArchify({ source }).then((response) => {
			if (canceled) return;
			setResult(response);
			if (response.ok && response.html) onHtmlRendered?.(response.html);
		});
		return () => { canceled = true; };
	}, [enabled, fallbackMermaid, onHtmlRendered, parsed, source]);

	useEffect(() => {
		if (!expanded) return;
		const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [expanded]);

	useEffect(() => {
		const receiveSize = (event: MessageEvent) => {
			if (event.source !== inlineFrameRef.current?.contentWindow) return;
			const message = event.data as { type?: unknown; mode?: unknown; height?: unknown } | null;
			if (!message || message.type !== "rhyza:archify-size" || message.mode !== "inline" || typeof message.height !== "number" || !Number.isFinite(message.height)) return;
			const height = Math.max(280, Math.ceil(message.height));
			setInlineHeight((current) => Math.abs(current - height) > 6 ? height : current);
		};
		window.addEventListener("message", receiveSize);
		return () => window.removeEventListener("message", receiveSize);
	}, []);

	useEffect(() => {
		const container = inlineContainerRef.current;
		if (!container || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => {
			const width = entry.contentRect.width;
			if (Math.abs(lastInlineWidth.current - width) <= 1) return;
			lastInlineWidth.current = width;
			inlineFrameRef.current?.contentWindow?.postMessage({ type: "rhyza:archify-measure" }, "*");
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, [result?.html]);

	if (!("value" in parsed)) return <ArchifyFallback source={fallbackMermaid} error={parsed.error} />;
	if (!enabled) return <ArchifyFallback source={fallbackMermaid} message="Mermaid is selected in Settings; showing the Mermaid version." />;
	if (!result) return <div className="archify-diagram archify-diagram-state"><LoaderCircle size={17} className="animate-spin" /><span>Validating and rendering interactive diagram…</span></div>;
	if (!result.ok || !result.html) return <ArchifyFallback source={result.fallbackMermaid ?? fallbackMermaid} error={result.error ?? "Archify rendering failed."} />;
	const diagram = parsed.value!;
	const inlineHtml = prepareArchifyViewerHtml(result.html, { theme, mode: "inline" });
	const expandedHtml = prepareArchifyViewerHtml(result.html, { theme, mode: "expanded" });

	return <>
		<div ref={inlineContainerRef} className="archify-diagram">
			<button type="button" className="archify-diagram-expand" title="Open full-screen diagram" aria-label="Open full-screen diagram" onClick={() => setExpanded(true)}><Expand size={15} /></button>
			<iframe ref={inlineFrameRef} title={diagram.title ?? "Interactive Archify diagram"} srcDoc={inlineHtml} style={{ height: inlineHeight }} scrolling="no" sandbox="allow-scripts allow-downloads allow-modals" />
		</div>
		{expanded && createPortal(<div className="archify-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}>
			<section className="archify-preview-dialog" role="dialog" aria-modal="true" aria-label={diagram.title ?? "Interactive Archify diagram"}>
				<header><div><strong>{diagram.title ?? "Interactive diagram"}</strong><span>Archify · {diagram.type}</span></div><button type="button" title="Close" aria-label="Close" onClick={() => setExpanded(false)}><X size={18} /></button></header>
				<iframe title={`${diagram.title ?? "Interactive Archify diagram"} full screen`} srcDoc={expandedHtml} sandbox="allow-scripts allow-downloads allow-modals" />
			</section>
		</div>, document.body)}
	</>;
}

function ArchifyFallback({ source, error, message }: { source: string; error?: string; message?: string }) {
	const recovered = Boolean(error && source);
	return <div className="archify-fallback">
		<div className={error && !recovered ? "archify-fallback-note is-error" : "archify-fallback-note"}>{error ? <AlertTriangle size={14} /> : null}<span>{recovered ? "This response used an incompatible Archify specification; showing its Mermaid fallback." : error ? "Archify could not render this specification." : message}</span>{error && <details><summary>Details</summary><pre>{error}</pre></details>}</div>
		{source ? <MermaidDiagram source={source} /> : <pre className="archify-source-error">No valid diagram fallback is available.</pre>}
	</div>;
}
