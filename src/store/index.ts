import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { KnowledgeCandidate, KnowledgeDiagramCandidate, KnowledgeRelationCandidate } from "../shared/ipc";
import type {
	ChangeOperation,
	ChangeSet,
	Diagram,
	Entity,
	EntityMention,
	Relation,
	SessionNode,
	SessionProgressStatus,
	Settings,
	Source,
	SourceRef,
	Turn,
} from "../types";
import { createId } from "../utils/common";
import { normalizeKnowledgeLabel as normalizeLabel, reconcileKnowledgeGraph } from "../utils/knowledgeReconciliation";
import { forkSessionAtTurn } from "../utils/sessionFork";
import { announceForkDebug, createForkDebugSnapshot } from "../utils/forkDebug";
import { isTurnActive, syncSessionExecutionStatus } from "../utils/sessionRuntime";
import { archifyToMermaid, parseArchifySource } from "../shared/archify";
import { addUsage, emptyUsage } from "../utils/branchUsage";
import { errorToMessage } from "../shared/value";

interface AppState {
	sessions: SessionNode[];
	activeSessionId: string | null;
	visibleSessionId: string | null;
	turns: Turn[];
	entities: Entity[];
	relations: Relation[];
	diagrams: Diagram[];
	sources: Source[];
	changesets: ChangeSet[];
	settings: Settings;
	sidebarOpen: boolean;
	rightPaneOpen: boolean;
	selectedEntityId: string | null;
	selectedDiagramId: string | null;

	setActiveSession: (id: string) => void;
	setVisibleSession: (id: string | null) => void;
	setSelectedEntity: (id: string | null) => void;
	setSelectedDiagram: (id: string | null) => void;
	toggleSidebar: () => void;
	toggleRightPane: () => void;
	createRootSession: () => string;
	forkSession: (turnId: string) => { forkSessionId: string; originalSessionId: string; branchPointSessionId: string } | null;
	renameSession: (id: string, title: string, keepPending?: boolean) => void;
	setSessionProgressStatus: (id: string, status?: SessionProgressStatus) => void;
	deleteSession: (id: string) => void;
	setSessionStatus: (id: string, status: SessionNode["status"]) => void;
	addSessionTitleUsage: (id: string, usage?: import("../types").TokenUsage) => void;
	addTurnUsage: (id: string, usage?: import("../types").TokenUsage) => void;
	addManualTurn: (turn: Turn) => void;
	updateTurn: (turnId: string, patch: Partial<Turn>) => void;
	finalizeTurn: (sessionId: string, turnId: string, content: string, candidates?: KnowledgeCandidate[], relationCandidates?: KnowledgeRelationCandidate[], diagramCandidates?: KnowledgeDiagramCandidate[], sourceRefs?: SourceRef[]) => void;
	upsertSources: (sources: Source[]) => void;
	setSourceStatus: (id: string, patch: Partial<Source>) => void;
	archiveSource: (id: string) => void;
	saveEntity: (entity: Entity) => void;
	softDeleteEntity: (id: string) => void;
	saveRelation: (relation: Relation) => void;
	applyRelationCandidates: (candidates: KnowledgeRelationCandidate[]) => { created: number; updated: number };
	softDeleteRelation: (id: string) => void;
	saveDiagram: (diagram: Diagram) => void;
	softDeleteDiagram: (id: string) => void;
	undoChangeSet: (id: string) => void;
	acceptChangeSet: (id: string) => void;
	rejectChangeSet: (id: string) => void;
	updateSettings: (settings: Partial<Settings>) => void;
	reconcileKnowledge: () => void;
	pruneLegacyDiagrams: () => void;
}

const defaultSettings: Settings = {
	theme: "light",
	provider: "GitHub Copilot",
	defaultModel: "",
	autoExtract: true,
	strictConflict: true,
	knowledgeMode: "suggest",
	confidenceThreshold: 0.7,
	thinkingLevel: "medium",
	reduceMotion: false,
	highContrast: false,
	fontScale: 1,
	maxConcurrentRequests: 5,
	diagramRenderer: "archify",
};

let persistenceWorkspacePath: string | null = null;

export function setWorkspacePersistencePath(workspacePath: string | null): void {
	persistenceWorkspacePath = workspacePath;
}

const workspaceStorage: StateStorage = {
	getItem: (name) => {
		const bridge = window.knowbranch;
		return bridge ? bridge.appStateLoad() : window.localStorage.getItem(name);
	},
	setItem: (name, value) => {
		// UI updates can run while Zustand is still hydrating the workspace. Persisting
		// that transient default state would replace the data hydration is about to load.
		// During Vite HMR, however, a richer in-memory state must still be allowed through.
		const bridge = window.knowbranch;
		if (!bridge) {
			window.localStorage.setItem(name, value);
			return undefined;
		}
		if (!persistenceWorkspacePath) return undefined;
		const stampedValue = stampWorkspaceState(value, persistenceWorkspacePath);
		if (!useAppStore.persist.hasHydrated()) {
			const currentValue = bridge.appStateLoad();
			if (persistedStateScore(stampedValue) <= persistedStateScore(currentValue)) return undefined;
		}
		return bridge.appStateSave({ value: stampedValue, workspacePath: persistenceWorkspacePath }).then(
				() => undefined,
				(error: unknown) => {
					console.error("Failed to persist workspace state.", error);
				},
			);
	},
	removeItem: (name) => {
		if (!window.knowbranch) window.localStorage.removeItem(name);
	},
};

