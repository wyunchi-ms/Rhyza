import { AlertCircle, Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useState } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import { useAppStore } from "../store";

const mermaidSvgCache = new Map<string, string>();
const mermaidRenderPromises = new Map<string, Promise<string>>();
let mermaidRenderQueue: Promise<void> = Promise.resolve();
const maxCachedDiagrams = 100;

export function MermaidDiagram({
	source,
	onSvgRendered,
}: {
	source: string;
	onSvgRendered?: (svg: string) => void;
}) {
	const reactId = useId();
	const normalizedSource = source.trim();
	const theme = useAppStore((state) => state.settings.theme);
	const highContrast = useAppStore((state) => state.settings.highContrast);
	const fontScale = useAppStore((state) => state.settings.fontScale);
	const cacheKey = `${theme}:${highContrast}:${fontScale}:${normalizedSource}`;
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(() => !mermaidSvgCache.has(cacheKey));
	const [previewOpen, setPreviewOpen] = useState(false);
	const [previewScale, setPreviewScale] = useState(1);
	const [renderedSvg, setRenderedSvg] = useState(() => mermaidSvgCache.get(cacheKey) ?? "");
	const dialogRef = useModalDialog(previewOpen, () => setPreviewOpen(false));

	useLayoutEffect(() => {
		const cachedSvg = mermaidSvgCache.get(cacheKey);
		if (cachedSvg) {
			setRenderedSvg(cachedSvg);
			setError(null);
			setLoading(false);
			onSvgRendered?.(cachedSvg);
		} else {
			setRenderedSvg("");
			setError(null);
			setLoading(true);
		}
	}, [cacheKey, onSvgRendered]);

	useEffect(() => {
		if (mermaidSvgCache.has(cacheKey)) return;
		let cancelled = false;
		const render = async () => {
			setLoading(true);
			setError(null);
			try {
				const diagramId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}`;
				const styles = getComputedStyle(document.documentElement);
				const color = (name: string) => styles.getPropertyValue(name).trim();
				const palette = {
					darkMode: theme === "dark",
					primaryColor: color("--color-surface"),
					primaryTextColor: color("--color-primary"),
					primaryBorderColor: color("--ui-border"),
					lineColor: color("--color-secondary"),
					secondaryColor: color("--ui-brand-soft"),
					tertiaryColor: color("--ui-surface-muted"),
					fontFamily: getComputedStyle(document.body).fontFamily,
					fontSize: `${14 * fontScale}px`,
				};
				const svg = await renderMermaidSvg(normalizedSource, diagramId, cacheKey, palette);
				if (cancelled) return;
				setRenderedSvg(svg);
				onSvgRendered?.(svg);
			} catch (renderError) {
				if (!cancelled) {
					setError(
						renderError instanceof Error ? renderError.message : "Unable to render this diagram.",
					);
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		};

		const frame = requestAnimationFrame(() => void render());
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
		};
	}, [cacheKey, normalizedSource, onSvgRendered, reactId, theme, fontScale]);

	const openPreview = () => {
		if (!loading && !error && renderedSvg) {
			setPreviewScale(1);
			setPreviewOpen(true);
		}
	};

	return (
		<>
			<figure
				className="mermaid-diagram mermaid-diagram-interactive"
				role="button"
				tabIndex={0}
				aria-label="Open enlarged diagram preview"
				onClick={openPreview}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						openPreview();
					}
				}}
			>
				<div className="mermaid-diagram-label">Diagram</div>
				{!loading && !error && (
					<Maximize2 size={15} className="mermaid-diagram-expand" aria-hidden="true" />
				)}
				{loading ? (
					<div className="mermaid-diagram-state">
						<RotateCcw size={16} className="animate-spin" /> Rendering diagram
					</div>
				) : error ? (
					<div className="mermaid-diagram-error">
						<div>
							<AlertCircle size={16} /> Diagram syntax could not be rendered
						</div>
						<details>
							<summary>Show source</summary>
							<pre>
								<code>{source}</code>
							</pre>
						</details>
					</div>
				) : null}
				<div
					className={loading || error ? "hidden" : "mermaid-diagram-canvas"}
					dangerouslySetInnerHTML={{ __html: renderedSvg }}
				/>
			</figure>
			{previewOpen &&
				createPortal(
					<div
						className="mermaid-preview-backdrop"
						role="presentation"
						onMouseDown={(event) => {
							if (event.target === event.currentTarget) setPreviewOpen(false);
						}}
					>
						<dialog
							ref={dialogRef}
							className="ui-modal-dialog mermaid-preview-dialog"
							aria-modal="true"
							aria-label="Enlarged diagram preview"
						>
							<header className="mermaid-preview-toolbar">
								<span className="font-semibold text-sm">Diagram preview</span>
								<div className="flex items-center gap-1">
									<button
										type="button"
										className="icon-button"
										title="Zoom out"
										aria-label="Zoom out"
										onClick={() => setPreviewScale((scale) => Math.max(0.5, scale - 0.25))}
									>
										<Minus size={17} />
									</button>
									<button
										type="button"
										className="mermaid-preview-scale"
										title="Reset zoom"
										onClick={() => setPreviewScale(1)}
									>
										{Math.round(previewScale * 100)}%
									</button>
									<button
										type="button"
										className="icon-button"
										title="Zoom in"
										aria-label="Zoom in"
										onClick={() => setPreviewScale((scale) => Math.min(3, scale + 0.25))}
									>
										<Plus size={17} />
									</button>
									<button
										type="button"
										className="icon-button"
										title="Close preview"
										aria-label="Close preview"
										onClick={() => setPreviewOpen(false)}
									>
										<X size={18} />
									</button>
								</div>
							</header>
							<div className="mermaid-preview-scroll">
								<div
									className="mermaid-preview-canvas"
									style={{ zoom: previewScale }}
									dangerouslySetInnerHTML={{ __html: renderedSvg }}
								/>
							</div>
						</dialog>
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

function renderMermaidSvg(
	source: string,
	diagramId: string,
	cacheKey: string,
	themeVariables: {
		darkMode: boolean;
		primaryColor: string;
		primaryTextColor: string;
		primaryBorderColor: string;
		lineColor: string;
		secondaryColor: string;
		tertiaryColor: string;
		fontFamily: string;
		fontSize: string;
	},
): Promise<string> {
	const cached = mermaidSvgCache.get(cacheKey);
	if (cached) return Promise.resolve(cached);
	const pending = mermaidRenderPromises.get(cacheKey);
	if (pending) return pending;

	const renderPromise = mermaidRenderQueue.then(async () => {
		const { default: mermaid } = await import("mermaid");
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: "base",
			themeVariables,
			flowchart: { curve: "basis", htmlLabels: true },
		});
		const { svg } = await mermaid.render(diagramId, source);
		cacheRenderedSvg(cacheKey, svg);
		return svg;
	});
	mermaidRenderQueue = renderPromise.then(
		() => undefined,
		() => undefined,
	);
	mermaidRenderPromises.set(cacheKey, renderPromise);
	void renderPromise
		.finally(() => {
			if (mermaidRenderPromises.get(cacheKey) === renderPromise)
				mermaidRenderPromises.delete(cacheKey);
		})
		.catch(() => undefined);
	return renderPromise;
}
