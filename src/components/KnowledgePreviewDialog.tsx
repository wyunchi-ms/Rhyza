import { BookOpen, Clock3, Database, FileText, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import type { Diagram, Entity } from "../types";
import { DiagramViewer } from "./DiagramViewer";

export type KnowledgePreview = { kind: "entity"; item: Entity } | { kind: "diagram"; item: Diagram };

export function KnowledgePreviewDialog({ preview, onClose }: { preview: KnowledgePreview; onClose: () => void }) {
	const closeButtonRef = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		closeButtonRef.current?.focus();
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [onClose]);

	const item = preview.item;
	return createPortal(
		<div className="knowledge-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section className={preview.kind === "entity" ? "knowledge-preview-dialog knowledge-entity-preview-dialog" : "knowledge-preview-dialog knowledge-diagram-preview-dialog"} role="dialog" aria-modal="true" aria-labelledby={`knowledge-preview-title-${item.id}`}>
				<header className="knowledge-preview-header">
					<div className="min-w-0"><p>{preview.kind === "entity" ? "Entity preview" : "Diagram preview"}</p><h2 id={`knowledge-preview-title-${item.id}`}>{item.name}</h2></div>
					<div className="flex items-center gap-3"><span className="knowledge-preview-type">{preview.kind === "entity" ? preview.item.type : `${preview.item.type} · v${preview.item.version}`}</span><button ref={closeButtonRef} type="button" onClick={onClose} title="Close preview" aria-label="Close preview"><X size={18} /></button></div>
				</header>
				{preview.kind === "entity" ? <EntityPreview entity={preview.item} /> : <div className="knowledge-preview-diagram"><DiagramViewer diagram={preview.item} showHeader={false} /></div>}
			</section>
		</div>,
		document.body,
	);
}

function EntityPreview({ entity }: { entity: Entity }) {
	return <div className="knowledge-preview-entity-content"><div className="knowledge-preview-entity-inner"><section className="knowledge-preview-summary"><BookOpen size={18} /><div><span>Overview</span><p>{entity.summary}</p></div></section><section className="knowledge-preview-entity-body"><h3><FileText size={16} /> Details</h3><p>{entity.content || entity.summary}</p></section><footer><span><Database size={14} />{entity.sourceRefs.length} source{entity.sourceRefs.length === 1 ? "" : "s"}</span><span>Version {entity.version}</span><span><Clock3 size={14} />Updated {new Date(entity.updatedAt).toLocaleDateString()}</span></footer></div></div>;
}
