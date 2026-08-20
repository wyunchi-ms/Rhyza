import { Database, Network, X } from "lucide-react";
import { useAppStore } from "../store";
import { useKnowledgePreview } from "../hooks/useKnowledgePreview";
import { KnowledgePreviewDialog } from "./KnowledgePreviewDialog";
import { PanelResizeHandle, usePanelSize, useViewportWidth } from "./PanelResizeHandle";

export const KnowledgePane = () => {
	const store = useAppStore();
	const { preview, openEntity, openDiagram, closePreview } = useKnowledgePreview(store.entities, store.diagrams);
	const viewportWidth = useViewportWidth();
	const paneMax = Math.min(560, Math.max(320, viewportWidth * 0.45));
	const paneSize = usePanelSize("knowbranch-layout-knowledge-width", 320, 280, paneMax);
	const paneWidth = Math.min(paneSize.value, paneMax);
	if (!store.rightPaneOpen) return null;
	const activeTurns = store.turns.filter((turn) => turn.sessionId === store.activeSessionId);
	const mentionedIds = new Set(activeTurns.flatMap((turn) => turn.entities?.map((entity) => entity.id) ?? []));
	const relevant = store.entities.filter((entity) => !entity.deletedAt && (mentionedIds.size === 0 || mentionedIds.has(entity.id)));
	const diagrams = store.diagrams.filter((diagram) => !diagram.deletedAt);

	return (
		<>
		<PanelResizeHandle side="right" label="Resize knowledge panel" value={paneWidth} min={280} max={paneMax} defaultValue={320} onChange={paneSize.setValue} onCommit={paneSize.commit} />
		<aside className="knowledge-pane" style={{ width: paneWidth, flexBasis: paneWidth, maxWidth: "calc(100vw - 4rem)" }}>
			<header className="knowledge-pane-header">
				<h2><Database size={16} /> Knowledge</h2>
				<button type="button" className="sidebar-icon-button" title="Close" onClick={store.toggleRightPane}><X size={16} /></button>
			</header>
			<div className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
				<section>
					<p className="section-label">Entities in branch</p>
					<div className="knowledge-list">
						{relevant.map((entity) => {
							const count = store.relations.filter((relation) => !relation.deletedAt && (relation.sourceEntityId === entity.id || relation.targetEntityId === entity.id)).length;
							return <button type="button" key={entity.id} onClick={() => openEntity(entity)} className="knowledge-list-item knowledge-list-preview-trigger"><div className="flex justify-between gap-2"><span className="font-semibold text-sm truncate">{entity.name}</span><span className="text-[10px] text-gray-400">{entity.type}</span></div><p className="text-xs text-secondary line-clamp-2 mt-1">{entity.summary}</p><p className="text-[10px] text-gray-400 mt-2">{count} relations · {entity.sourceRefs.length} sources</p></button>;
						})}
						{relevant.length === 0 && <p className="text-xs text-secondary px-2">No knowledge linked to this branch yet.</p>}
					</div>
				</section>
				<section>
					<p className="section-label">Related diagrams</p>
					<div className="knowledge-list">
						{diagrams.map((diagram) => <button type="button" onClick={() => openDiagram(diagram)} key={diagram.id} className="knowledge-list-item knowledge-list-preview-trigger flex items-center gap-2 text-sm font-semibold"><Network size={16} />{diagram.name}<span className="ml-auto text-xs text-gray-400">v{diagram.version}</span></button>)}
					</div>
				</section>
			</div>
		</aside>
		{preview && <KnowledgePreviewDialog preview={preview} onClose={closePreview} />}
		</>
	);
};
