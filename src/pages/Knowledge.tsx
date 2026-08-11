import { Database, Network, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DiagramViewer } from "../components/DiagramViewer";
import { MermaidDiagram } from "../components/MermaidDiagram";
import { useAppStore } from "../store";
import type { Diagram, Entity } from "../types";

const Knowledge = () => {
	const store = useAppStore();
	const [mode, setMode] = useState<"entities" | "diagrams">("entities");
	const [search, setSearch] = useState("");
	const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(null);
	const [entityDraft, setEntityDraft] = useState<Entity | null>(null);
	const [isEditingEntity, setIsEditingEntity] = useState(false);
	const activeEntities = store.entities.filter((entity) => !entity.deletedAt);
	const activeDiagrams = store.diagrams.filter((diagram) => !diagram.deletedAt);
	const selected = activeEntities.find((entity) => entity.id === store.selectedEntityId) ?? null;
	const filtered = activeEntities.filter((entity) => `${entity.name} ${entity.aliases.join(" ")} ${entity.type} ${entity.summary}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
	const diagram = activeDiagrams.find((item) => item.id === selectedDiagramId) ?? activeDiagrams[0] ?? null;
	useEffect(() => {
		if (diagram && diagram.id !== selectedDiagramId) setSelectedDiagramId(diagram.id);
	}, [diagram, selectedDiagramId]);
	useEffect(() => {
		setEntityDraft(selected);
		setIsEditingEntity(false);
	}, [selected]);

	return (
		<div className="knowledge-layout flex-1 grid grid-cols-[220px_minmax(0,1fr)_320px] bg-white overflow-hidden relative">
			<aside className="border-r border-gray-200 p-4 overflow-y-auto">
				<h1 className="text-lg font-semibold text-primary mb-4">Knowledge</h1>
				<div className="segmented mb-4"><button type="button" className={mode === "entities" ? "active" : ""} onClick={() => setMode("entities")}><Database size={14} /> Entities</button><button type="button" className={mode === "diagrams" ? "active" : ""} onClick={() => setMode("diagrams")}><Network size={14} /> Diagrams</button></div>
				<div className="relative mb-4"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="field field-with-icon" placeholder="Search" /></div>
				{mode === "entities" ? filtered.map((entity) => <button type="button" key={entity.id} onClick={() => store.setSelectedEntity(entity.id)} className={`w-full text-left px-3 py-2 rounded-md mb-1 ${selected?.id === entity.id ? "bg-accent/10 text-accent" : "hover:bg-gray-50"}`}><span className="block text-sm font-semibold truncate">{entity.name}</span><span className="block text-xs text-secondary">{entity.type} / v{entity.version}</span></button>) : activeDiagrams.map((item) => <button type="button" key={item.id} onClick={() => setSelectedDiagramId(item.id)} className={`w-full text-left px-3 py-2 rounded-md mb-1 ${diagram?.id === item.id ? "bg-accent/10 text-accent" : "hover:bg-gray-50"}`}><span className="block text-sm font-semibold truncate">{item.name}</span><span className="block text-xs font-normal">{item.type} / v{item.version}</span></button>)}
			</aside>
			<main className="min-w-0 min-h-0 overflow-hidden">
				{mode === "diagrams" && diagram ? <DiagramViewer diagram={diagram} /> : mode === "diagrams" ? <div className="empty-state h-full">Mermaid diagrams from agent responses will appear here.</div> : selected && entityDraft ? isEditingEntity ? <EntityCenterEditor draft={entityDraft} onDraftChange={setEntityDraft} onSave={() => { store.saveEntity(entityDraft); setIsEditingEntity(false); }} onCancel={() => { setEntityDraft(selected); setIsEditingEntity(false); }} /> : <EntityPreview entity={entityDraft} onEdit={() => setIsEditingEntity(true)} /> : <EntityOverview entities={filtered} onSelect={store.setSelectedEntity} />}
			</main>
			<aside className={`entity-detail-pane border-l border-gray-200 overflow-y-auto ${(mode === "diagrams" ? diagram : selected) ? "is-open" : ""}`}>{mode === "diagrams" ? diagram ? <DiagramEditor diagram={diagram} onDeleted={() => setSelectedDiagramId(null)} /> : <div className="empty-state h-full">Select a diagram to edit it.</div> : selected ? <EntityMetaPanel entity={selected} /> : <div className="empty-state h-full">Select an entity to inspect sources, relations, and history.</div>}</aside>
		</div>
	);
};

function EntityOverview({ entities, onSelect }: { entities: Entity[]; onSelect: (id: string) => void }) {
	return <div className="p-6 overflow-y-auto h-full"><div className="entity-grid">{entities.map((entity) => <button type="button" key={entity.id} onClick={() => onSelect(entity.id)} className="entity-row"><div className="flex justify-between gap-3"><h2 className="font-semibold text-primary truncate">{entity.name}</h2><span className="status-badge status-progress">{entity.confidence}</span></div><p className="text-sm text-secondary mt-2 line-clamp-2">{entity.summary}</p><p className="text-xs text-gray-400 mt-3">{entity.type} · {entity.sourceRefs.length} sources</p></button>)}</div>{entities.length === 0 && <div className="empty-state h-full">No entities yet. Complete a chat turn or create one manually.</div>}</div>;
}

function EntityPreview({ entity, onEdit }: { entity: Entity; onEdit: () => void }) {
	const content = entity.content.trim() || entity.summary;
	return <div className="entity-markdown-preview h-full overflow-y-auto p-6 lg:p-10"><article className="mx-auto max-w-3xl"><header><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><span className="status-badge status-progress">{entity.type}</span><span className="status-badge status-success">{entity.confidence}</span></div><h1>{entity.name}</h1>{entity.summary && <p>{entity.summary}</p>}</div><button type="button" className="secondary-button shrink-0" onClick={onEdit}><Pencil size={14} /> Edit</button></div></header><MarkdownPreview content={content} /></article></div>;
}

function MarkdownPreview({ content }: { content: string }) {
	return <div className="entity-markdown-preview-body markdown-body">{content ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: ({ className, children, ...props }) => { const source = String(children).replace(/\n$/, ""); return /(?:^|\s)language-mermaid(?:\s|$)/.test(className ?? "") ? <MermaidDiagram source={source} /> : className || source.includes("\n") ? <pre><code className={className} {...props}>{children}</code></pre> : <code className={className} {...props}>{children}</code>; } }}>{content}</ReactMarkdown> : <p className="text-secondary">Add content to start this entity note.</p>}</div>;
}

function EntityCenterEditor({ draft, onDraftChange, onSave, onCancel }: { draft: Entity; onDraftChange: (draft: Entity) => void; onSave: () => void; onCancel: () => void }) {
	const summaryRef = useRef<HTMLTextAreaElement | null>(null);
	const contentRef = useRef<HTMLTextAreaElement | null>(null);
	useEffect(() => resizeTextArea(summaryRef.current, 144), [draft.summary]);
	useEffect(() => resizeTextArea(contentRef.current), [draft.content]);
	return <form className="entity-center-editor h-full overflow-y-auto p-6 lg:p-10" onSubmit={(event) => { event.preventDefault(); onSave(); }}><div className="mx-auto max-w-4xl space-y-5">
		<div className="flex items-center justify-between gap-3"><div><span className="text-xs uppercase font-bold text-accent">Editing entity</span><h1>{draft.name || "Untitled entity"}</h1></div><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button></div>
		<label className="form-label">Name<input className="field mt-1" value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} /></label>
		<label className="form-label">Type<input className="field mt-1" value={draft.type} onChange={(event) => onDraftChange({ ...draft, type: event.target.value })} /></label>
		<label className="form-label">Confidence<select className="field mt-1" value={draft.confidence} onChange={(event) => onDraftChange({ ...draft, confidence: event.target.value as Entity["confidence"] })}><option value="confirmed">Confirmed</option><option value="inferred">Inferred</option><option value="disputed">Disputed</option></select></label>
		<label className="form-label">Aliases<input className="field mt-1" value={draft.aliases.join(", ")} onChange={(event) => onDraftChange({ ...draft, aliases: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
		<label className="form-label">Summary<textarea ref={summaryRef} className="field entity-summary-editor mt-1" value={draft.summary} onChange={(event) => { resizeTextArea(event.currentTarget, 144); onDraftChange({ ...draft, summary: event.target.value }); }} /></label>
		<label className="form-label">Content<textarea ref={contentRef} className="field entity-content-editor mt-1" value={draft.content} onChange={(event) => { resizeTextArea(event.currentTarget); onDraftChange({ ...draft, content: event.target.value }); }} /></label>
		<button type="submit" className="command-button w-full justify-center">Save with diff</button>
		<section><h3 className="section-label">Live preview</h3><MarkdownPreview content={draft.content.trim() || draft.summary} /></section>
	</div></form>;
}

function EntityMetaPanel({ entity }: { entity: Entity }) {
	const { softDeleteEntity, saveRelation, softDeleteRelation, relations, entities, changesets } = useAppStore();
	const [relationTarget, setRelationTarget] = useState("");
	const [relationType, setRelationType] = useState("related_to");
	const [relationDescription, setRelationDescription] = useState("");
	const entityRelations = relations.filter((relation) => !relation.deletedAt && (relation.sourceEntityId === entity.id || relation.targetEntityId === entity.id));
	const history = changesets.filter((change) => change.operations.some((operation) => operation.objectId === entity.id));
	return <div className="p-5 space-y-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="text-xs uppercase font-bold text-accent">{entity.type}</span><h2 className="text-xl font-black text-primary truncate">{entity.name}</h2></div><button type="button" title="Archive entity" onClick={() => { if (window.confirm(`Archive “${entity.name}” and its relations?`)) softDeleteEntity(entity.id); }} className="secondary-button shrink-0 text-red-600"><Trash2 size={14} /> Archive</button></div><section><h3 className="section-label">Relations</h3>{entityRelations.map((relation) => { const outgoing = relation.sourceEntityId === entity.id; const otherId = outgoing ? relation.targetEntityId : relation.sourceEntityId; const other = entities.find((item) => item.id === otherId); return <div key={relation.id} className="flex items-start gap-2 border-b border-gray-100 py-2 text-sm"><div className="min-w-0 flex-1"><p><span className="font-semibold">{outgoing ? relation.type : `← ${relation.type}`}</span> {other?.name ?? otherId}</p>{relation.description && <p className="mt-1 text-xs text-secondary">{relation.description}</p>}</div><button type="button" className="icon-button" title="Archive relation" aria-label="Archive relation" onClick={() => softDeleteRelation(relation.id)}><Trash2 size={13} /></button></div>; })}{entityRelations.length === 0 && <p className="text-xs text-secondary">No relations.</p>}<div className="mt-3 space-y-2 rounded-md border border-gray-200 p-3"><select className="field" value={relationTarget} onChange={(event) => setRelationTarget(event.target.value)}><option value="">Target entity</option>{entities.filter((item) => !item.deletedAt && item.id !== entity.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input className="field" value={relationType} onChange={(event) => setRelationType(event.target.value)} placeholder="Relation type" /><input className="field" value={relationDescription} onChange={(event) => setRelationDescription(event.target.value)} placeholder="Description" /><button type="button" className="secondary-button" disabled={!relationTarget || !relationType.trim()} onClick={() => { saveRelation({ id: `relation_${crypto.randomUUID()}`, sourceEntityId: entity.id, targetEntityId: relationTarget, type: relationType.trim(), description: relationDescription.trim(), confidence: "confirmed", sourceRefs: [], version: 0 }); setRelationTarget(""); setRelationDescription(""); }}><Plus size={14} /> Add relation</button></div></section><section><h3 className="section-label">Sources</h3>{entity.sourceRefs.map((source, index) => <div key={`${source.turnId}-${index}`} className="text-xs text-secondary py-1">{source.path ?? `Session ${source.sessionId}`} {source.turnId ? `/ Turn ${source.turnId.slice(0, 8)}` : ""}</div>)}</section><section><h3 className="section-label">History</h3>{history.map((change) => <div key={change.id} className="text-xs text-secondary py-1">{change.title} / {new Date(change.timestamp).toLocaleString()}</div>)}</section></div>;
}

function resizeTextArea(textarea: HTMLTextAreaElement | null, minimumHeight = 480) {
	if (!textarea) return;
	textarea.style.height = "auto";
	textarea.style.height = `${Math.max(minimumHeight, textarea.scrollHeight)}px`;
}

function DiagramEditor({ diagram, onDeleted }: { diagram: Diagram; onDeleted: () => void }) {
	const { saveDiagram, softDeleteDiagram } = useAppStore();
	const [draft, setDraft] = useState(diagram);
	useEffect(() => setDraft(diagram), [diagram]);
	return <form className="p-5 space-y-5" onSubmit={(event) => { event.preventDefault(); if (draft.mermaidSource.trim()) saveDiagram(draft); }}>
		<div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="text-xs uppercase font-bold text-accent">Diagram</span><h2 className="text-xl font-black text-primary truncate">{diagram.name}</h2></div><button type="button" title="Archive diagram" className="secondary-button shrink-0 text-red-600" onClick={() => { if (window.confirm(`Archive diagram “${diagram.name}”?`)) { softDeleteDiagram(diagram.id); onDeleted(); } }}><Trash2 size={14} /> Archive</button></div>
		<label className="form-label">Name<input className="field mt-1" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
		<label className="form-label">Type<select className="field mt-1" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as Diagram["type"] })}><option value="architecture">Architecture</option><option value="structure">Structure</option><option value="flowchart">Flowchart</option><option value="sequence">Sequence</option><option value="swimlane">Swimlane</option><option value="dependency">Dependency</option></select></label>
		<label className="form-label">Mermaid source<textarea required spellCheck={false} className="field mt-1 min-h-52 font-mono text-xs" value={draft.mermaidSource} onChange={(event) => setDraft({ ...draft, mermaidSource: event.target.value })} /></label>
		<section><h3 className="section-label">Preview</h3><div className="border border-gray-200 rounded-md overflow-auto p-3 min-h-40 bg-white"><MermaidDiagram source={draft.mermaidSource} /></div></section>
		<p className="text-xs text-secondary">{draft.nodes.length} indexed nodes · {draft.edges.length} indexed edges</p>
		<section><h3 className="section-label">Version diff</h3><div className="space-y-2">{[...diagram.versions].reverse().map((version) => <div key={version.version} className="rounded-md border border-gray-200 bg-white p-3"><div className="flex items-center justify-between"><span className="text-sm font-semibold">Version {version.version}</span><span className="text-[10px] text-gray-400">{new Date(version.timestamp).toLocaleString()}</span></div><div className="mt-2 flex flex-wrap gap-1"><span className="change-add">+{version.addedNodeIds.length} nodes</span><span className="change-add">+{version.addedEdgeIds.length} edges</span><span className="change-delete">-{version.removedNodeIds.length} nodes</span><span className="change-delete">-{version.removedEdgeIds.length} edges</span></div></div>)}</div></section>
		<button type="submit" className="command-button w-full justify-center" disabled={!draft.mermaidSource.trim()}>Save Mermaid diagram</button>
	</form>;
}

export default Knowledge;
