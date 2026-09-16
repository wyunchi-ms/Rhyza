import {
	ArrowRight,
	ChevronDown,
	Database,
	History,
	Network,
	Pencil,
	Plus,
	RefreshCw,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { KnowledgeChangeHistoryDialog } from "../components/KnowledgeChangeHistory";
import { DiagramViewer } from "../components/DiagramViewer";
import { DiagramTypeIcon } from "../components/DiagramTypeIcon";
import { MermaidDiagram } from "../components/MermaidDiagram";
import { getKnowbranchBridge, githubCopilotProviderId } from "../hooks/useKnowbranchBridge";
import { isMermaidCodeBlock } from "../utils/mermaidSource";
import { useAppStore } from "../store";
import type { Diagram, Entity, Relation, SourceRef } from "../types";
import { withTimeout } from "../utils/common";
import {
	buildKnowledgeInventory,
	prioritizeKnowledgeSourceRefs,
	sourceHitsToRefs,
} from "../utils/knowledgeExtraction";
import { errorToMessage } from "../shared/value";

const Knowledge = () => {
	const store = useAppStore();
	const [mode, setMode] = useState<"entities" | "diagrams">("entities");
	const [historyTarget, setHistoryTarget] = useState<{
		kind: "entity" | "diagram";
		id: string;
		name: string;
	} | null>(null);
	const [search, setSearch] = useState("");
	const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(null);
	const [entityDraft, setEntityDraft] = useState<Entity | null>(null);
	const [isEditingEntity, setIsEditingEntity] = useState(false);
	const [rebuildState, setRebuildState] = useState<{
		status: "idle" | "running" | "success" | "error";
		message?: string;
	}>({ status: "idle" });
	const activeEntities = store.entities.filter((entity) => !entity.deletedAt);
	const activeDiagrams = store.diagrams.filter((diagram) => !diagram.deletedAt);
	const filtered = activeEntities.filter((entity) =>
		`${entity.name} ${entity.aliases.join(" ")} ${entity.type} ${entity.summary}`
			.toLocaleLowerCase()
			.includes(search.toLocaleLowerCase()),
	);
	const selected =
		filtered.find((entity) => entity.id === store.selectedEntityId) ?? filtered[0] ?? null;
	const filteredDiagrams = activeDiagrams.filter((item) =>
		`${item.name} ${item.type}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
	);
	const diagram =
		filteredDiagrams.find((item) => item.id === selectedDiagramId) ?? filteredDiagrams[0] ?? null;
	const resourceCount = mode === "entities" ? activeEntities.length : activeDiagrams.length;
	const filteredResourceCount = mode === "entities" ? filtered.length : filteredDiagrams.length;
	const searchTerm = search.trim();
	const rebuildDisabled = activeEntities.length < 2 || rebuildState.status === "running";
	const rebuildTitle =
		activeEntities.length < 2
			? "Add at least two entities before rebuilding relations."
			: "Ask the current LLM to scan all entities and diagrams, rebuild entity relations, and relink diagrams";
	const listEmptyMessage =
		resourceCount === 0 ? `No ${mode} yet.` : `No ${mode} match “${searchTerm}”.`;
	useEffect(() => {
		if (diagram && diagram.id !== selectedDiagramId) setSelectedDiagramId(diagram.id);
	}, [diagram, selectedDiagramId]);
	useEffect(() => {
		setEntityDraft(selected);
		setIsEditingEntity(false);
	}, [selected]);
	const rebuildRelations = async () => {
		if (activeEntities.length < 2 || rebuildState.status === "running") return;
		const bridge = getKnowbranchBridge();
		if (!bridge) {
			setRebuildState({
				status: "error",
				message: "The Electron runtime is required to run the global LLM scan.",
			});
			return;
		}
		setRebuildState({
			status: "running",
			message: `Scanning ${activeEntities.length} entities and ${activeDiagrams.length} diagrams…`,
		});
		try {
			const model = store.settings.defaultModel
				? { providerId: githubCopilotProviderId, modelId: store.settings.defaultModel }
				: undefined;
			const response = await withTimeout(
				bridge.extractKnowledge({
					question:
						"Rebuild every meaningful relationship among the existing workspace entities. Use entity descriptions and diagram topology as evidence. Return relations only; do not create or rewrite entities or diagrams.",
					answer: buildRelationRebuildEvidence(
						activeEntities,
						store.relations.filter((relation) => !relation.deletedAt),
						activeDiagrams,
					),
					...buildKnowledgeInventory(activeEntities, activeDiagrams),
					model,
				}),
				120_000,
				"Global relation rebuild",
			);
			if (response.error && response.relations.length === 0) throw new Error(response.error);
			const linkedBefore = countDiagramKnowledgeLinks(useAppStore.getState().diagrams);
			const changes = store.applyRelationCandidates(response.relations);
			store.reconcileKnowledge();
			const linkedAfter = countDiagramKnowledgeLinks(useAppStore.getState().diagrams);
			const cost = response.usage?.cost ? ` · $${response.usage.cost.toFixed(4)}` : "";
			setRebuildState({
				status: "success",
				message: `${changes.created} relations created, ${changes.updated} updated, ${Math.max(0, linkedAfter - linkedBefore)} diagram links added${cost}.`,
			});
		} catch (error) {
			setRebuildState({ status: "error", message: errorToMessage(error) });
		}
	};

	return (
		<div className="knowledge-page flex-1 bg-white overflow-hidden">
			<header className="knowledge-page-header">
				<div>
					<p className="knowledge-eyebrow">Workspace library</p>
					<h1>Knowledge</h1>
				</div>
				<div className="knowledge-tabs" role="tablist" aria-label="Knowledge resource type">
					<button
						type="button"
						role="tab"
						aria-selected={mode === "entities"}
						className={mode === "entities" ? "is-active" : ""}
						onClick={() => {
							setMode("entities");
							setSearch("");
						}}
					>
						<Database size={17} />
						<span>Entities</span>
						<small>{activeEntities.length}</small>
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={mode === "diagrams"}
						className={mode === "diagrams" ? "is-active" : ""}
						onClick={() => {
							setMode("diagrams");
							setSearch("");
						}}
					>
						<Network size={17} />
						<span>Diagrams</span>
						<small>{activeDiagrams.length}</small>
					</button>
				</div>
				<div className="knowledge-header-actions">
					<button
						type="button"
						className="knowledge-rebuild-button"
						disabled={rebuildDisabled}
						onClick={() => void rebuildRelations()}
						title={rebuildTitle}
					>
						<RefreshCw
							size={15}
							className={rebuildState.status === "running" ? "animate-spin" : ""}
						/>
						<span>{rebuildState.status === "running" ? "Rebuilding…" : "Rebuild relations"}</span>
					</button>
					<label className="knowledge-search">
						<span className="sr-only">Search {mode}</span>
						<Search size={16} />
						<input
							disabled={resourceCount === 0}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder={resourceCount === 0 ? `No ${mode} to search` : `Search ${mode}`}
						/>
					</label>
					{rebuildState.message && (
						<p className={`knowledge-rebuild-feedback is-${rebuildState.status}`} role="status">
							{rebuildState.message}
						</p>
					)}
				</div>
			</header>
			<div className="knowledge-browser">
				<aside className="knowledge-resource-pane" aria-label={`${mode} list`}>
					<div className="knowledge-resource-heading">
						<strong>{mode === "entities" ? "All entities" : "All diagrams"}</strong>
						<span>{filteredResourceCount} shown</span>
					</div>
					<div className="knowledge-resource-list">
						{mode === "entities"
							? filtered.map((entity) => (
									<button
										type="button"
										key={entity.id}
										onClick={() => store.setSelectedEntity(entity.id)}
										className={selected?.id === entity.id ? "is-selected" : ""}
									>
										<span>
											<strong>{entity.name}</strong>
											<small>{entity.summary}</small>
										</span>
										<em>
											{entity.type} · v{entity.version}
										</em>
									</button>
								))
							: filteredDiagrams.map((item) => (
									<button
										type="button"
										key={item.id}
										onClick={() => setSelectedDiagramId(item.id)}
										className={diagram?.id === item.id ? "is-selected" : ""}
									>
										<div className="knowledge-diagram-list-title">
											<DiagramTypeIcon type={item.type} size={17} aria-hidden="true" />
											<span>
												<strong>{item.name}</strong>
												<small>
													{item.nodes.length} nodes · {item.edges.length} edges
												</small>
											</span>
										</div>
										<em>
											{item.type} · v{item.version}
										</em>
									</button>
								))}
						{filteredResourceCount === 0 && (
							<div className="knowledge-list-empty">{listEmptyMessage}</div>
						)}
					</div>
				</aside>
				<main className="knowledge-detail-area">
					{mode === "entities" && selected && entityDraft ? (
						<div className="knowledge-detail-grid">
							<section className="knowledge-primary-detail">
								{isEditingEntity ? (
									<EntityCenterEditor
										draft={entityDraft}
										onDraftChange={setEntityDraft}
										onSave={() => {
											store.saveEntity(entityDraft);
											setIsEditingEntity(false);
										}}
										onCancel={() => {
											setEntityDraft(selected);
											setIsEditingEntity(false);
										}}
									/>
								) : (
									<EntityPreview entity={entityDraft} onEdit={() => setIsEditingEntity(true)} />
								)}
							</section>
							<aside className="knowledge-inspector">
								<EntityMetaPanel
									entity={selected}
									onOpenHistory={() =>
										setHistoryTarget({ kind: "entity", id: selected.id, name: selected.name })
									}
									onOpenDiagram={(diagramId) => {
										store.setSelectedDiagram(diagramId);
										setSelectedDiagramId(diagramId);
										setSearch("");
										setMode("diagrams");
									}}
								/>
							</aside>
						</div>
					) : mode === "diagrams" && diagram ? (
						<div className="knowledge-detail-grid">
							<section className="knowledge-primary-detail">
								<DiagramViewer diagram={diagram} />
							</section>
							<aside className="knowledge-inspector">
								<DiagramEditor
									diagram={diagram}
									entities={activeEntities}
									onOpenHistory={() =>
										setHistoryTarget({ kind: "diagram", id: diagram.id, name: diagram.name })
									}
									onOpenEntity={(entityId) => {
										store.setSelectedEntity(entityId);
										setSearch("");
										setMode("entities");
									}}
									onDeleted={() => setSelectedDiagramId(null)}
								/>
							</aside>
						</div>
					) : (
						<div className="empty-state h-full">
							{resourceCount === 0
								? mode === "entities"
									? "No entities yet. Complete a chat turn to build your knowledge base."
									: "No diagrams yet. Mermaid diagrams from agent responses will appear here."
								: `No ${mode} match “${searchTerm}”.`}
						</div>
					)}
				</main>
			</div>
			{historyTarget && (
				<KnowledgeChangeHistoryDialog
					kind={historyTarget.kind}
					objectId={historyTarget.id}
					name={historyTarget.name}
					onClose={() => setHistoryTarget(null)}
				/>
			)}
		</div>
	);
};

function EntityPreview({ entity, onEdit }: { entity: Entity; onEdit: () => void }) {
	const content = entity.content.trim() || entity.summary;
	return (
		<div className="entity-markdown-preview h-full overflow-y-auto p-6 lg:p-10">
			<article className="mx-auto max-w-3xl">
				<header>
					<div className="flex items-start justify-between gap-4">
						<div>
							<div className="flex flex-wrap items-center gap-2">
								<span className="status-badge status-progress">{entity.type}</span>
								<span className="status-badge status-success">{entity.confidence}</span>
							</div>
							<h1>{entity.name}</h1>
							{entity.summary && <p>{entity.summary}</p>}
						</div>
						<button type="button" className="secondary-button shrink-0" onClick={onEdit}>
							<Pencil size={14} /> Edit
						</button>
					</div>
				</header>
				<MarkdownPreview content={content} />
			</article>
		</div>
	);
}

function MarkdownPreview({ content }: { content: string }) {
	return (
		<div className="entity-markdown-preview-body markdown-body">
			{content ? (
				<ReactMarkdown
					remarkPlugins={[remarkGfm]}
					components={{
						code: ({ className, children, ...props }) => {
							const source = String(children).replace(/\n$/, "");
							return isMermaidCodeBlock(className, source) ? (
								<MermaidDiagram source={source} />
							) : className || source.includes("\n") ? (
								<pre>
									<code className={className} {...props}>
										{children}
									</code>
								</pre>
							) : (
								<code className={className} {...props}>
									{children}
								</code>
							);
						},
					}}
				>
					{content}
				</ReactMarkdown>
			) : (
				<p className="text-secondary">Add content to start this entity note.</p>
			)}
		</div>
	);
}

function EntityCenterEditor({
	draft,
	onDraftChange,
	onSave,
	onCancel,
}: {
	draft: Entity;
	onDraftChange: (draft: Entity) => void;
	onSave: () => void;
	onCancel: () => void;
}) {
	const summaryRef = useRef<HTMLTextAreaElement | null>(null);
	const contentRef = useRef<HTMLTextAreaElement | null>(null);
	useEffect(() => resizeTextArea(summaryRef.current, 144), [draft.summary]);
	useEffect(() => resizeTextArea(contentRef.current), [draft.content]);
	return (
		<form
			className="entity-center-editor h-full overflow-y-auto p-6 lg:p-10"
			onSubmit={(event) => {
				event.preventDefault();
				onSave();
			}}
		>
			<div className="mx-auto max-w-4xl space-y-5">
				<div className="flex items-center justify-between gap-3">
					<div>
						<span className="text-xs uppercase font-bold text-accent">Editing entity</span>
						<h1>{draft.name || "Untitled entity"}</h1>
					</div>
					<button type="button" className="secondary-button" onClick={onCancel}>
						Cancel
					</button>
				</div>
				<label className="form-label">
					Name
					<input
						className="field mt-1"
						value={draft.name}
						onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
					/>
				</label>
				<label className="form-label">
					Type
					<input
						className="field mt-1"
						value={draft.type}
						onChange={(event) => onDraftChange({ ...draft, type: event.target.value })}
					/>
				</label>
				<label className="form-label">
					Confidence
					<select
						className="field mt-1"
						value={draft.confidence}
						onChange={(event) =>
							onDraftChange({ ...draft, confidence: event.target.value as Entity["confidence"] })
						}
					>
						<option value="confirmed">Confirmed</option>
						<option value="inferred">Inferred</option>
						<option value="disputed">Disputed</option>
					</select>
				</label>
				<label className="form-label">
					Aliases
					<input
						className="field mt-1"
						value={draft.aliases.join(", ")}
						onChange={(event) =>
							onDraftChange({
								...draft,
								aliases: event.target.value
									.split(",")
									.map((value) => value.trim())
									.filter(Boolean),
							})
						}
					/>
				</label>
				<label className="form-label">
					Summary
					<textarea
						ref={summaryRef}
						className="field entity-summary-editor mt-1"
						value={draft.summary}
						onChange={(event) => {
							resizeTextArea(event.currentTarget, 144);
							onDraftChange({ ...draft, summary: event.target.value });
						}}
					/>
				</label>
				<label className="form-label">
					Content
					<textarea
						ref={contentRef}
						className="field entity-content-editor mt-1"
						value={draft.content}
						onChange={(event) => {
							resizeTextArea(event.currentTarget);
							onDraftChange({ ...draft, content: event.target.value });
						}}
					/>
				</label>
				<button type="submit" className="command-button w-full justify-center">
					Save with diff
				</button>
				<section>
					<h3 className="section-label">Live preview</h3>
					<MarkdownPreview content={draft.content.trim() || draft.summary} />
				</section>
			</div>
		</form>
	);
}

function EntityMetaPanel({
	entity,
	onOpenHistory,
	onOpenDiagram,
}: {
	entity: Entity;
	onOpenHistory: () => void;
	onOpenDiagram: (diagramId: string) => void;
}) {
	const {
		softDeleteEntity,
		saveEntity,
		saveRelation,
		softDeleteRelation,
		setSelectedEntity,
		relations,
		entities,
		diagrams,
		sources: sourceCatalog,
	} = useAppStore();
	const [relationForm, setRelationForm] = useState<{
		relation?: Relation;
		relatedEntityId: string;
		type: string;
		description: string;
	} | null>(null);
	const [sourceReindexState, setSourceReindexState] = useState<{
		status: "idle" | "running" | "success" | "error";
		message?: string;
	}>({ status: "idle" });
	const entityRelations = relations.filter(
		(relation) =>
			!relation.deletedAt &&
			(relation.sourceEntityId === entity.id || relation.targetEntityId === entity.id),
	);
	const linkedDiagrams = diagrams
		.filter((diagram) => !diagram.deletedAt)
		.flatMap((diagram) => {
			const linkedNodes = diagram.nodes.filter((node) => node.entityId === entity.id);
			return linkedNodes.length ? [{ diagram, linkedNodes }] : [];
		});
	const sources = uniqueSourceLocations(entity.sourceRefs);
	const sourceScope = entity.sourceScope ?? "workspace";
	useEffect(() => {
		setRelationForm(null);
		setSourceReindexState({ status: "idle" });
	}, [entity.id]);
	const reindexSources = async () => {
		if (sourceReindexState.status === "running") return;
		const bridge = getKnowbranchBridge();
		if (!bridge)
			return setSourceReindexState({
				status: "error",
				message: "The Electron runtime is required to search sources.",
			});
		const query = buildEntitySourceQuery(entity);
		setSourceReindexState({
			status: "running",
			message: "Searching authoritative workspace sources…",
		});
		try {
			const hits = await bridge.sourceSearch({ query, limit: 24 });
			const durableSessionRefs = entity.sourceRefs.filter((ref) => !ref.path);
			if (hits.length === 0) {
				if (sourceScope !== "general")
					throw new Error("No matching indexed source files were found.");
				saveEntity({ ...entity, sourceRefs: durableSessionRefs });
				setSourceReindexState({
					status: "success",
					message:
						"No workspace evidence found. Conversation provenance was kept; workspace citations remain optional.",
				});
				return;
			}
			const nextRefs = prioritizeKnowledgeSourceRefs(
				[...durableSessionRefs, ...sourceHitsToRefs(hits, sourceCatalog)],
				query,
			);
			const fileRefCount = nextRefs.filter((ref) => Boolean(ref.path)).length;
			if (fileRefCount === 0) {
				if (sourceScope !== "general") throw new Error("No authoritative file evidence was found.");
				saveEntity({ ...entity, sourceRefs: durableSessionRefs });
				setSourceReindexState({
					status: "success",
					message: "No authoritative workspace evidence found. Conversation provenance was kept.",
				});
				return;
			}
			saveEntity({
				...entity,
				sourceScope: sourceScope === "general" ? "mixed" : sourceScope,
				sourceRefs: nextRefs,
			});
			setSourceReindexState({
				status: "success",
				message: `Replaced file references with ${fileRefCount} ranked source${fileRefCount === 1 ? "" : "s"}.`,
			});
		} catch (error) {
			setSourceReindexState({ status: "error", message: errorToMessage(error) });
		}
	};
	const openRelationEditor = (relation?: Relation) => {
		const relatedEntityId = relation
			? relation.sourceEntityId === entity.id
				? relation.targetEntityId
				: relation.sourceEntityId
			: "";
		setRelationForm({
			relation,
			relatedEntityId,
			type: relation?.type ?? "related_to",
			description: relation?.description ?? "",
		});
	};
	const submitRelation = () => {
		if (!relationForm?.relatedEntityId || !relationForm.type.trim()) return;
		const existing = relationForm.relation;
		const outgoing = !existing || existing.sourceEntityId === entity.id;
		saveRelation({
			...(existing ?? {}),
			id: existing?.id ?? `relation_${crypto.randomUUID()}`,
			sourceEntityId: outgoing ? entity.id : relationForm.relatedEntityId,
			targetEntityId: outgoing ? relationForm.relatedEntityId : entity.id,
			type: relationForm.type.trim(),
			description: relationForm.description.trim(),
			confidence: existing?.confidence ?? "confirmed",
			sourceRefs: existing?.sourceRefs ?? [],
			version: existing?.version ?? 0,
		});
		setRelationForm(null);
	};
	return (
		<div className="p-5 space-y-5">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<span className="text-xs uppercase font-bold text-accent">{entity.type}</span>
					<h2 className="text-xl font-black text-primary truncate">{entity.name}</h2>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						title="View entity change history"
						aria-label="View entity change history"
						onClick={onOpenHistory}
						className="icon-button"
					>
						<History size={15} />
					</button>
					<button
						type="button"
						title="Archive entity"
						onClick={() => {
							if (window.confirm(`Archive “${entity.name}” and its relations?`))
								softDeleteEntity(entity.id);
						}}
						className="secondary-button shrink-0 text-red-600"
					>
						<Trash2 size={14} /> Archive
					</button>
				</div>
			</div>
			<section>
				<div className="entity-section-heading">
					<h3 className="section-label">Relations</h3>
					<span className="entity-section-actions">
						<small>{entityRelations.length}</small>
						<button
							type="button"
							onClick={() => openRelationEditor()}
							title="Add relation"
							aria-label="Add relation"
						>
							<Plus size={14} />
						</button>
					</span>
				</div>
				<div className="entity-relation-list">
					{entityRelations.map((relation) => {
						const outgoing = relation.sourceEntityId === entity.id;
						const otherId = outgoing ? relation.targetEntityId : relation.sourceEntityId;
						const other = entities.find((item) => item.id === otherId);
						return (
							<div key={relation.id} className="entity-relation-item">
								<button
									type="button"
									className="entity-relation-link"
									onClick={() => setSelectedEntity(otherId)}
									aria-label={`Open entity ${other?.name ?? otherId}`}
								>
									<span className="entity-relation-heading">
										<small>{outgoing ? relation.type : `incoming · ${relation.type}`}</small>
										<ArrowRight size={14} aria-hidden="true" />
									</span>
									<strong>{other?.name ?? otherId}</strong>
									{relation.description && (
										<span className="entity-relation-description">{relation.description}</span>
									)}
								</button>
								<span className="entity-relation-actions">
									<button
										type="button"
										className="entity-relation-edit"
										title="Edit relation"
										aria-label={`Edit relation to ${other?.name ?? otherId}`}
										onClick={() => openRelationEditor(relation)}
									>
										<Pencil size={13} />
									</button>
									<button
										type="button"
										className="entity-relation-delete"
										title="Archive relation"
										aria-label={`Archive relation to ${other?.name ?? otherId}`}
										onClick={() => softDeleteRelation(relation.id)}
									>
										<Trash2 size={13} />
									</button>
								</span>
							</div>
						);
					})}
					{entityRelations.length === 0 && <p className="text-xs text-secondary">No relations.</p>}
				</div>
				{relationForm && (
					<form
						className="entity-relation-form"
						onSubmit={(event) => {
							event.preventDefault();
							submitRelation();
						}}
					>
						<div className="entity-relation-form-header">
							<strong>{relationForm.relation ? "Edit relation" : "Add relation"}</strong>
							<button
								type="button"
								onClick={() => setRelationForm(null)}
								title="Close relation form"
								aria-label="Close relation form"
							>
								<X size={14} />
							</button>
						</div>
						<label>
							<span>Related entity</span>
							<select
								className="field"
								value={relationForm.relatedEntityId}
								onChange={(event) =>
									setRelationForm({ ...relationForm, relatedEntityId: event.target.value })
								}
							>
								<option value="">Select entity</option>
								{entities
									.filter((item) => !item.deletedAt && item.id !== entity.id)
									.map((item) => (
										<option key={item.id} value={item.id}>
											{item.name}
										</option>
									))}
							</select>
						</label>
						<label>
							<span>Relation type</span>
							<input
								className="field"
								value={relationForm.type}
								onChange={(event) => setRelationForm({ ...relationForm, type: event.target.value })}
								placeholder="related_to"
							/>
						</label>
						<label>
							<span>Description</span>
							<textarea
								className="field"
								rows={3}
								value={relationForm.description}
								onChange={(event) =>
									setRelationForm({ ...relationForm, description: event.target.value })
								}
								placeholder="Describe how these entities are connected"
							/>
						</label>
						<div className="entity-relation-form-actions">
							<button
								type="button"
								className="secondary-button"
								onClick={() => setRelationForm(null)}
							>
								Cancel
							</button>
							<button
								type="submit"
								className="command-button"
								disabled={!relationForm.relatedEntityId || !relationForm.type.trim()}
							>
								{relationForm.relation ? "Save changes" : "Add relation"}
							</button>
						</div>
					</form>
				)}
			</section>
			<section>
				<div className="entity-connected-heading">
					<h3 className="section-label">Connected diagrams</h3>
					<span>{linkedDiagrams.length}</span>
				</div>
				<div className="entity-diagram-list">
					{linkedDiagrams.map(({ diagram, linkedNodes }) => (
						<button
							key={diagram.id}
							type="button"
							className="entity-diagram-link"
							onClick={() => onOpenDiagram(diagram.id)}
							aria-label={`Open diagram ${diagram.name}`}
						>
							<DiagramTypeIcon type={diagram.type} size={15} aria-hidden="true" />
							<span>
								<strong>{diagram.name}</strong>
								<small>
									{diagram.type} · {linkedNodes.length} linked{" "}
									{linkedNodes.length === 1 ? "node" : "nodes"}
								</small>
							</span>
							<ArrowRight size={14} aria-hidden="true" />
						</button>
					))}
					{linkedDiagrams.length === 0 && (
						<p className="text-xs text-secondary">No diagrams reference this entity yet.</p>
					)}
				</div>
			</section>
			<details className="entity-sources-disclosure">
				<summary>
					<span>Sources</span>
					<span className="entity-sources-summary-meta">
						<small>{sources.length}</small>
						<ChevronDown size={14} aria-hidden="true" />
					</span>
				</summary>
				<div className="entity-sources-content">
					<div className="entity-sources-toolbar">
						<span>
							{sourceScope === "general"
								? "General knowledge · workspace evidence is optional."
								: sourceScope === "mixed"
									? "General knowledge with workspace-specific evidence."
									: "Workspace knowledge · implementation and configuration sources rank first."}
						</span>
						<button
							type="button"
							className="secondary-button"
							disabled={sourceReindexState.status === "running"}
							onClick={() => void reindexSources()}
						>
							<RefreshCw
								size={13}
								className={sourceReindexState.status === "running" ? "animate-spin" : ""}
							/>
							{sourceReindexState.status === "running" ? "Reindexing…" : "Reindex"}
						</button>
					</div>
					{sourceReindexState.message && (
						<p
							className={`entity-source-reindex-feedback is-${sourceReindexState.status}`}
							role="status"
						>
							{sourceReindexState.message}
						</p>
					)}
					{sources.map((source) => (
						<div
							key={sourceLocationKey(source)}
							className="break-words font-mono text-[11px] leading-4 text-secondary"
							title={formatSourceLocation(source)}
						>
							{formatSourceLocation(source)}
						</div>
					))}
					{sources.length === 0 && <p className="text-xs text-secondary">No sources.</p>}
				</div>
			</details>
		</div>
	);
}

function buildEntitySourceQuery(entity: Entity): string {
	return [entity.name, ...entity.aliases, entity.type, entity.summary]
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 1_500);
}

function uniqueSourceLocations(sourceRefs: SourceRef[]): SourceRef[] {
	const unique = new Map<string, SourceRef>();
	for (const source of sourceRefs) {
		const key = sourceLocationKey(source);
		if (!unique.has(key)) unique.set(key, source);
	}
	return [...unique.values()];
}

function sourceLocationKey(source: SourceRef): string {
	if (source.path) return [source.path, source.lineStart ?? "", source.lineEnd ?? ""].join(":");
	return [source.sessionId, source.turnId].join(":");
}

function formatSourceLocation(source: SourceRef): string {
	if (source.path) {
		if (source.lineStart === undefined) return source.path;
		const lineRange =
			source.lineEnd !== undefined && source.lineEnd !== source.lineStart
				? `${source.lineStart}-${source.lineEnd}`
				: String(source.lineStart);
		return `${source.path}:${lineRange}`;
	}
	const session = source.sessionId ? `Session ${source.sessionId}` : "Unknown session";
	return source.turnId ? `${session} / Turn ${source.turnId.slice(0, 8)}` : session;
}

function resizeTextArea(textarea: HTMLTextAreaElement | null, minimumHeight = 480) {
	if (!textarea) return;
	textarea.style.height = "auto";
	textarea.style.height = `${Math.max(minimumHeight, textarea.scrollHeight)}px`;
}

function DiagramEditor({
	diagram,
	entities,
	onOpenHistory,
	onOpenEntity,
	onDeleted,
}: {
	diagram: Diagram;
	entities: Entity[];
	onOpenHistory: () => void;
	onOpenEntity: (entityId: string) => void;
	onDeleted: () => void;
}) {
	const { saveDiagram, softDeleteDiagram } = useAppStore();
	const [draft, setDraft] = useState(diagram);
	const [entityLinkForm, setEntityLinkForm] = useState<{
		nodeId: string;
		entityId: string;
		editing: boolean;
	} | null>(null);
	useEffect(() => {
		setDraft(diagram);
		setEntityLinkForm(null);
	}, [diagram]);
	const entityById = new Map(entities.map((entity) => [entity.id, entity]));
	const linkedNodes = diagram.nodes.flatMap((node) => {
		const entity = node.entityId ? entityById.get(node.entityId) : undefined;
		return entity ? [{ node, entity }] : [];
	});
	const unlinkedNodes = diagram.nodes.filter(
		(node) => !node.entityId || !entityById.has(node.entityId),
	);
	const saveEntityLink = () => {
		if (!entityLinkForm?.nodeId || !entityLinkForm.entityId) return;
		const nodeId = entityLinkForm.nodeId;
		saveDiagram({
			...diagram,
			nodes: diagram.nodes.map((node) =>
				node.id === nodeId ? { ...node, entityId: entityLinkForm.entityId } : node,
			),
			edges: diagram.edges.map((edge) =>
				edge.source === nodeId || edge.target === nodeId
					? { ...edge, relationId: undefined }
					: edge,
			),
		});
		setEntityLinkForm(null);
	};
	const removeEntityLink = (nodeId: string) => {
		saveDiagram({
			...diagram,
			nodes: diagram.nodes.map((node) =>
				node.id === nodeId ? { ...node, entityId: undefined } : node,
			),
			edges: diagram.edges.map((edge) =>
				edge.source === nodeId || edge.target === nodeId
					? { ...edge, relationId: undefined }
					: edge,
			),
		});
	};
	return (
		<form
			className="p-5 space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (draft.mermaidSource.trim()) saveDiagram(draft);
			}}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<span className="text-xs uppercase font-bold text-accent">Diagram</span>
					<h2 className="text-xl font-black text-primary truncate">{diagram.name}</h2>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						title="View diagram change history"
						aria-label="View diagram change history"
						onClick={onOpenHistory}
						className="icon-button"
					>
						<History size={15} />
					</button>
					<button
						type="button"
						title="Archive diagram"
						className="secondary-button shrink-0 text-red-600"
						onClick={() => {
							if (window.confirm(`Archive diagram “${diagram.name}”?`)) {
								softDeleteDiagram(diagram.id);
								onDeleted();
							}
						}}
					>
						<Trash2 size={14} /> Archive
					</button>
				</div>
			</div>
			<label className="form-label">
				Name
				<input
					className="field mt-1"
					value={draft.name}
					onChange={(event) => setDraft({ ...draft, name: event.target.value })}
				/>
			</label>
			<label className="form-label">
				Type
				<select
					className="field mt-1"
					value={draft.type}
					onChange={(event) => setDraft({ ...draft, type: event.target.value as Diagram["type"] })}
				>
					<option value="architecture">Architecture</option>
					<option value="workflow">Workflow</option>
					<option value="dataflow">Data flow</option>
					<option value="lifecycle">Lifecycle</option>
					<option value="structure">Structure</option>
					<option value="flowchart">Flowchart</option>
					<option value="sequence">Sequence</option>
					<option value="swimlane">Swimlane</option>
					<option value="dependency">Dependency</option>
				</select>
			</label>
			<section aria-labelledby="diagram-linked-heading">
				<div className="entity-section-heading">
					<h3 id="diagram-linked-heading" className="form-label">
						Connected entities
					</h3>
					<span className="entity-section-actions">
						<button
							type="button"
							disabled={unlinkedNodes.length === 0 || entities.length === 0}
							onClick={() =>
								setEntityLinkForm({
									nodeId: unlinkedNodes[0]?.id ?? "",
									entityId: "",
									editing: false,
								})
							}
							title="Connect entity"
							aria-label="Connect entity"
						>
							<Plus size={14} />
						</button>
					</span>
				</div>
				<div className="entity-relation-list">
					{linkedNodes.map(({ node, entity }) => (
						<div key={node.id} className="entity-relation-item">
							<button
								type="button"
								className="entity-relation-link"
								onClick={() => onOpenEntity(entity.id)}
								aria-label={`Open entity ${entity.name}`}
							>
								<span className="entity-relation-heading">
									<small>{node.label}</small>
									<ArrowRight size={14} aria-hidden="true" />
								</span>
								<strong>{entity.name}</strong>
								<span className="entity-relation-description">{entity.type}</span>
							</button>
							<span className="entity-relation-actions">
								<button
									type="button"
									className="entity-relation-edit"
									title="Edit connected entity"
									aria-label={`Edit connection for ${node.label}`}
									onClick={() =>
										setEntityLinkForm({ nodeId: node.id, entityId: entity.id, editing: true })
									}
								>
									<Pencil size={13} />
								</button>
								<button
									type="button"
									className="entity-relation-delete"
									title="Remove connected entity"
									aria-label={`Remove connection for ${node.label}`}
									onClick={() => removeEntityLink(node.id)}
								>
									<Trash2 size={13} />
								</button>
							</span>
						</div>
					))}
					{linkedNodes.length === 0 && (
						<p className="text-xs text-secondary">No connected entities.</p>
					)}
				</div>
				{entityLinkForm && (
					<div className="entity-relation-form">
						<div className="entity-relation-form-header">
							<strong>{entityLinkForm.editing ? "Edit connected entity" : "Connect entity"}</strong>
							<button
								type="button"
								onClick={() => setEntityLinkForm(null)}
								title="Close connection form"
								aria-label="Close connection form"
							>
								<X size={14} />
							</button>
						</div>
						<label>
							<span>Diagram node</span>
							<select
								className="field"
								disabled={entityLinkForm.editing}
								value={entityLinkForm.nodeId}
								onChange={(event) =>
									setEntityLinkForm({ ...entityLinkForm, nodeId: event.target.value })
								}
							>
								{(entityLinkForm.editing
									? diagram.nodes.filter((node) => node.id === entityLinkForm.nodeId)
									: unlinkedNodes
								).map((node) => (
									<option key={node.id} value={node.id}>
										{node.label}
									</option>
								))}
							</select>
						</label>
						<label>
							<span>Entity</span>
							<select
								className="field"
								value={entityLinkForm.entityId}
								onChange={(event) =>
									setEntityLinkForm({ ...entityLinkForm, entityId: event.target.value })
								}
							>
								<option value="">Select entity</option>
								{entities.map((entity) => (
									<option key={entity.id} value={entity.id}>
										{entity.name}
									</option>
								))}
							</select>
						</label>
						<div className="entity-relation-form-actions">
							<button
								type="button"
								className="secondary-button"
								onClick={() => setEntityLinkForm(null)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="command-button"
								disabled={!entityLinkForm.nodeId || !entityLinkForm.entityId}
								onClick={saveEntityLink}
							>
								{entityLinkForm.editing ? "Save changes" : "Connect entity"}
							</button>
						</div>
					</div>
				)}
			</section>
			<label className="form-label">
				Mermaid source
				<textarea
					required
					spellCheck={false}
					className="field mt-1 min-h-52 font-mono text-xs"
					value={draft.mermaidSource}
					onChange={(event) => setDraft({ ...draft, mermaidSource: event.target.value })}
				/>
			</label>
			<p className="text-xs text-secondary">
				{draft.nodes.length} indexed nodes · {draft.edges.length} indexed edges
			</p>
			<button
				type="submit"
				className="command-button w-full justify-center"
				disabled={!draft.mermaidSource.trim()}
			>
				Save Mermaid diagram
			</button>
		</form>
	);
}

function buildRelationRebuildEvidence(
	entities: Entity[],
	relations: Relation[],
	diagrams: Diagram[],
): string {
	return JSON.stringify({
		instruction:
			"Infer a sparse, useful graph. Prefer specific directional relation types over related_to. Keep existing valid relations and add only relationships supported by entity content or diagram topology.",
		entities: entities.map((entity) => ({
			id: entity.id,
			name: entity.name,
			aliases: entity.aliases,
			type: entity.type,
			summary: entity.summary,
			content: entity.content,
		})),
		existingRelations: relations.map((relation) => ({
			sourceEntityId: relation.sourceEntityId,
			targetEntityId: relation.targetEntityId,
			type: relation.type,
			description: relation.description,
			confidence: relation.confidence,
		})),
		diagrams: diagrams.map((item) => ({
			id: item.id,
			name: item.name,
			type: item.type,
			nodes: item.nodes.map((node) => ({
				id: node.id,
				entityId: node.entityId,
				label: node.label,
				type: node.type,
			})),
			edges: item.edges.map((edge) => ({
				source: edge.source,
				target: edge.target,
				relationId: edge.relationId,
				label: edge.label,
			})),
		})),
	});
}

function countDiagramKnowledgeLinks(diagrams: Diagram[]): number {
	return diagrams
		.filter((diagram) => !diagram.deletedAt)
		.reduce(
			(count, diagram) =>
				count +
				diagram.nodes.filter((node) => Boolean(node.entityId)).length +
				diagram.edges.filter((edge) => Boolean(edge.relationId)).length,
			0,
		);
}

export default Knowledge;
