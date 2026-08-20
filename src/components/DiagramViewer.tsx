import { Download, FileCode2, FileImage, Image as ImageIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Diagram } from "../types";
import { MermaidDiagram } from "./MermaidDiagram";

export function DiagramViewer({ diagram, compact = false, showHeader = true }: { diagram: Diagram; compact?: boolean; showHeader?: boolean }) {
	const [rendered, setRendered] = useState<{ source: string; svg: string }>({ source: "", svg: "" });
	const [exportOpen, setExportOpen] = useState(false);
	const exportMenuRef = useRef<HTMLDivElement | null>(null);
	const displaySource = compact ? preferVerticalFlowchart(diagram.mermaidSource) : diagram.mermaidSource;
	const renderedSvg = rendered.source === displaySource ? rendered.svg : "";
	const handleSvgRendered = useCallback((svg: string) => {
		setRendered({ source: displaySource, svg });
	}, [displaySource]);
	useEffect(() => {
		if (!exportOpen) return;
		const close = (event: MouseEvent | KeyboardEvent) => {
			if (event instanceof KeyboardEvent && event.key === "Escape") setExportOpen(false);
			if (event instanceof MouseEvent && !exportMenuRef.current?.contains(event.target as Node)) setExportOpen(false);
		};
		document.addEventListener("mousedown", close);
		document.addEventListener("keydown", close);
		return () => {
			document.removeEventListener("mousedown", close);
			document.removeEventListener("keydown", close);
		};
	}, [exportOpen]);
	return (
		<div className={compact ? "diagram-viewer diagram-viewer-compact" : "diagram-viewer h-full min-h-0 flex flex-col"}>
			{showHeader && <div className="h-12 border-b border-gray-100 flex items-center justify-between px-4">
				<div><span className="font-bold text-primary">{diagram.name}</span></div>
				<div ref={exportMenuRef} className="diagram-export">
					<button type="button" onClick={() => setExportOpen((open) => !open)} aria-haspopup="menu" aria-expanded={exportOpen} title="Download diagram" aria-label="Download diagram" className="icon-button"><Download size={16} /></button>
					{exportOpen && <div className="diagram-export-menu" role="menu">
						<ExportOption diagram={diagram} format="mermaid" content={diagram.mermaidSource} onExported={() => setExportOpen(false)} />
						<ExportOption diagram={diagram} format="svg" content={renderedSvg} onExported={() => setExportOpen(false)} />
						<ExportOption diagram={diagram} format="png" content={renderedSvg} onExported={() => setExportOpen(false)} />
					</div>}
				</div>
			</div>}
			<div className={compact ? "diagram-viewer-content" : "flex-1 min-h-0 overflow-auto p-4"} data-diagram-id={diagram.id}>
				<MermaidDiagram source={displaySource} onSvgRendered={handleSvgRendered} />
			</div>
		</div>
	);
}

export function preferVerticalFlowchart(source: string): string {
	return source.replace(/^(\s*(?:flowchart|graph))\s+(?:LR|RL)\b/im, "$1 TD");
}

function ExportOption({ diagram, format, content, onExported }: { diagram: Diagram; format: "mermaid" | "svg" | "png"; content: string; onExported: () => void }) {
	const exportDiagram = async () => {
		if (!content) return;
		const extension = format === "mermaid" ? "mmd" : format;
		const blob = format === "png" ? await svgToPng(content) : new Blob([content], { type: format === "svg" ? "image/svg+xml" : "text/plain" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${diagram.name.replace(/[^a-z0-9]+/gi, "-").toLocaleLowerCase()}.${extension}`;
		anchor.click();
		URL.revokeObjectURL(url);
		onExported();
	};
	const Icon = format === "mermaid" ? FileCode2 : format === "svg" ? ImageIcon : FileImage;
	const label = format === "mermaid" ? "Mermaid source" : format.toUpperCase();
	return <button type="button" role="menuitem" onClick={() => void exportDiagram()} disabled={!content} className="diagram-export-option"><Icon size={16} /><span>{label}</span><small>.{format === "mermaid" ? "mmd" : format}</small></button>;
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
		return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG export failed.")), "image/png"));
	} finally {
		URL.revokeObjectURL(svgUrl);
	}
}
