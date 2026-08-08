import { AlertCircle, Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

let mermaidInitialized = false;
const mermaidSvgCache = new Map<string, string>();
const maxCachedDiagrams = 100;

export function MermaidDiagram({ source, onSvgRendered }: { source: string; onSvgRendered?: (svg: string) => void }) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const reactId = useId();
	const normalizedSource = source.trim();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(() => !mermaidSvgCache.has(normalizedSource));
	const [previewOpen, setPreviewOpen] = useState(false);
	const [previewScale, setPreviewScale] = useState(1);
	const [renderedSvg, setRenderedSvg] = useState(() => mermaidSvgCache.get(normalizedSource) ?? "");

	useLayoutEffect(() => {
		const cachedSvg = mermaidSvgCache.get(normalizedSource);
		if (!hostRef.current) return;
		if (cachedSvg) {
			hostRef.current.innerHTML = cachedSvg;
			setRenderedSvg(cachedSvg);
			setError(null);
			setLoading(false);
			onSvgRendered?.(cachedSvg);
		} else {
			hostRef.current.innerHTML = "";
			setRenderedSvg("");
			setError(null);
			setLoading(true);
		}
	}, [normalizedSource, onSvgRendered]);

	useEffect(() => {
		if (!previewOpen) return;
		const previousOverflow = document.body.style.overflow;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setPreviewOpen(false);
		};
		document.body.style.overflow = "hidden";
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [previewOpen]);

	useEffect(() => {
		if (mermaidSvgCache.has(normalizedSource)) return;
		let cancelled = false;
		const render = async () => {
			setLoading(true);
			setError(null);
			try {
				const { default: mermaid } = await import("mermaid");
				if (!mermaidInitialized) {
					mermaid.initialize({
						startOnLoad: false,
						securityLevel: "strict",
						theme: "base",
						themeVariables: {
							primaryColor: "#f8fafc",
							primaryTextColor: "#0f172a",
							primaryBorderColor: "#94a3b8",
							lineColor: "#64748b",
							secondaryColor: "#eef2ff",
							tertiaryColor: "#f1f5f9",
							fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
						},
						flowchart: { curve: "basis", htmlLabels: true },
					});
					mermaidInitialized = true;
				}
				const diagramId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}`;
				const { svg, bindFunctions } = await mermaid.render(diagramId, normalizedSource);
				cacheRenderedSvg(normalizedSource, svg);
				setRenderedSvg(svg);
				if (cancelled || !hostRef.current) return;
				hostRef.current.innerHTML = svg;
				bindFunctions?.(hostRef.current);
				onSvgRendered?.(svg);
			} catch (renderError) {
				if (!cancelled) {
					setError(renderError instanceof Error ? renderError.message : "Unable to render this diagram.");
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		};

		void render();
		return () => {
			cancelled = true;
		};
	}, [normalizedSource, onSvgRendered, reactId]);

	const openPreview = () => {
		if (!loading && !error && renderedSvg) {
			setPreviewScale(1);
			setPreviewOpen(true);
		}
	};

	return (
		<>
		<figure className="mermaid-diagram mermaid-diagram-interactive" role="button" tabIndex={0} aria-label="Open enlarged diagram preview" onClick={openPreview} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPreview(); } }}>
			<div className="mermaid-diagram-label">Diagram</div>
			{!loading && !error && <Maximize2 size={15} className="mermaid-diagram-expand" aria-hidden="true" />}
			{loading ? (
				<div className="mermaid-diagram-state"><RotateCcw size={16} className="animate-spin" /> Rendering diagram</div>
			) : error ? (
				<div className="mermaid-diagram-error">
					<div><AlertCircle size={16} /> Diagram syntax could not be rendered</div>
					<details>
						<summary>Show source</summary>
						<pre><code>{source}</code></pre>
					</details>
				</div>
			) : null}
			<div ref={hostRef} className={loading || error ? "hidden" : "mermaid-diagram-canvas"} />
		</figure>
		{previewOpen && createPortal(
			<div className="mermaid-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}>
				<section className="mermaid-preview-dialog" role="dialog" aria-modal="true" aria-label="Enlarged diagram preview">
					<header className="mermaid-preview-toolbar">
						<span className="font-semibold text-sm">Diagram preview</span>
						<div className="flex items-center gap-1">
							<button type="button" className="icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => setPreviewScale((scale) => Math.max(0.5, scale - 0.25))}><Minus size={17} /></button>
							<button type="button" className="mermaid-preview-scale" title="Reset zoom" onClick={() => setPreviewScale(1)}>{Math.round(previewScale * 100)}%</button>
							<button type="button" className="icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => setPreviewScale((scale) => Math.min(3, scale + 0.25))}><Plus size={17} /></button>
							<button type="button" className="icon-button" title="Close preview" aria-label="Close preview" onClick={() => setPreviewOpen(false)}><X size={18} /></button>
						</div>
					</header>
					<div className="mermaid-preview-scroll">
						<div className="mermaid-preview-canvas" style={{ zoom: previewScale }} dangerouslySetInnerHTML={{ __html: renderedSvg }} />
					</div>
				</section>
			</div>,
			document.body,
		)}
		</>
	);
}

function cacheRenderedSvg(source: string, svg: string): void {
	if (!mermaidSvgCache.has(source) && mermaidSvgCache.size >= maxCachedDiagrams) {
		const oldestKey = mermaidSvgCache.keys().next().value as string | undefined;
		if (oldestKey) mermaidSvgCache.delete(oldestKey);
	}
	mermaidSvgCache.set(source, svg);
}
