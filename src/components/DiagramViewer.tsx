import { Download, FileCode2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Diagram } from "../types";
import { MermaidDiagram } from "./MermaidDiagram";

export function DiagramViewer({ diagram }: { diagram: Diagram }) {
	const [renderedSvg, setRenderedSvg] = useState("");
	useEffect(() => setRenderedSvg(""), [diagram.mermaidSource]);
	return (
		<div className="h-full min-h-0 flex flex-col">
			<div className="h-12 border-b border-gray-100 flex items-center justify-between px-4">
				<div><span className="font-bold text-primary">{diagram.name}</span><span className="ml-2 text-xs text-secondary">v{diagram.version} / {diagram.type}</span></div>
				<div className="flex gap-1">
					<ExportButton diagram={diagram} format="mermaid" content={diagram.mermaidSource} />
					<ExportButton diagram={diagram} format="svg" content={renderedSvg} />
					<ExportButton diagram={diagram} format="png" content={renderedSvg} />
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-auto p-4" data-diagram-id={diagram.id}>
				<MermaidDiagram source={diagram.mermaidSource} onSvgRendered={setRenderedSvg} />
			</div>
			<div className="px-4 py-2 border-t border-gray-100 text-xs text-secondary">Mermaid source / {diagram.nodes.length} indexed nodes / {diagram.edges.length} indexed edges</div>
		</div>
	);
}

function ExportButton({ diagram, format, content }: { diagram: Diagram; format: "mermaid" | "svg" | "png"; content: string }) {
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
	};
	return <button type="button" onClick={() => void exportDiagram()} disabled={!content} title={`Export ${format}`} aria-label={`Export ${format}`} className="icon-button">{format === "mermaid" ? <FileCode2 size={16} /> : <Download size={16} />}</button>;
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
