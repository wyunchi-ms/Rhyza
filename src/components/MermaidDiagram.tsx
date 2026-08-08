import { AlertCircle, LoaderCircle } from "lucide-react";
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

	useLayoutEffect(() => {
		const cachedSvg = mermaidSvgCache.get(normalizedSource);
		if (!hostRef.current) return;
		if (cachedSvg) {
			hostRef.current.innerHTML = cachedSvg;
			setError(null);
			setLoading(false);
			onSvgRendered?.(cachedSvg);
		} else {
			hostRef.current.innerHTML = "";
			setError(null);
			setLoading(true);
		}
	}, [normalizedSource, onSvgRendered]);

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

	return (
		<figure className="mermaid-diagram">
			<div className="mermaid-diagram-label">Diagram</div>
			{loading ? (
				<div className="mermaid-diagram-state"><LoaderCircle size={16} className="animate-spin" /> Rendering diagram</div>
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
	);
}

function cacheRenderedSvg(source: string, svg: string): void {
	if (!mermaidSvgCache.has(source) && mermaidSvgCache.size >= maxCachedDiagrams) {
		const oldestKey = mermaidSvgCache.keys().next().value as string | undefined;
		if (oldestKey) mermaidSvgCache.delete(oldestKey);
	}
	mermaidSvgCache.set(source, svg);
}
