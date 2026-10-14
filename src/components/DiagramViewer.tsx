import { Download, FileCode2, FileImage, Image as ImageIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Diagram } from "../types";
import { MermaidDiagram } from "./MermaidDiagram";
import { DiagramTypeIcon } from "./DiagramTypeIcon";
import { navigateMenu, useFloatingMenu } from "../hooks/useFloatingMenu";
import { errorToMessage } from "../shared/value";
import { useTranslation } from "../i18n";

export function DiagramViewer({
	diagram,
	compact = false,
	showHeader = true,
}: {
	diagram: Diagram;
	compact?: boolean;
	showHeader?: boolean;
}) {
	const [rendered, setRendered] = useState<{ source: string; svg: string }>({
		source: "",
		svg: "",
	});

	const [exportOpen, setExportOpen] = useState(false);
	const [exportAnchor, setExportAnchor] = useState({ x: 0, y: 0 });
	const exportMenuRef = useRef<HTMLDivElement | null>(null);
	const displaySource = compact
		? preferVerticalFlowchart(diagram.mermaidSource)
		: diagram.mermaidSource;
	const renderedSvg = rendered.source === displaySource ? rendered.svg : "";
	const handleSvgRendered = useCallback(
		(svg: string) => {
			setRendered({ source: displaySource, svg });
		},
		[displaySource],
	);
	useEffect(() => {
		if (!exportOpen) return;
		const close = (event: MouseEvent | KeyboardEvent) => {
			if (event instanceof KeyboardEvent && event.key === "Escape") setExportOpen(false);
			if (event instanceof MouseEvent && !exportMenuRef.current?.contains(event.target as Node))
				setExportOpen(false);
		};
		document.addEventListener("mousedown", close);
		document.addEventListener("keydown", close);
		return () => {
			document.removeEventListener("mousedown", close);
			document.removeEventListener("keydown", close);
		};
	}, [exportOpen]);
	return (
		<div
			className={
				compact
					? "diagram-viewer diagram-viewer-compact"
					: "diagram-viewer h-full min-h-0 flex flex-col"
			}
		>
			{showHeader && (
				<div className="h-12 border-b border-gray-100 flex items-center justify-between px-4">
					<div className="flex min-w-0 items-center gap-2">
						<DiagramTypeIcon
							type={diagram.type}
							size={17}
							className="shrink-0 text-teal-700"
							aria-hidden="true"
						/>
						<span className="truncate font-bold text-primary">{diagram.name}</span>
					</div>
					<div ref={exportMenuRef} className="diagram-export">
						<button
							type="button"
							onClick={(event) => {
								const bounds = event.currentTarget.getBoundingClientRect();
								setExportAnchor({ x: bounds.right - 192, y: bounds.bottom + 6 });
								setExportOpen((open) => !open);
							}}
							aria-haspopup="menu"
							aria-expanded={exportOpen}
							title="Download diagram"
							aria-label="Download diagram"
							className="icon-button"
						>
							<Download size={16} />
						</button>
						{exportOpen && (
							<DiagramExportMenu
								diagram={diagram}
								renderedSvg={renderedSvg}
								anchor={exportAnchor}
								onClose={() => setExportOpen(false)}
							/>
						)}
					</div>
				</div>
			)}
			<div
				className={compact ? "diagram-viewer-content" : "flex-1 min-h-0 overflow-auto p-4"}
				data-diagram-id={diagram.id}
			>
				<MermaidDiagram source={displaySource} onSvgRendered={handleSvgRendered} />
			</div>
		</div>
	);
}

export function preferVerticalFlowchart(source: string): string {
	return source.replace(/^(\s*(?:flowchart|graph))\s+(?:LR|RL)\b/im, "$1 TD");
}

function DiagramExportMenu({
	diagram,
	renderedSvg,
	anchor,
	onClose,
}: {
	diagram: Diagram;
	renderedSvg: string;
	anchor: { x: number; y: number };
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const { ref, position } = useFloatingMenu(anchor);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const exportDiagram = async (format: "mermaid" | "svg" | "png") => {
		if (busy) return;
		const content = format === "mermaid" ? diagram.mermaidSource : renderedSvg;
		if (!content) return;
		setBusy(true);
		setError(null);
		try {
			const extension = format === "mermaid" ? "mmd" : format;
			const blob =
				format === "png"
					? await svgToPng(content)
					: new Blob([content], { type: format === "svg" ? "image/svg+xml" : "text/plain" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `${diagram.name.replace(/[^a-z0-9]+/gi, "-").toLocaleLowerCase()}.${extension}`;
			try {
				anchor.click();
			} finally {
				URL.revokeObjectURL(url);
			}
			onClose();
		} catch (reason) {
			setError(errorToMessage(reason));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div
			ref={ref}
			style={position}
			className="diagram-export-menu"
			role="menu"
			aria-busy={busy}
			onKeyDown={(event) => navigateMenu(event, onClose)}
		>
			{(["mermaid", "svg", "png"] as const).map((format) => {
				const Icon = format === "mermaid" ? FileCode2 : format === "svg" ? ImageIcon : FileImage;
				return (
					<button
						key={format}
						type="button"
						role="menuitem"
						disabled={busy || (format !== "mermaid" && !renderedSvg)}
						title={
							format !== "mermaid" && !renderedSvg
								? t("Render the diagram before exporting an image.")
								: undefined
						}
						onClick={() => void exportDiagram(format)}
						className="diagram-export-option"
					>
						<Icon size={16} />
						<span>{format === "mermaid" ? t("Mermaid source") : format.toUpperCase()}</span>
						<small>.{format === "mermaid" ? "mmd" : format}</small>
					</button>
				);
			})}
			{!renderedSvg && (
				<p className="text-xs text-secondary p-2">
					{t("Render the diagram before exporting an image.")}
				</p>
			)}
			{busy && (
				<p role="status" className="text-xs text-secondary p-2">
					{t("Exporting…")}
				</p>
			)}
			{error && (
				<p role="alert" className="field-error p-2">
					{error}
				</p>
			)}
		</div>
	);
}

async function svgToPng(svg: string): Promise<Blob> {
	const image = new Image();
	const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	try {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Unable to render diagram for PNG export."));
			image.src = svgUrl;
		});
		const width = Math.max(1, image.naturalWidth || 1200);
		const height = Math.max(1, image.naturalHeight || 800);
		const scale = Math.min(2, 4096 / Math.max(width, height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil(width * scale);
		canvas.height = Math.ceil(height * scale);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas is unavailable.");
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed."))),
				"image/png",
			),
		);
	} finally {
		URL.revokeObjectURL(svgUrl);
	}
}
