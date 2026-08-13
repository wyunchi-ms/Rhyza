import { Database, ExternalLink, Network, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAppStore } from "../store";
import type { Diagram, Entity } from "../types";
import { DiagramViewer } from "./DiagramViewer";
import { PanelResizeHandle, usePanelSize, useViewportWidth } from "./PanelResizeHandle";

export const KnowledgePane = () => {
	const store = useAppStore();
	const [preview, setPreview] = useState<{ kind: "entity"; item: Entity } | { kind: "diagram"; item: Diagram } | null>(null);
	const viewportWidth = useViewportWidth();
	const paneMax = Math.min(560, Math.max(320, viewportWidth * 0.45));
	const paneSize = usePanelSize("knowbranch-layout-knowledge-width", 320, 280, paneMax);
	const paneWidth = Math.min(paneSize.value, paneMax);
	if (!store.rightPaneOpen) return null;
	const activeTurns = store.turns.filter((turn) => turn.sessionId === store.activeSessionId);
	const mentionedIds = new Set(activeTurns.flatMap((turn) => turn.entities?.map((entity) => entity.id) ?? []));
	const relevant = store.entities.filter((entity) => !entity.deletedAt && (mentionedIds.size === 0 || mentionedIds.has(entity.id)));
	const selectedEntity = store.entities.find((entity) => entity.id === store.selectedEntityId && !entity.deletedAt);
	const selectedDiagram = store.diagrams.find((diagram) => diagram.id === store.selectedDiagramId && !diagram.deletedAt);
	const diagrams = store.diagrams.filter((diagram) => !diagram.deletedAt);
	const openEntityPreview = (entity: Entity) => {
		store.setSelectedEntity(entity.id);
		setPreview({ kind: "entity", item: entity });
	};
	const openDiagramPreview = (diagram: Diagram) => {
		store.setSelectedDiagram(diagram.id);
		setPreview({ kind: "diagram", item: diagram });
	};

	return (
		<>
		<PanelResizeHandle side="right" label="Resize knowledge panel" value={paneWidth} min={280} max={paneMax} defaultValue={320} onChange={paneSize.setValue} onCommit={paneSize.commit} />
		<aside className="knowledge-pane" style={{ width: paneWidth, flexBasis: paneWidth, maxWidth: "calc(100vw - 4rem)" }}>
			<header className="knowledge-pane-header">
				<h2><Database size={16} /> Knowledge</h2>
				<button type="button" className="sidebar-icon-button" title="Close" onClick={store.toggleRightPane}><X size={16} /></button>
			</header>
			<div className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
				{selectedEntity && (
					<section className="knowledge-selection">
						<p className="section-label">Selected entity</p>
						<div className="flex items-start justify-between gap-3">
							<h3 className="font-bold text-primary">{selectedEntity.name}</h3>
							<span className="text-[10px] text-gray-400">{selectedEntity.type}</span>
						</div>
						<p className="text-sm text-secondary mt-2 whitespace-pre-wrap">{selectedEntity.content || selectedEntity.summary}</p>
						{selectedEntity.content && selectedEntity.summary !== selectedEntity.content && <p className="text-xs text-secondary mt-3 border-t border-gray-100 pt-3">{selectedEntity.summary}</p>}
						<Link to="/knowledge" className="text-xs text-accent mt-3 flex items-center gap-1">Open details <ExternalLink size={12} /></Link>
					</section>
				)}
				{selectedDiagram && (
					<section className="knowledge-selection">
						<p className="section-label">Selected diagram</p>
						<div className="knowledge-diagram-preview border border-gray-200 rounded-md bg-white">
							<DiagramViewer diagram={selectedDiagram} compact />
						</div>
						<Link to="/knowledge" className="text-xs text-accent mt-3 flex items-center gap-1">Open details <ExternalLink size={12} /></Link>
					</section>
				)}
				<section>
					<p className="section-label">Entities in branch</p>
					<div className="knowledge-list">
						{relevant.map((entity) => {
							const count = store.relations.filter((relation) => !relation.deletedAt && (relation.sourceEntityId === entity.id || relation.targetEntityId === entity.id)).length;
							return <button type="button" key={entity.id} onClick={() => openEntityPreview(entity)} className="knowledge-list-item knowledge-list-preview-trigger"><div className="flex justify-between gap-2"><span className="font-semibold text-sm truncate">{entity.name}</span><span className="text-[10px] text-gray-400">{entity.type}</span></div><p className="text-xs text-secondary line-clamp-2 mt-1">{entity.summary}</p><p className="text-[10px] text-gray-400 mt-2">{count} relations · {entity.sourceRefs.length} sources</p></button>;
						})}
						{relevant.length === 0 && <p className="text-xs text-secondary px-2">No knowledge linked to this branch yet.</p>}
					</div>
				</section>
				<section>
					<p className="section-label">Related diagrams</p>
					<div className="knowledge-list">
						{diagrams.map((diagram) => <button type="button" onClick={() => openDiagramPreview(diagram)} key={diagram.id} className="knowledge-list-item knowledge-list-preview-trigger flex items-center gap-2 text-sm font-semibold"><Network size={16} />{diagram.name}<span className="ml-auto text-xs text-gray-400">v{diagram.version}</span></button>)}
					</div>
				</section>
			</div>
		</aside>
		{preview && <KnowledgePreviewDialog preview={preview} onClose={() => setPreview(null)} />}
		</>
	);
};

function KnowledgePreviewDialog({ preview, onClose }: {
	preview: { kind: "entity"; item: Entity } | { kind: "diagram"; item: Diagram };
	onClose: () => void;
}) {
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
	return (
		<div className="knowledge-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section className={preview.kind === "entity" ? "knowledge-preview-dialog knowledge-entity-preview-dialog" : "knowledge-preview-dialog knowledge-diagram-preview-dialog"} role="dialog" aria-modal="true" aria-labelledby={`knowledge-preview-title-${item.id}`}>
				<header className="knowledge-preview-header">
					<div className="min-w-0">
						<p>{preview.kind === "entity" ? "Entity preview" : "Diagram preview"}</p>
						<h2 id={`knowledge-preview-title-${item.id}`}>{item.name}</h2>
					</div>
					<div className="flex items-center gap-3"><span className="knowledge-preview-type">{preview.kind === "entity" ? preview.item.type : `${preview.item.type} · v${preview.item.version}`}</span><button ref={closeButtonRef} type="button" onClick={onClose} title="Close preview" aria-label="Close preview"><X size={18} /></button></div>
				</header>
				{preview.kind === "entity" ? <EntityPreview entity={preview.item} /> : <div className="knowledge-preview-diagram"><DiagramViewer diagram={preview.item} /></div>}
			</section>
		</div>
	);
}

function EntityPreview({ entity }: { entity: Entity }) {
	return <div className="knowledge-preview-entity-content"><p className="knowledge-preview-summary">{entity.summary}</p><div className="knowledge-preview-entity-body">{entity.content || entity.summary}</div><footer><span>{entity.sourceRefs.length} sources</span><span>v{entity.version}</span></footer></div>;
}