function stampWorkspaceState(value: string, workspacePath: string): string {
	const parsed = JSON.parse(value) as Record<string, unknown>;
	return JSON.stringify({ ...parsed, workspacePath });
}

function persistedStateScore(serialized: string | null): number {
	if (!serialized) return -1;
	try {
		const parsed = JSON.parse(serialized) as { state?: Partial<AppState> };
		const state = parsed.state;
		if (!state) return -1;
		return (state.turns?.length ?? 0) * 100
			+ (state.entities?.length ?? 0) * 20
			+ (state.diagrams?.length ?? 0) * 20
			+ (state.changesets?.length ?? 0) * 5
			+ (state.sources?.length ?? 0) * 2
			+ (state.sessions?.length ?? 0);
	} catch {
		return -1;
	}
}

export const useAppStore = create<AppState>()(
	persist(
		(set, get) => ({
			sessions: [],
			activeSessionId: null,
			visibleSessionId: null,
			turns: [],
			entities: [],
			relations: [],
			diagrams: [],
			sources: [],
			changesets: [],
			settings: defaultSettings,
			sidebarOpen: true,
			rightPaneOpen: false,
			selectedEntityId: null,
			selectedDiagramId: null,

			setActiveSession: (id) => set({ activeSessionId: id, visibleSessionId: id }),
			setVisibleSession: (id) => set({ visibleSessionId: id }),
			setSelectedEntity: (id) => set({ selectedEntityId: id, selectedDiagramId: null, rightPaneOpen: true }),
			setSelectedDiagram: (id) => set({ selectedDiagramId: id, selectedEntityId: null, rightPaneOpen: true }),
			toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
			toggleRightPane: () => set((state) => ({ rightPaneOpen: !state.rightPaneOpen })),

			createRootSession: () => {
				const id = createId("session");
				const newSession: SessionNode = {
					id,
					parentId: null,
					title: "New session",
					isRoot: true,
					status: "idle",
				};
				set((state) => ({
					sessions: [...state.sessions, newSession],
					activeSessionId: id,
					visibleSessionId: id,
				}));
				return id;
			},

			forkSession: (turnId) => {
				const state = get();
				const result = forkSessionAtTurn(state, turnId, createId);
				if (!result) return null;
				const debugSnapshot = createForkDebugSnapshot(state, turnId, result);
				set({ sessions: result.sessions, turns: result.turns, activeSessionId: result.forkSessionId, visibleSessionId: result.forkSessionId });
				const dumpWriter = typeof window !== "undefined" ? window.knowbranch?.forkDebugDump : undefined;
				if (typeof dumpWriter === "function") {
					void dumpWriter({
						kind: "fork",
						timestamp: debugSnapshot.timestamp,
						selectedTurnId: turnId,
						snapshot: debugSnapshot,
					}).then(
						(response) => announceForkDebug({ ok: true, message: `Fork dump: ${response.path}` }),
						(error: unknown) => announceForkDebug({ ok: false, message: `Fork dump failed: ${errorToMessage(error)}` }),
					);
				} else {
					announceForkDebug({ ok: false, message: "Fork dump unavailable. Restart Electron to load the updated preload bridge." });
				}
				return { forkSessionId: result.forkSessionId, originalSessionId: result.originalSessionId, branchPointSessionId: result.branchPointSessionId };
			},

			renameSession: (id, title, refreshOnNextPrompt = false) =>
				set((state) => ({
					sessions: state.sessions.map((session) =>
						session.id === id ? { ...session, title: title.trim() || session.title, titlePending: false, refreshTitleOnNextPrompt: refreshOnNextPrompt } : session,
					),
				})),
			setSessionProgressStatus: (id, status) =>
				set((state) => ({
					sessions: state.sessions.map((session) => session.id === id
						? { ...session, progressStatus: status }
						: session),
				})),
			deleteSession: (id) => {
				const state = get();
				const descendants = new Set<string>([id]);
				let added = true;
				while (added) {
					added = false;
					for (const session of state.sessions) {
						if (session.parentId && descendants.has(session.parentId) && !descendants.has(session.id)) {
							descendants.add(session.id);
							added = true;
						}
					}
				}
				let sessions = state.sessions.filter((session) => !descendants.has(session.id));
				let activeSessionId = state.activeSessionId;
				if (activeSessionId && descendants.has(activeSessionId)) {
					activeSessionId = state.sessions.find((session) => session.id === id)?.parentId ?? sessions[0]?.id ?? null;
				}
				if (sessions.length === 0) {
					const replacementId = createId("session");
					sessions = [{ id: replacementId, parentId: null, title: "New session", isRoot: true, status: "idle" }];
					activeSessionId = replacementId;
				}
				set({
					sessions,
					activeSessionId,
					visibleSessionId: activeSessionId,
					turns: state.turns.filter((turn) => !descendants.has(turn.sessionId)),
				});
			},
			setSessionStatus: (id, status) =>
				set((state) => ({
					sessions: state.sessions.map((session) =>
						session.id === id ? { ...session, status } : session,
					),
				})),
			addSessionTitleUsage: (id, usage) => {
				if (!usage) return;
				set((state) => ({
					sessions: state.sessions.map((session) => session.id === id
						? { ...session, titleUsage: addUsage(session.titleUsage ?? emptyUsage(), usage) }
						: session),
				}));
			},
			addTurnUsage: (id, usage) => {
				if (!usage) return;
				set((state) => ({
					turns: state.turns.map((turn) => turn.id === id
						? { ...turn, usage: addUsage(turn.usage ?? emptyUsage(), usage) }
						: turn),
				}));
			},
			addManualTurn: (turn) => set((state) => ({ turns: [...state.turns, turn] })),
			updateTurn: (turnId, patch) =>
				set((state) => ({
					turns: state.turns.map((turn) =>
						turn.id === turnId ? { ...turn, ...patch } : turn,
					),
				})),

			finalizeTurn: (sessionId, turnId, content, candidates = [], relationCandidates = [], diagramCandidates = [], sourceRefs = []) => {
				const state = get();
				if (!state.settings.autoExtract || state.settings.knowledgeMode === "read_only") {
					const completedAt = new Date().toISOString();
					set((current) => {
						const turns = current.turns.map((turn) => turn.id === turnId ? { ...turn, status: "complete" as const, completedAt } : turn);
						return { turns, sessions: syncSessionExecutionStatus(current.sessions, turns, sessionId) };
					});
					return;
				}
				const timestamp = new Date().toISOString();
				const operations: ChangeOperation[] = [];
				const nextEntities = [...state.entities];
				const nextRelations = [...state.relations];
				const mentions: EntityMention[] = [];
				const evidence = dedupeSourceRefs([{ sessionId, turnId }, ...sourceRefs]);

				for (const candidate of candidates.slice(0, 3)) {
					const existing = nextEntities.find(
						(entity) =>
							!entity.deletedAt &&
							(entity.id === candidate.existingEntityId || [entity.name, ...entity.aliases].some(
								(value) => value.toLocaleLowerCase() === candidate.name.toLocaleLowerCase(),
							)),
					);
					if (existing) {
						mentions.push({ id: existing.id, name: existing.name, type: existing.type });
						if (candidate.existingEntityId === existing.id) {
							const after: Entity = {
								...existing,
								name: candidate.name,
								type: candidate.type,
								summary: candidate.summary,
								content: candidate.content,
								confidence: candidate.confidence === "explicit" ? "confirmed" : existing.confidence,
								sourceRefs: dedupeSourceRefs([...existing.sourceRefs, ...evidence]),
								version: existing.version + 1,
								updatedAt: timestamp,
							};
							const index = nextEntities.findIndex((entity) => entity.id === existing.id);
							nextEntities[index] = after;
							operations.push({ kind: "entity", action: "update", objectId: after.id, label: after.name, before: existing, after });
						}
						continue;
					}
					const entity: Entity = {
						id: createId("entity"),
						name: candidate.name,
						aliases: [],
						type: candidate.type,
						summary: candidate.summary,
						content: candidate.content,
						confidence: candidate.confidence === "explicit" ? "confirmed" : "inferred",
						sourceRefs: evidence,
						version: 1,
						updatedAt: timestamp,
					};
					nextEntities.push(entity);
					mentions.push({ id: entity.id, name: entity.name, type: entity.type });
					operations.push({
						kind: "entity",
						action: "create",
						objectId: entity.id,
						label: entity.name,
						after: entity,
					});
				}

				for (const candidate of relationCandidates) {
					const source = findEntity(nextEntities, candidate.sourceEntityId, candidate.sourceName);
					const target = findEntity(nextEntities, candidate.targetEntityId, candidate.targetName);
					if (!source || !target || source.id === target.id) continue;
					const existing = nextRelations.find((relation) => !relation.deletedAt && relation.sourceEntityId === source.id && relation.targetEntityId === target.id && relation.type === candidate.type);
					if (existing) {
						if (!candidate.description || candidate.description === existing.description) continue;
						const after: Relation = { ...existing, description: candidate.description, confidence: candidate.confidence === "explicit" ? "confirmed" : existing.confidence, sourceRefs: dedupeSourceRefs([...existing.sourceRefs, ...evidence]), version: existing.version + 1 };
						nextRelations[nextRelations.findIndex((relation) => relation.id === existing.id)] = after;
						operations.push({ kind: "relation", action: "update", objectId: after.id, label: `${source.name} ${after.type} ${target.name}`, before: existing, after });
					} else {
						const relation: Relation = { id: createId("relation"), sourceEntityId: source.id, targetEntityId: target.id, type: candidate.type, description: candidate.description, confidence: candidate.confidence === "explicit" ? "confirmed" : "inferred", sourceRefs: evidence, version: 1 };
						nextRelations.push(relation);
						operations.push({ kind: "relation", action: "create", objectId: relation.id, label: `${source.name} ${relation.type} ${target.name}`, after: relation });
					}
				}

				const extractedDiagramResult = applyExtractedDiagrams(
					state.diagrams,
					diagramCandidates,
					nextEntities,
					sessionId,
					turnId,
					timestamp,
				);
				operations.push(...extractedDiagramResult.operations);
				const changeSetId = createId("changeset");
				const changeSet: ChangeSet = {
					id: changeSetId,
					title: "Knowledge finalization",
					timestamp,
					sessionId,
					turnId,
					summary: `${operations.filter((item) => item.kind === "entity").length} entities, ${operations.filter((item) => item.kind === "relation").length} relations, ${operations.filter((item) => item.kind === "diagram").length} diagram updates`,
					actor: "agent",
					status: state.settings.knowledgeMode === "suggest" ? "proposed" : "committed",
					operations,
				};
				set((current) => {
					const turns = current.turns.map((turn) =>
						turn.id === turnId
							? {
									...turn,
									content,
									status: "complete" as const,
									completedAt: timestamp,
									entities: mentions,
									changeSetId: operations.length ? changeSetId : undefined,
								}
							: turn,
					);
					return {
						entities: nextEntities,
						relations: nextRelations,
						diagrams: extractedDiagramResult.diagrams,
						changesets: operations.length ? [changeSet, ...current.changesets] : current.changesets,
						turns,
						sessions: syncSessionExecutionStatus(current.sessions, turns, sessionId),
					};
				});
			},

			upsertSources: (sources) =>
				set((state) => {
					const changedRevisions = new Map(sources.flatMap((source) => {
						const previous = state.sources.find((item) => item.id === source.id);
						return previous?.revision && source.revision && previous.revision !== source.revision ? [[source.id, source.revision] as const] : [];
					}));
					const markRefs = (refs: SourceRef[] = []) => refs.map((ref) => changedRevisions.has(ref.sourceId ?? "") && ref.revision !== changedRevisions.get(ref.sourceId ?? "") ? { ...ref, stale: true } : ref);
					const updates = new Map(sources.map((source) => [source.id, source]));
					const existingIds = new Set(state.sources.map((source) => source.id));
					return {
						sources: [
							...state.sources.map((source) => updates.get(source.id) ?? source),
							...sources.filter((source) => !existingIds.has(source.id)),
						],
						entities: changedRevisions.size ? state.entities.map((entity) => ({ ...entity, sourceRefs: markRefs(entity.sourceRefs) })) : state.entities,
						relations: changedRevisions.size ? state.relations.map((relation) => ({ ...relation, sourceRefs: markRefs(relation.sourceRefs) })) : state.relations,
						diagrams: changedRevisions.size ? state.diagrams.map((diagram) => ({ ...diagram, sourceRefs: markRefs(diagram.sourceRefs) })) : state.diagrams,
					};
				}),
			setSourceStatus: (id, patch) =>
				set((state) => ({
					sources: state.sources.map((source) =>
						source.id === id ? { ...source, ...patch } : source,
					),
				})),
			archiveSource: (id) =>
				set((state) => ({
					sources: state.sources.map((source) =>
						source.id === id ? { ...source, status: "archived" } : source,
					),
				})),

			saveEntity: (entity) => {
				const state = get();
				const before = state.entities.find((item) => item.id === entity.id);
				const after = { ...entity, version: (before?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
				const operation: ChangeOperation = {
					kind: "entity",
					action: before ? "update" : "create",
					objectId: after.id,
					label: after.name,
					before,
					after,
				};
				set((current) => ({
					entities: before
						? current.entities.map((item) => (item.id === after.id ? after : item))
						: [...current.entities, after],
					changesets: [manualChangeSet(operation), ...current.changesets],
				}));
			},
			softDeleteEntity: (id) => {
				const entity = get().entities.find((item) => item.id === id);
				if (!entity || entity.deletedAt) return;
				const timestamp = new Date().toISOString();
				const after = { ...entity, deletedAt: timestamp, version: entity.version + 1 };
				const operations: ChangeOperation[] = [{
					kind: "entity",
					action: "soft_delete",
					objectId: id,
					label: entity.name,
					before: entity,
					after,
				}];
				set((state) => ({
					entities: state.entities.map((item) => (item.id === id ? after : item)),
					relations: state.relations.map((relation) => {
						if (relation.deletedAt || (relation.sourceEntityId !== id && relation.targetEntityId !== id)) return relation;
						const deleted = { ...relation, deletedAt: timestamp, version: relation.version + 1 };
						operations.push({ kind: "relation", action: "soft_delete", objectId: relation.id, label: relation.type, before: relation, after: deleted });
						return deleted;
					}),
					changesets: [knowledgeChangeSet("Archived entity", operations), ...state.changesets],
					selectedEntityId: state.selectedEntityId === id ? null : state.selectedEntityId,
				}));
			},
				saveRelation: (relation) => {
					const before = get().relations.find((item) => item.id === relation.id);
					const after = { ...relation, version: (before?.version ?? 0) + 1 };
				const source = get().entities.find((entity) => entity.id === after.sourceEntityId)?.name ?? after.sourceEntityId;
				const target = get().entities.find((entity) => entity.id === after.targetEntityId)?.name ?? after.targetEntityId;
				const operation: ChangeOperation = { kind: "relation", action: before ? "update" : "create", objectId: after.id, label: `${source} ${after.type} ${target}`, before, after };
					set((state) => ({ relations: before ? state.relations.map((item) => item.id === after.id ? after : item) : [...state.relations, after], changesets: [manualChangeSet(operation), ...state.changesets] }));
				},
			applyRelationCandidates: (candidates) => {
				const state = get();
				const nextRelations = [...state.relations];
				const operations: ChangeOperation[] = [];
				let created = 0;
				let updated = 0;
				for (const candidate of candidates) {
					const source = findEntity(state.entities, candidate.sourceEntityId, candidate.sourceName);
					const target = findEntity(state.entities, candidate.targetEntityId, candidate.targetName);
					if (!source || !target || source.id === target.id) continue;
					const existing = nextRelations.find((relation) => !relation.deletedAt && relation.sourceEntityId === source.id && relation.targetEntityId === target.id && relation.type === candidate.type);
					if (existing) {
						const description = candidate.description || existing.description;
						const confidence = candidate.confidence === "explicit" ? "confirmed" as const : existing.confidence;
						if (description === existing.description && confidence === existing.confidence) continue;
						const after: Relation = { ...existing, description, confidence, sourceRefs: dedupeSourceRefs([...existing.sourceRefs, ...source.sourceRefs, ...target.sourceRefs]), version: existing.version + 1 };
						nextRelations[nextRelations.findIndex((relation) => relation.id === existing.id)] = after;
						operations.push({ kind: "relation", action: "update", objectId: after.id, label: `${source.name} ${after.type} ${target.name}`, before: existing, after });
						updated += 1;
						continue;
					}
					const relation: Relation = {
						id: createId("relation"),
						sourceEntityId: source.id,
						targetEntityId: target.id,
						type: candidate.type,
						description: candidate.description,
						confidence: candidate.confidence === "explicit" ? "confirmed" : "inferred",
						sourceRefs: dedupeSourceRefs([...source.sourceRefs, ...target.sourceRefs]),
						version: 1,
					};
					nextRelations.push(relation);
					operations.push({ kind: "relation", action: "create", objectId: relation.id, label: `${source.name} ${relation.type} ${target.name}`, after: relation });
					created += 1;
				}
				if (operations.length) {
					const timestamp = new Date().toISOString();
					const changeSet: ChangeSet = {
						id: createId("changeset"),
						title: "Rebuilt knowledge relations",
						timestamp,
						sessionId: state.activeSessionId ?? "system",
						summary: `${created} relations created, ${updated} updated by global knowledge scan.`,
						actor: "agent",
						status: state.settings.knowledgeMode === "suggest" ? "proposed" : "committed",
						operations,
					};
					set((current) => ({ relations: nextRelations, changesets: [changeSet, ...current.changesets] }));
				}
				return { created, updated };
			},
			softDeleteRelation: (id) => {
				const before = get().relations.find((item) => item.id === id);
				if (!before || before.deletedAt) return;
				const after = { ...before, deletedAt: new Date().toISOString(), version: before.version + 1 };
				const operation: ChangeOperation = { kind: "relation", action: "soft_delete", objectId: id, label: before.type, before, after };
				set((state) => ({ relations: state.relations.map((item) => item.id === id ? after : item), changesets: [manualChangeSet(operation), ...state.changesets] }));
			},
			saveDiagram: (diagram) => {
				const before = get().diagrams.find((item) => item.id === diagram.id);
				if (!before || before.deletedAt || !isMermaidSource(diagram.mermaidSource) || (diagram.archifySource !== undefined && !isArchifySource(diagram.archifySource))) return;
				const timestamp = new Date().toISOString();
				const normalizedDiagram = diagram.archifySource ? normalizeEditedArchifyDiagram(diagram, before) : diagram;
				const after: Diagram = {
					...normalizedDiagram,
					name: normalizedDiagram.name.trim() || before.name,
					version: before.version + 1,
					updatedAt: timestamp,
					versions: [...before.versions, {
						version: before.version + 1,
						timestamp,
						addedNodeIds: diagram.nodes.filter((node) => !before.nodes.some((item) => item.id === node.id)).map((node) => node.id),
						addedEdgeIds: diagram.edges.filter((edge) => !before.edges.some((item) => item.id === edge.id)).map((edge) => edge.id),
						removedNodeIds: before.nodes.filter((node) => !diagram.nodes.some((item) => item.id === node.id)).map((node) => node.id),
						removedEdgeIds: before.edges.filter((edge) => !diagram.edges.some((item) => item.id === edge.id)).map((edge) => edge.id),
					}],
				};
				const operation: ChangeOperation = { kind: "diagram", action: "update", objectId: after.id, label: after.name, before, after };
				set((state) => ({
					diagrams: state.diagrams.map((item) => (item.id === after.id ? after : item)),
					changesets: [manualChangeSet(operation), ...state.changesets],
				}));
			},
			softDeleteDiagram: (id) => {
				const before = get().diagrams.find((item) => item.id === id);
				if (!before || before.deletedAt) return;
				const after: Diagram = { ...before, deletedAt: new Date().toISOString(), version: before.version + 1 };
				const operation: ChangeOperation = { kind: "diagram", action: "soft_delete", objectId: id, label: before.name, before, after };
				set((state) => ({
					diagrams: state.diagrams.map((item) => (item.id === id ? after : item)),
					selectedDiagramId: state.selectedDiagramId === id ? null : state.selectedDiagramId,
					changesets: [manualChangeSet(operation), ...state.changesets],
				}));
			},

			undoChangeSet: (id) => {
				const state = get();
				const changeSet = state.changesets.find((item) => item.id === id);
				if (!changeSet || changeSet.status === "reverted") return;
				let entities = [...state.entities];
				let relations = [...state.relations];
				let diagrams = [...state.diagrams];
				for (const operation of [...changeSet.operations].reverse()) {
					if (operation.kind === "entity") entities = restoreObject(entities, operation);
					if (operation.kind === "relation") relations = restoreObject(relations, operation);
					if (operation.kind === "diagram") diagrams = restoreObject(diagrams, operation);
				}
				const undo: ChangeSet = {
					id: createId("changeset"),
					title: `Undo: ${changeSet.title}`,
					timestamp: new Date().toISOString(),
					sessionId: changeSet.sessionId,
					turnId: changeSet.turnId,
					summary: `Reverted ${changeSet.operations.length} object changes.`,
					actor: "user",
					status: "committed",
					operations: [],
					undoOf: id,
				};
				set((current) => ({
					entities,
					relations,
					diagrams,
					changesets: [
						undo,
						...current.changesets.map((item) =>
							item.id === id ? { ...item, status: "reverted" as const } : item,
						),
					],
				}));
			},
			acceptChangeSet: (id) =>
				set((state) => ({
					changesets: state.changesets.map((change) =>
						change.id === id && change.status === "proposed"
							? { ...change, status: "committed" as const }
							: change,
					),
				})),
			rejectChangeSet: (id) => {
				const state = get();
				const changeSet = state.changesets.find((item) => item.id === id);
				if (!changeSet || changeSet.status !== "proposed") return;
				let entities = [...state.entities];
				let relations = [...state.relations];
				let diagrams = [...state.diagrams];
				for (const operation of [...changeSet.operations].reverse()) {
					if (operation.kind === "entity") entities = restoreObject(entities, operation);
					if (operation.kind === "relation") relations = restoreObject(relations, operation);
					if (operation.kind === "diagram") diagrams = restoreObject(diagrams, operation);
				}
				set((current) => ({
					entities,
					relations,
					diagrams,
					changesets: current.changesets.map((item) => item.id === id ? { ...item, status: "superseded" as const } : item),
				}));
			},
			updateSettings: (newSettings) =>
				set((state) => ({ settings: { ...state.settings, ...newSettings, maxConcurrentRequests: Math.min(10, Math.max(1, Math.round(newSettings.maxConcurrentRequests ?? state.settings.maxConcurrentRequests) || 5)) } })),
			reconcileKnowledge: () => {
				const state = get();
				const timestamp = new Date().toISOString();
				const reconciled = reconcileKnowledgeGraph(state.entities, state.relations, state.diagrams, timestamp);
				if (reconciled.length === 0) return;
				const replacements = new Map(reconciled.map(({ after }) => [after.id, after]));
				const operations: ChangeOperation[] = reconciled.map(({ before, after }) => ({
					kind: "diagram",
					action: "update",
					objectId: after.id,
					label: after.name,
					before,
					after,
				}));
				const changeSet: ChangeSet = {
					id: createId("changeset"),
					title: "Knowledge reconciliation",
					timestamp,
					sessionId: state.activeSessionId ?? "system",
					summary: `Linked knowledge references in ${reconciled.length} diagram${reconciled.length === 1 ? "" : "s"}.`,
					actor: "agent",
					status: "committed",
					operations,
				};
				set((current) => ({
					diagrams: current.diagrams.map((diagram) => replacements.get(diagram.id) ?? diagram),
					changesets: [changeSet, ...current.changesets],
				}));
			},
			pruneLegacyDiagrams: () =>
				set((state) => {
					const diagrams = migrateMermaidDiagrams(state.diagrams);
					if (diagrams.length === state.diagrams.length) return state;
					const selectedStillExists = diagrams.some((diagram) => diagram.id === state.selectedDiagramId);
					return { diagrams, selectedDiagramId: selectedStillExists ? state.selectedDiagramId : null };
				}),
		}),
		{
			name: "knowbranch-workspace-v2",
			skipHydration: true,
			storage: createJSONStorage(() => workspaceStorage),
			version: 2,
			merge: (persisted, current) => {
				const saved = (persisted ?? {}) as Partial<AppState>;
				return {
					...current,
					...saved,
					sessions: recoverInterruptedSessions(saved.sessions ?? [], saved.turns ?? []),
					turns: recoverInterruptedTurns(saved.turns ?? []),
					settings: { ...defaultSettings, ...saved.settings },
					relations: saved.relations ?? [],
					diagrams: migrateMermaidDiagrams(saved.diagrams ?? []),
				};
			},
			partialize: (state) => ({
				sessions: state.sessions,
				activeSessionId: state.activeSessionId,
				turns: state.turns,
				entities: state.entities,
				relations: state.relations,
				diagrams: state.diagrams,
				sources: state.sources,
				changesets: state.changesets,
				settings: state.settings,
			}),
		},
	),
);

export function loadWorkspaceState(serialized: string | null): void {
	let saved: Partial<AppState> = {};
	if (serialized) {
		try {
			const envelope = JSON.parse(serialized) as { state?: Partial<AppState> };
			saved = envelope.state ?? {};
		} catch {
			saved = {};
		}
	}
	useAppStore.setState({
		sessions: recoverInterruptedSessions(saved.sessions ?? [], saved.turns ?? []),
		activeSessionId: saved.activeSessionId ?? null,
		visibleSessionId: saved.activeSessionId ?? null,
		turns: recoverInterruptedTurns(saved.turns ?? []),
		entities: saved.entities ?? [],
		relations: saved.relations ?? [],
		diagrams: migrateMermaidDiagrams(saved.diagrams ?? []),
		sources: saved.sources ?? [],
		changesets: saved.changesets ?? [],
		settings: normalizeSettings(saved.settings),
	});
}

function normalizeSettings(settings: Partial<Settings> | undefined): Settings {
	const legacy = (settings ?? {}) as Partial<Settings> & { enhancedDiagrams?: unknown };
	const { enhancedDiagrams, ...current } = legacy;
	const diagramRenderer = current.diagramRenderer === "archify" || current.diagramRenderer === "mermaid"
		? current.diagramRenderer
		: enhancedDiagrams === false ? "mermaid" : "archify";
	const theme = current.theme === "dark" ? "dark" : "light";
	return { ...defaultSettings, ...current, theme, diagramRenderer };
}

function recoverInterruptedTurns(turns: Turn[]): Turn[] {
	const recoveredAt = new Date().toISOString();
	return turns.map((turn) => isTurnActive(turn)
		? {
			...turn,
			content: turn.content || "The response was interrupted because the application closed before the agent finished.",
			status: "interrupted",
			summary: "Interrupted before completion",
			completedAt: recoveredAt,
			tools: turn.tools?.map((tool) => tool.status === "running" ? {
				...tool,
				status: "error" as const,
				completedAt: recoveredAt,
				durationMs: Math.max(0, new Date(recoveredAt).getTime() - new Date(tool.startedAt).getTime()),
			} : tool),
		}
		: turn);
}

function recoverInterruptedSessions(sessions: SessionNode[], turns: Turn[]): SessionNode[] {
	const interruptedSessionIds = new Set(turns
		.filter(isTurnActive)
		.map((turn) => turn.sessionId));
	return sessions.map((session) => ({
		...session,
		status: interruptedSessionIds.has(session.id)
			? "interrupted"
			: session.status === "running" ? "idle" : session.status,
		titlePending: false,
		refreshTitleOnNextPrompt: session.titlePending || session.refreshTitleOnNextPrompt,
	}));
}

function applyExtractedDiagrams(
	diagrams: Diagram[],
	candidates: KnowledgeDiagramCandidate[],
	entities: Entity[],
	sessionId: string,
	turnId: string,
	timestamp: string,
): { diagrams: Diagram[]; operations: ChangeOperation[] } {
	let nextDiagrams = [...diagrams];
	const operations: ChangeOperation[] = [];
	for (const candidate of candidates) {
		if (!isMermaidSource(candidate.mermaidSource)) continue;
		const existing = findMatchingDiagram(nextDiagrams, candidate);
		const nodeIds = new Map<string, string>();
		const nodes = candidate.nodes.map((node) => {
			const previous = existing?.nodes.find((item) => normalizeLabel(item.label) === normalizeLabel(node.label));
			const id = previous?.id ?? createId("diagram_node");
			nodeIds.set(node.key, id);
			const entity = entities.find((item) => !item.deletedAt && normalizeLabel(item.name) === normalizeLabel(node.label));
			return { id, entityId: entity?.id, label: node.label, type: node.type };
		});
		const edges = candidate.edges.flatMap((edge) => {
			const source = nodeIds.get(edge.sourceKey);
			const target = nodeIds.get(edge.targetKey);
			if (!source || !target) return [];
			const previous = existing?.edges.find((item) => item.source === source && item.target === target && normalizeLabel(item.label ?? "") === normalizeLabel(edge.label ?? ""));
			return [{ id: previous?.id ?? createId("diagram_edge"), source, target, label: edge.label }];
		});
		const version = (existing?.version ?? 0) + 1;
		const next: Diagram = {
			id: existing?.id ?? createId("diagram"),
			name: candidate.name,
			type: candidate.type,
			nodes,
			edges,
			mermaidSource: candidate.mermaidSource,
			archifySource: candidate.archifySource,
			archifyType: candidate.archifyType,
			sourceRefs: [...(existing?.sourceRefs ?? []), { sessionId, turnId }],
			version,
			versions: [
				...(existing?.versions ?? []),
				{
					version,
					timestamp,
					addedNodeIds: nodes.filter((node) => !existing?.nodes.some((item) => item.id === node.id)).map((node) => node.id),
					addedEdgeIds: edges.filter((edge) => !existing?.edges.some((item) => item.id === edge.id)).map((edge) => edge.id),
					removedNodeIds: existing?.nodes.filter((node) => !nodes.some((item) => item.id === node.id)).map((node) => node.id) ?? [],
					removedEdgeIds: existing?.edges.filter((edge) => !edges.some((item) => item.id === edge.id)).map((edge) => edge.id) ?? [],
				},
			],
			updatedAt: timestamp,
		};
		nextDiagrams = existing
			? nextDiagrams.map((diagram) => diagram.id === existing.id ? next : diagram)
			: [...nextDiagrams, next];
		operations.push({
			kind: "diagram",
			action: existing ? "update" : "create",
			objectId: next.id,
			label: next.name,
			before: existing,
			after: next,
		});
	}
	return { diagrams: nextDiagrams, operations };
}

function findMatchingDiagram(diagrams: Diagram[], candidate: KnowledgeDiagramCandidate): Diagram | undefined {
	const available = diagrams.filter((diagram) => !diagram.deletedAt && diagram.id !== "workspace-knowledge-map");
	const byId = candidate.existingDiagramId
		? available.find((diagram) => diagram.id === candidate.existingDiagramId)
		: undefined;
	if (byId) return byId;
	const byName = available.find((diagram) => normalizeLabel(diagram.name) === normalizeLabel(candidate.name));
	if (byName) return byName;
	const labels = new Set(candidate.nodes.map((node) => normalizeLabel(node.label)));
	return available
		.filter((diagram) => diagram.type === candidate.type)
		.map((diagram) => {
			const existingLabels = new Set(diagram.nodes.map((node) => normalizeLabel(node.label)));
			const overlap = [...labels].filter((label) => existingLabels.has(label)).length;
			const union = new Set([...labels, ...existingLabels]).size;
			return { diagram, score: union ? overlap / union : 0 };
		})
		.sort((left, right) => right.score - left.score)
		.find((item) => item.score >= 0.5)?.diagram;
}

function findEntity(entities: Entity[], id: string | undefined, name: string): Entity | undefined {
	return entities.find((entity) => !entity.deletedAt && (entity.id === id || [entity.name, ...entity.aliases].some((label) => normalizeLabel(label) === normalizeLabel(name))));
}

function dedupeSourceRefs(sourceRefs: SourceRef[]): SourceRef[] {
	const seen = new Set<string>();
	return sourceRefs.filter((source) => {
		const key = [source.sourceId, source.revision, source.path, source.lineStart, source.lineEnd, source.sessionId, source.turnId].join(":" );
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function migrateMermaidDiagrams(diagrams: Diagram[]): Diagram[] {
	return diagrams.filter((diagram) => isMermaidSource(diagram.mermaidSource));
}

function isMermaidSource(source: unknown): source is string {
	if (typeof source !== "string") return false;
	const firstLine = source
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith("%%"));
	return Boolean(firstLine && /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|mindmap|timeline|gitGraph|C4\w*)\b/i.test(firstLine));
}

function isArchifySource(source: unknown): source is string {
	if (typeof source !== "string" || source.length > 1_000_000) return false;
	try {
		parseArchifySource(source);
		return true;
	} catch {
		return false;
	}
}

function normalizeEditedArchifyDiagram(diagram: Diagram, before: Diagram): Diagram {
	const source = diagram.archifySource!;
	const parsed = parseArchifySource(source);
	const nodeIds = new Map<string, string>();
	const nodes = parsed.nodes.map((node) => {
		const previous = before.nodes.find((item) => normalizeLabel(item.label) === normalizeLabel(node.label));
		const id = previous?.id ?? createId("diagram_node");
		nodeIds.set(node.key, id);
		return { id, entityId: previous?.entityId, label: node.label, type: node.type };
	});
	const edges = parsed.edges.flatMap((edge) => {
		const sourceId = nodeIds.get(edge.sourceKey);
		const targetId = nodeIds.get(edge.targetKey);
		if (!sourceId || !targetId) return [];
		const previous = before.edges.find((item) => item.source === sourceId && item.target === targetId && normalizeLabel(item.label ?? "") === normalizeLabel(edge.label ?? ""));
		return [{ id: previous?.id ?? createId("diagram_edge"), source: sourceId, target: targetId, relationId: previous?.relationId, label: edge.label }];
	});
	return {
		...diagram,
		type: parsed.type,
		archifyType: parsed.type,
		mermaidSource: archifyToMermaid(source),
		nodes,
		edges,
	};
}

function manualChangeSet(operation: ChangeOperation): ChangeSet {
	return {
		id: createId("changeset"),
		title: `${operation.action === "create" ? "Created" : operation.action === "update" ? "Updated" : "Archived"} ${operation.label}`,
		timestamp: new Date().toISOString(),
		sessionId: "manual",
		summary: `${operation.kind} ${operation.action}`,
		actor: "user",
		status: "committed",
		operations: [operation],
	};
}

function knowledgeChangeSet(title: string, operations: ChangeOperation[]): ChangeSet {
	return {
		id: createId("changeset"),
		title,
		timestamp: new Date().toISOString(),
		sessionId: "manual",
		summary: `${operations.length} knowledge objects changed`,
		actor: "user",
		status: "committed",
		operations,
	};
}

function restoreObject<T extends { id: string }>(items: T[], operation: ChangeOperation): T[] {
	if (operation.before === undefined) return items.filter((item) => item.id !== operation.objectId);
	const before = operation.before as T;
	return items.some((item) => item.id === operation.objectId)
		? items.map((item) => (item.id === operation.objectId ? before : item))
		: [...items, before];
}
