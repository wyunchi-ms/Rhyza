import { create } from "zustand";
import {
	createJSONStorage,
	persist,
	type PersistStorage,
	type StorageValue,
} from "zustand/middleware";
import type {
	KnowledgeCandidate,
	KnowledgeDiagramCandidate,
	KnowledgeRelationCandidate,
	WorkspaceStateEnvelope,
} from "../shared/ipc";
import type {
	ChangeOperation,
	ChangeSet,
	Diagram,
	Entity,
	EntityMention,
	Relation,
	RightPaneView,
	SessionNode,
	SessionProgressStatus,
	PathSummarySnapshot,
	Settings,
	Source,
	SourceRef,
	Turn,
} from "../types";
import { createId } from "../utils/common";
import { isMermaidSource } from "../utils/mermaidSource";
import {
	normalizeKnowledgeLabel as normalizeLabel,
	reconcileKnowledgeGraph,
} from "../utils/knowledgeReconciliation";
import { cloneSessionNode, forkSessionAtTurn, forkSessionNode } from "../utils/sessionFork";
import { announceForkDebug, createForkDebugSnapshot } from "../utils/forkDebug";
import { isTurnActive, syncSessionExecutionStatus } from "../utils/sessionRuntime";
import { markTurnsRead, patchTurnReadState } from "../utils/turnReadState";
import { addUsage, emptyUsage } from "../utils/branchUsage";
import { errorToMessage, isRecord } from "../shared/value";
import { normalizeProviderSettings, updateProviderSettings } from "../shared/providers";
import {
	prioritizeKnowledgeSourceRefs,
	sourceRefsForKnowledgeScope,
} from "../utils/knowledgeExtraction";
import {
	measurePerformance,
	measurePerformanceWithFrame,
	recordPerformanceTiming,
} from "../utils/performanceMarks";
import { distinctStorage } from "../utils/distinctStorage";
import { normalizeLeafStatuses, type LeafStatusFilter } from "../utils/conversationFilter";
import {
	defaultLanguage,
	normalizeLanguage,
	readLanguagePreference,
	saveLanguagePreference,
} from "../i18n/language";

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
	leafStatuses: LeafStatusFilter[];
	rightPaneOpen: boolean;
	rightPaneView: RightPaneView;
	inspectedTurnId: string | null;
	selectedEntityId: string | null;
	selectedDiagramId: string | null;

	setActiveSession: (id: string) => void;
	setVisibleSession: (id: string | null) => void;
	setSelectedEntity: (id: string | null) => void;
	setSelectedDiagram: (id: string | null) => void;
	toggleSidebar: () => void;
	setLeafStatuses: (statuses: LeafStatusFilter[]) => void;
	toggleRightPane: () => void;
	openTurnInspector: (turnId: string, view: Exclude<RightPaneView, "todo">) => void;
	closeRightPane: () => void;
	createRootSession: () => string;
	createSummarySession: (
		content: string,
		snapshot: PathSummarySnapshot,
		usage?: import("../types").TokenUsage,
		prompt?: string,
	) => string;
	completeSummarySession: (
		id: string,
		content: string,
		usage?: import("../types").TokenUsage,
	) => void;
	addSessionSummaryUsage: (id: string, usage?: import("../types").TokenUsage) => void;
	forkSession: (
		turnId: string,
		options?: { activate?: boolean },
	) => { forkSessionId: string; originalSessionId: string; branchPointSessionId: string } | null;
	forkNode: (sessionId: string, turnId?: string) => string | null;
	cloneNode: (sessionId: string, turnId?: string) => string | null;
	renameSession: (id: string, title: string, keepPending?: boolean) => void;
	setSessionProgressStatus: (id: string, status?: SessionProgressStatus) => void;
	deleteSession: (id: string) => void;
	setSessionStatus: (id: string, status: SessionNode["status"]) => void;
	addSessionTitleUsage: (id: string, usage?: import("../types").TokenUsage) => void;
	addTurnUsage: (id: string, usage?: import("../types").TokenUsage) => void;
	addManualTurn: (turn: Turn) => void;
	updateTurn: (turnId: string, patch: Partial<Turn>) => void;
	markTurnRead: (turnId: string) => void;
	finalizeTurn: (
		sessionId: string,
		turnId: string,
		content: string,
		candidates?: KnowledgeCandidate[],
		relationCandidates?: KnowledgeRelationCandidate[],
		diagramCandidates?: KnowledgeDiagramCandidate[],
		sourceRefs?: SourceRef[],
	) => void;
	upsertSources: (sources: Source[]) => void;
	syncSources: (sources: Source[]) => void;
	setSourceStatus: (id: string, patch: Partial<Source>) => void;
	removeSource: (id: string) => void;
	saveEntity: (entity: Entity) => void;
	softDeleteEntity: (id: string) => void;
	saveRelation: (relation: Relation) => void;
	applyRelationCandidates: (candidates: KnowledgeRelationCandidate[]) => {
		created: number;
		updated: number;
	};
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
	language: readLanguagePreference() ?? defaultLanguage,
	theme: "light",
	provider: "github-copilot",
	defaultModel: "",
	autoExtract: true,
	knowledgeTools: true,
	strictConflict: true,
	knowledgeMode: "suggest",
	confidenceThreshold: 0.7,
	thinkingLevel: "medium",
	reduceMotion: false,
	highContrast: false,
	fontScale: 1,
	maxConcurrentRequests: 5,
};

function withoutModelRequestTelemetry(turn: Turn): Turn {
	if (!turn.modelRequests) return turn;
	const persistedTurn = { ...turn };
	delete persistedTurn.modelRequests;
	return persistedTurn;
}

// Preserve the projected array on UI-only updates so storage can skip serialization.
let lastSourceTurns: Turn[] | undefined;
let lastPersistedTurns: Turn[] = [];
function persistedTurns(turns: Turn[]): Turn[] {
	if (turns !== lastSourceTurns) {
		lastSourceTurns = turns;
		lastPersistedTurns = turns.map(withoutModelRequestTelemetry);
	}
	return lastPersistedTurns;
}

let persistenceWorkspacePath: string | null = null;
const workspaceStorageKey = "rhyza-workspace-v2";
const legacyWorkspaceStorageKey = `${["know", "branch"].join("")}-workspace-v2`;

export function setWorkspacePersistencePath(workspacePath: string | null): void {
	persistenceWorkspacePath = workspacePath;
}

export function getWorkspacePersistencePath(): string | null {
	return persistenceWorkspacePath;
}

type PersistedAppState = Pick<
	AppState,
	| "sessions"
	| "activeSessionId"
	| "turns"
	| "entities"
	| "relations"
	| "diagrams"
	| "sources"
	| "changesets"
	| "settings"
	| "leafStatuses"
>;

const localWorkspaceStorage = createJSONStorage<PersistedAppState>(() => ({
	getItem: (name) => {
		const current = window.localStorage.getItem(name);
		if (current || name !== workspaceStorageKey) return current;
		const legacy = window.localStorage.getItem(legacyWorkspaceStorageKey);
		if (legacy) window.localStorage.setItem(workspaceStorageKey, legacy);
		return legacy;
	},
	setItem: (name, value) => window.localStorage.setItem(name, value),
	removeItem: (name) => window.localStorage.removeItem(name),
}))!;

function workspaceEnvelope(
	value: string | WorkspaceStateEnvelope | null,
): WorkspaceStateEnvelope | null {
	if (value === null) return null;
	const envelope: unknown = typeof value === "string" ? JSON.parse(value) : value;
	if (!isRecord(envelope) || !isRecord(envelope.state))
		throw new Error("Invalid saved workspace state.");
	return {
		state: envelope.state,
		version: typeof envelope.version === "number" ? envelope.version : undefined,
		workspacePath: typeof envelope.workspacePath === "string" ? envelope.workspacePath : undefined,
	};
}

const workspaceStorage: PersistStorage<PersistedAppState> = {
	getItem: (name) => {
		const bridge = window.rhyza;
		if (!bridge) return localWorkspaceStorage.getItem(name);
		const workspacePath = persistenceWorkspacePath;
		return bridge.appStateLoad().then((value) => {
			if (workspacePath !== persistenceWorkspacePath)
				throw new Error("Workspace changed before saved state finished loading.");
			const envelope = workspaceEnvelope(value);
			if (!envelope) return null;
			return { state: envelope.state as PersistedAppState, version: envelope.version };
		});
	},
	setItem: (name, value) => {
		// UI updates can run while Zustand is still hydrating the workspace. Persisting
		// that transient default state would replace the data hydration is about to load.
		// During Vite HMR, however, a richer in-memory state must still be allowed through.
		const bridge = window.rhyza;
		if (!bridge) return localWorkspaceStorage.setItem(name, value);
		if (!persistenceWorkspacePath) return undefined;
		const workspacePath = persistenceWorkspacePath;
		const prepareStartedAt = performance.now();
		const stampedValue: WorkspaceStateEnvelope = { ...value, workspacePath };
		recordPerformanceTiming("state-persist-prepare", performance.now() - prepareStartedAt);
		const save = () => {
			const saveStartedAt = performance.now();
			return bridge.appStateSave({ value: stampedValue, workspacePath }).then(
				() => {
					recordPerformanceTiming("state-persist-roundtrip", performance.now() - saveStartedAt);
				},
				(error: unknown) => {
					recordPerformanceTiming(
						"state-persist-roundtrip-error",
						performance.now() - saveStartedAt,
					);
					console.error("Failed to persist workspace state.", error);
					throw error;
				},
			);
		};
		if (!useAppStore.persist.hasHydrated()) {
			return Promise.resolve(bridge.appStateLoad()).then((currentValue) => {
				if (persistenceWorkspacePath !== workspacePath) return;
				if (
					persistedStateScore(stampedValue) <= persistedStateScore(workspaceEnvelope(currentValue))
				)
					return;
				return save();
			});
		}
		return save();
	},
	removeItem: (name) => {
		if (!window.rhyza) return localWorkspaceStorage.removeItem(name);
	},
};

function persistedStateScore(
	value: WorkspaceStateEnvelope | StorageValue<PersistedAppState> | null,
): number {
	if (!value) return -1;
	const state = value.state;
	return (
		(Array.isArray(state.turns) ? state.turns.length : 0) * 100 +
		(Array.isArray(state.entities) ? state.entities.length : 0) * 20 +
		(Array.isArray(state.diagrams) ? state.diagrams.length : 0) * 20 +
		(Array.isArray(state.changesets) ? state.changesets.length : 0) * 5 +
		(Array.isArray(state.sources) ? state.sources.length : 0) * 2 +
		(Array.isArray(state.sessions) ? state.sessions.length : 0)
	);
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
			leafStatuses: [],
			rightPaneOpen: false,
			rightPaneView: "todo",
			inspectedTurnId: null,
			selectedEntityId: null,
			selectedDiagramId: null,

			setActiveSession: (id) => set({ activeSessionId: id, visibleSessionId: id }),
			setVisibleSession: (id) => set({ visibleSessionId: id }),
			setSelectedEntity: (id) => set({ selectedEntityId: id, selectedDiagramId: null }),
			setSelectedDiagram: (id) => set({ selectedDiagramId: id, selectedEntityId: null }),
			toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
			setLeafStatuses: (statuses) => set({ leafStatuses: normalizeLeafStatuses(statuses) }),
			toggleRightPane: () =>
				set((state) =>
					state.rightPaneOpen && state.rightPaneView === "todo"
						? { rightPaneOpen: false }
						: { rightPaneOpen: true, rightPaneView: "todo" },
				),
			openTurnInspector: (turnId, view) =>
				set({ inspectedTurnId: turnId, rightPaneView: view, rightPaneOpen: true }),
			closeRightPane: () => set({ rightPaneOpen: false }),

			createRootSession: () =>
				measurePerformanceWithFrame("node-create", () => {
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
				}),

			createSummarySession: (content, snapshot, usage, prompt) => {
				if (!snapshot.sources.length) throw new Error("A summary needs sources.");
				const id = createId("session");
				const userId = createId("turn");
				const title =
					content
						.split("\n")
						.find((line) => line.trim())
						?.replace(/^#+\s*/, "")
						.trim()
						.slice(0, 80) || "Path summary";
				const now = new Date().toISOString();
				const pending = !content.trim();
				set((state) => ({
					sessions: [
						...state.sessions,
						{ id, parentId: null, title, isRoot: true, status: pending ? "running" : "idle" },
					],
					turns: [
						...state.turns,
						{
							id: userId,
							sessionId: id,
							role: "user",
							content: prompt?.trim() || "Summarize the selected conversation paths.",
							summary: title,
							pathSummary: snapshot,
							status: "complete",
							createdAt: now,
						},
						{
							id: createId("turn"),
							sessionId: id,
							role: "assistant",
							content,
							status: pending ? "running" : "complete",
							unread: !pending,
							createdAt: now,
							...(!pending && { completedAt: now }),
							usage,
						},
					],
				}));
				return id;
			},
			completeSummarySession: (id, content, usage) => {
				if (!content.trim()) throw new Error("A summary needs content.");
				const state = get();
				if (!state.sessions.some((session) => session.id === id))
					throw new Error("The pending summary no longer exists.");
				const title =
					content
						.split("\n")
						.find((line) => line.trim())
						?.replace(/^#+\s*/, "")
						.trim()
						.slice(0, 80) || "Path summary";
				const now = new Date().toISOString();
				set((current) => ({
					sessions: current.sessions.map((session) =>
						session.id === id ? { ...session, title, status: "idle" } : session,
					),
					turns: current.turns.map((turn) =>
						turn.sessionId === id && turn.role === "assistant"
							? patchTurnReadState(turn, { content, status: "complete", completedAt: now, usage })
							: turn,
					),
				}));
			},
			addSessionSummaryUsage: (id, usage) => {
				if (!usage) return;
				set((state) => ({
					sessions: state.sessions.map((session) =>
						session.id === id
							? { ...session, summaryUsage: addUsage(session.summaryUsage ?? emptyUsage(), usage) }
							: session,
					),
				}));
			},

			forkSession: (turnId, options) => {
				const state = get();
				const result = measurePerformance("node-fork-plan", () =>
					forkSessionAtTurn(state, turnId, createId),
				);
				if (!result) return null;
				const debugSnapshot = measurePerformance("node-fork-debug-snapshot", () =>
					createForkDebugSnapshot(state, turnId, result),
				);
				// Splitting the displayed path moves its tail into the original continuation.
				const retainedSessionId = (id: string | null) =>
					id === result.branchPointSessionId ? result.originalSessionId : id;
				measurePerformance("node-fork-state", () =>
					set({
						sessions: result.sessions,
						turns: result.turns,
						activeSessionId:
							options?.activate === false
								? retainedSessionId(state.activeSessionId)
								: result.forkSessionId,
						visibleSessionId:
							options?.activate === false
								? retainedSessionId(state.visibleSessionId)
								: result.forkSessionId,
					}),
				);
				const dumpWriter = typeof window !== "undefined" ? window.rhyza?.forkDebugDump : undefined;
				if (typeof dumpWriter === "function") {
					void dumpWriter({
						kind: "fork",
						timestamp: debugSnapshot.timestamp,
						selectedTurnId: turnId,
						snapshot: debugSnapshot,
					}).then(
						(response) => announceForkDebug({ ok: true, message: `Fork dump: ${response.path}` }),
						(error: unknown) =>
							announceForkDebug({
								ok: false,
								message: `Fork dump failed: ${errorToMessage(error)}`,
							}),
					);
				} else {
					announceForkDebug({
						ok: false,
						message: "Fork dump unavailable. Restart Electron to load the updated preload bridge.",
					});
				}
				return {
					forkSessionId: result.forkSessionId,
					originalSessionId: result.originalSessionId,
					branchPointSessionId: result.branchPointSessionId,
				};
			},

			forkNode: (sessionId, turnId) => {
				const result = measurePerformance("node-fork-plan", () =>
					forkSessionNode(get(), sessionId, createId, turnId),
				);
				if (!result) return null;
				measurePerformance("node-fork-state", () =>
					set({
						sessions: result.sessions,
						turns: result.turns,
						activeSessionId: result.forkSessionId,
						visibleSessionId: result.forkSessionId,
					}),
				);
				return result.forkSessionId;
			},
			cloneNode: (sessionId, turnId) => {
				const result = measurePerformance("node-clone-plan", () =>
					cloneSessionNode(get(), sessionId, createId, turnId),
				);
				if (!result) return null;
				measurePerformance("node-clone-state", () =>
					set({
						sessions: result.sessions,
						turns: result.turns,
						activeSessionId: result.cloneSessionId,
						visibleSessionId: result.cloneSessionId,
					}),
				);
				return result.cloneSessionId;
			},

			renameSession: (id, title, refreshOnNextPrompt = false) =>
				set((state) => ({
					sessions: state.sessions.map((session) =>
						session.id === id
							? {
									...session,
									title: title.trim() || session.title,
									titlePending: false,
									refreshTitleOnNextPrompt: refreshOnNextPrompt,
								}
							: session,
					),
				})),
			setSessionProgressStatus: (id, status) =>
				set((state) => ({
					sessions: state.sessions.map((session) =>
						session.id === id ? { ...session, progressStatus: status } : session,
					),
				})),
			deleteSession: (id) => {
				const state = get();
				const descendants = new Set<string>([id]);
				let added = true;
				while (added) {
					added = false;
					for (const session of state.sessions) {
						if (
							session.parentId &&
							descendants.has(session.parentId) &&
							!descendants.has(session.id)
						) {
							descendants.add(session.id);
							added = true;
						}
					}
				}
				let sessions = state.sessions.filter((session) => !descendants.has(session.id));
				let activeSessionId = state.activeSessionId;
				if (activeSessionId && descendants.has(activeSessionId)) {
					activeSessionId =
						state.sessions.find((session) => session.id === id)?.parentId ??
						sessions[0]?.id ??
						null;
				}
				if (sessions.length === 0) {
					const replacementId = createId("session");
					sessions = [
						{
							id: replacementId,
							parentId: null,
							title: "New session",
							isRoot: true,
							status: "idle",
						},
					];
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
					sessions: state.sessions.map((session) =>
						session.id === id
							? { ...session, titleUsage: addUsage(session.titleUsage ?? emptyUsage(), usage) }
							: session,
					),
				}));
			},
			addTurnUsage: (id, usage) => {
				if (!usage) return;
				set((state) => ({
					turns: state.turns.map((turn) =>
						turn.id === id ? { ...turn, usage: addUsage(turn.usage ?? emptyUsage(), usage) } : turn,
					),
				}));
			},
			addManualTurn: (turn) => set((state) => ({ turns: [...state.turns, turn] })),
			updateTurn: (turnId, patch) =>
				set((state) => ({
					turns: state.turns.map((turn) =>
						turn.id === turnId ? patchTurnReadState(turn, patch) : turn,
					),
				})),
			markTurnRead: (turnId) =>
				set((state) => {
					const turns = markTurnsRead(state.turns, turnId);
					return turns === state.turns ? state : { turns };
				}),

			finalizeTurn: (
				sessionId,
				turnId,
				content,
				candidates = [],
				relationCandidates = [],
				diagramCandidates = [],
				sourceRefs = [],
			) => {
				const state = get();
				if (!state.settings.autoExtract || state.settings.knowledgeMode === "read_only") {
					const completedAt = new Date().toISOString();
					set((current) => {
						const turns = current.turns.map((turn) =>
							turn.id === turnId
								? patchTurnReadState(turn, { status: "complete", completedAt })
								: turn,
						);
						return {
							turns,
							sessions: syncSessionExecutionStatus(current.sessions, turns, sessionId),
						};
					});
					return;
				}
				const timestamp = new Date().toISOString();
				const operations: ChangeOperation[] = [];
				const nextEntities = [...state.entities];
				const nextRelations = [...state.relations];
				const mentions: EntityMention[] = [];
				const evidence = prioritizeKnowledgeSourceRefs(
					[{ sessionId, turnId }, ...sourceRefs],
					content,
				);

				for (const candidate of candidates.slice(0, 3)) {
					const candidateQuery = `${candidate.name} ${candidate.summary}`;
					const candidateEvidence = sourceRefsForKnowledgeScope(
						candidate.sourceScope,
						evidence,
						candidateQuery,
					);
					const existing = nextEntities.find(
						(entity) =>
							!entity.deletedAt &&
							(entity.id === candidate.existingEntityId ||
								[entity.name, ...entity.aliases].some(
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
								sourceScope: candidate.sourceScope,
								sourceRefs: sourceRefsForKnowledgeScope(
									candidate.sourceScope,
									[...existing.sourceRefs, ...candidateEvidence],
									candidateQuery,
								),
								version: existing.version + 1,
								updatedAt: timestamp,
							};
							const index = nextEntities.findIndex((entity) => entity.id === existing.id);
							nextEntities[index] = after;
							operations.push({
								kind: "entity",
								action: "update",
								objectId: after.id,
								label: after.name,
								before: existing,
								after,
							});
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
						sourceScope: candidate.sourceScope,
						sourceRefs: candidateEvidence,
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
					const existing = nextRelations.find(
						(relation) =>
							!relation.deletedAt &&
							relation.sourceEntityId === source.id &&
							relation.targetEntityId === target.id &&
							relation.type === candidate.type,
					);
					if (existing) {
						if (!candidate.description || candidate.description === existing.description) continue;
						const after: Relation = {
							...existing,
							description: candidate.description,
							confidence: candidate.confidence === "explicit" ? "confirmed" : existing.confidence,
							sourceRefs: dedupeSourceRefs([...existing.sourceRefs, ...evidence]),
							version: existing.version + 1,
						};
						nextRelations[nextRelations.findIndex((relation) => relation.id === existing.id)] =
							after;
						operations.push({
							kind: "relation",
							action: "update",
							objectId: after.id,
							label: `${source.name} ${after.type} ${target.name}`,
							before: existing,
							after,
						});
					} else {
						const relation: Relation = {
							id: createId("relation"),
							sourceEntityId: source.id,
							targetEntityId: target.id,
							type: candidate.type,
							description: candidate.description,
							confidence: candidate.confidence === "explicit" ? "confirmed" : "inferred",
							sourceRefs: evidence,
							version: 1,
						};
						nextRelations.push(relation);
						operations.push({
							kind: "relation",
							action: "create",
							objectId: relation.id,
							label: `${source.name} ${relation.type} ${target.name}`,
							after: relation,
						});
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
							? patchTurnReadState(turn, {
									content,
									status: "complete",
									completedAt: timestamp,
									entities: mentions,
									changeSetId: operations.length ? changeSetId : undefined,
								})
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

			upsertSources: (sources) => set((state) => sourceStateUpdates(state, sources, false)),
			syncSources: (sources) => set((state) => sourceStateUpdates(state, sources, true)),
			setSourceStatus: (id, patch) =>
				set((state) => ({
					sources: state.sources.map((source) =>
						source.id === id ? { ...source, ...patch } : source,
					),
				})),
			removeSource: (id) =>
				set((state) => ({
					sources: state.sources.filter((source) => source.id !== id),
				})),

			saveEntity: (entity) => {
				if (!entity.name.trim()) throw new Error("Enter an entity name.");
				if (!entity.type.trim()) throw new Error("Enter an entity type.");
				const state = get();
				const before = state.entities.find((item) => item.id === entity.id);
				const after = {
					...entity,
					name: entity.name.trim(),
					type: entity.type.trim(),
					version: (before?.version ?? 0) + 1,
					updatedAt: new Date().toISOString(),
				};
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
				const operations: ChangeOperation[] = [
					{
						kind: "entity",
						action: "soft_delete",
						objectId: id,
						label: entity.name,
						before: entity,
						after,
					},
				];
				set((state) => ({
					entities: state.entities.map((item) => (item.id === id ? after : item)),
					relations: state.relations.map((relation) => {
						if (
							relation.deletedAt ||
							(relation.sourceEntityId !== id && relation.targetEntityId !== id)
						)
							return relation;
						const deleted = { ...relation, deletedAt: timestamp, version: relation.version + 1 };
						operations.push({
							kind: "relation",
							action: "soft_delete",
							objectId: relation.id,
							label: relation.type,
							before: relation,
							after: deleted,
						});
						return deleted;
					}),
					changesets: [knowledgeChangeSet("Archived entity", operations), ...state.changesets],
					selectedEntityId: state.selectedEntityId === id ? null : state.selectedEntityId,
				}));
			},
			saveRelation: (relation) => {
				const before = get().relations.find((item) => item.id === relation.id);
				const after = { ...relation, version: (before?.version ?? 0) + 1 };
				const source =
					get().entities.find((entity) => entity.id === after.sourceEntityId)?.name ??
					after.sourceEntityId;
				const target =
					get().entities.find((entity) => entity.id === after.targetEntityId)?.name ??
					after.targetEntityId;
				const operation: ChangeOperation = {
					kind: "relation",
					action: before ? "update" : "create",
					objectId: after.id,
					label: `${source} ${after.type} ${target}`,
					before,
					after,
				};
				set((state) => ({
					relations: before
						? state.relations.map((item) => (item.id === after.id ? after : item))
						: [...state.relations, after],
					changesets: [manualChangeSet(operation), ...state.changesets],
				}));
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
					const existing = nextRelations.find(
						(relation) =>
							!relation.deletedAt &&
							relation.sourceEntityId === source.id &&
							relation.targetEntityId === target.id &&
							relation.type === candidate.type,
					);
					if (existing) {
						const description = candidate.description || existing.description;
						const confidence =
							candidate.confidence === "explicit" ? ("confirmed" as const) : existing.confidence;
						if (description === existing.description && confidence === existing.confidence)
							continue;
						const after: Relation = {
							...existing,
							description,
							confidence,
							sourceRefs: dedupeSourceRefs([
								...existing.sourceRefs,
								...source.sourceRefs,
								...target.sourceRefs,
							]),
							version: existing.version + 1,
						};
						nextRelations[nextRelations.findIndex((relation) => relation.id === existing.id)] =
							after;
						operations.push({
							kind: "relation",
							action: "update",
							objectId: after.id,
							label: `${source.name} ${after.type} ${target.name}`,
							before: existing,
							after,
						});
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
					operations.push({
						kind: "relation",
						action: "create",
						objectId: relation.id,
						label: `${source.name} ${relation.type} ${target.name}`,
						after: relation,
					});
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
					set((current) => ({
						relations: nextRelations,
						changesets: [changeSet, ...current.changesets],
					}));
				}
				return { created, updated };
			},
			softDeleteRelation: (id) => {
				const before = get().relations.find((item) => item.id === id);
				if (!before || before.deletedAt) return;
				const after = {
					...before,
					deletedAt: new Date().toISOString(),
					version: before.version + 1,
				};
				const operation: ChangeOperation = {
					kind: "relation",
					action: "soft_delete",
					objectId: id,
					label: before.type,
					before,
					after,
				};
				set((state) => ({
					relations: state.relations.map((item) => (item.id === id ? after : item)),
					changesets: [manualChangeSet(operation), ...state.changesets],
				}));
			},
			saveDiagram: (diagram) => {
				const before = get().diagrams.find((item) => item.id === diagram.id);
				if (!before || before.deletedAt) throw new Error("This diagram is no longer available.");
				if (!diagram.name.trim()) throw new Error("Enter a diagram name.");
				if (!isMermaidSource(diagram.mermaidSource))
					throw new Error("Start the source with a supported Mermaid diagram declaration.");
				const timestamp = new Date().toISOString();
				const normalizedDiagram = diagram;
				const after: Diagram = {
					...normalizedDiagram,
					name: normalizedDiagram.name.trim(),
					version: before.version + 1,
					updatedAt: timestamp,
					versions: [
						...before.versions,
						{
							version: before.version + 1,
							timestamp,
							addedNodeIds: diagram.nodes
								.filter((node) => !before.nodes.some((item) => item.id === node.id))
								.map((node) => node.id),
							addedEdgeIds: diagram.edges
								.filter((edge) => !before.edges.some((item) => item.id === edge.id))
								.map((edge) => edge.id),
							removedNodeIds: before.nodes
								.filter((node) => !diagram.nodes.some((item) => item.id === node.id))
								.map((node) => node.id),
							removedEdgeIds: before.edges
								.filter((edge) => !diagram.edges.some((item) => item.id === edge.id))
								.map((edge) => edge.id),
						},
					],
				};
				const operation: ChangeOperation = {
					kind: "diagram",
					action: "update",
					objectId: after.id,
					label: after.name,
					before,
					after,
				};
				set((state) => ({
					diagrams: state.diagrams.map((item) => (item.id === after.id ? after : item)),
					changesets: [manualChangeSet(operation), ...state.changesets],
				}));
			},
			softDeleteDiagram: (id) => {
				const before = get().diagrams.find((item) => item.id === id);
				if (!before || before.deletedAt) return;
				const after: Diagram = {
					...before,
					deletedAt: new Date().toISOString(),
					version: before.version + 1,
				};
				const operation: ChangeOperation = {
					kind: "diagram",
					action: "soft_delete",
					objectId: id,
					label: before.name,
					before,
					after,
				};
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
					changesets: current.changesets.map((item) =>
						item.id === id ? { ...item, status: "superseded" as const } : item,
					),
				}));
			},
			updateSettings: (newSettings) => {
				if (newSettings.language) saveLanguagePreference(newSettings.language);
				set((state) => ({
					settings: {
						...state.settings,
						...newSettings,
						...updateProviderSettings(state.settings, newSettings),
						maxConcurrentRequests: Math.min(
							10,
							Math.max(
								1,
								Math.round(
									newSettings.maxConcurrentRequests ?? state.settings.maxConcurrentRequests,
								) || 5,
							),
						),
					},
				}));
			},
			reconcileKnowledge: () => {
				const state = get();
				const timestamp = new Date().toISOString();
				const reconciled = reconcileKnowledgeGraph(
					state.entities,
					state.relations,
					state.diagrams,
					timestamp,
				);
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
					const selectedStillExists = diagrams.some(
						(diagram) => diagram.id === state.selectedDiagramId,
					);
					return {
						diagrams,
						selectedDiagramId: selectedStillExists ? state.selectedDiagramId : null,
					};
				}),
		}),
		{
			name: workspaceStorageKey,
			onRehydrateStorage: () => (_state, error) => {
				if (error) console.error("Failed to load workspace state.", error);
			},
			skipHydration: true,
			storage: distinctStorage(workspaceStorage, () => {
				if (!useAppStore.persist.hasHydrated()) return undefined;
				return window.rhyza ? (persistenceWorkspacePath ?? undefined) : "localStorage";
			}),
			version: 2,
			merge: (persisted, current) => {
				const saved = (persisted ?? {}) as Partial<AppState>;
				return {
					...current,
					...saved,
					sessions: recoverInterruptedSessions(saved.sessions ?? [], saved.turns ?? []),
					turns: recoverInterruptedTurns(saved.turns ?? []),
					settings: normalizeSettings(saved.settings),
					relations: saved.relations ?? [],
					diagrams: migrateMermaidDiagrams(saved.diagrams ?? []),
					leafStatuses: normalizeLeafStatuses(saved.leafStatuses),
				};
			},
			partialize: (state) => ({
				sessions: state.sessions,
				activeSessionId: state.activeSessionId,
				turns: persistedTurns(state.turns),
				entities: state.entities,
				relations: state.relations,
				diagrams: state.diagrams,
				sources: state.sources,
				changesets: state.changesets,
				settings: state.settings,
				leafStatuses: state.leafStatuses,
			}),
		},
	),
);

function sourceStateUpdates(state: AppState, sources: Source[], replace: boolean) {
	const changedRevisions = new Map(
		sources.flatMap((source) => {
			const previous = state.sources.find((item) => item.id === source.id);
			return previous?.revision && source.revision && previous.revision !== source.revision
				? [[source.id, source.revision] as const]
				: [];
		}),
	);
	const markRefs = (refs: SourceRef[] = []) =>
		refs.map((ref) =>
			changedRevisions.has(ref.sourceId ?? "") &&
			ref.revision !== changedRevisions.get(ref.sourceId ?? "")
				? { ...ref, stale: true }
				: ref,
		);
	const updates = new Map(sources.map((source) => [source.id, source]));
	const existingIds = new Set(state.sources.map((source) => source.id));
	return {
		sources: replace
			? sources
			: [
					...state.sources.map((source) => updates.get(source.id) ?? source),
					...sources.filter((source) => !existingIds.has(source.id)),
				],
		entities: changedRevisions.size
			? state.entities.map((entity) => ({ ...entity, sourceRefs: markRefs(entity.sourceRefs) }))
			: state.entities,
		relations: changedRevisions.size
			? state.relations.map((relation) => ({
					...relation,
					sourceRefs: markRefs(relation.sourceRefs),
				}))
			: state.relations,
		diagrams: changedRevisions.size
			? state.diagrams.map((diagram) => ({ ...diagram, sourceRefs: markRefs(diagram.sourceRefs) }))
			: state.diagrams,
	};
}

export function loadWorkspaceState(serialized: string | WorkspaceStateEnvelope | null): void {
	let saved: Partial<AppState> = {};
	if (serialized) {
		try {
			const envelope = workspaceEnvelope(serialized);
			saved = (envelope?.state ?? {}) as Partial<AppState>;
		} catch {
			saved = {};
		}
	}
	const activeAnswerSessions = new Set(
		(saved.turns ?? [])
			.filter((turn) => turn.role === "assistant" && isTurnActive(turn))
			.map((turn) => turn.sessionId),
	);
	const pendingSummaryTurns = (saved.turns ?? []).filter(
		(turn) => turn.role === "user" && turn.pathSummary && activeAnswerSessions.has(turn.sessionId),
	);
	const pendingSummaries = new Set(pendingSummaryTurns.map((turn) => turn.sessionId));
	const restoredSessions = (saved.sessions ?? []).filter(
		(session) => !pendingSummaries.has(session.id),
	);
	const restoredIds = new Set(restoredSessions.map((session) => session.id));
	const activeSessionId = pendingSummaries.has(saved.activeSessionId ?? "")
		? (pendingSummaryTurns
				.find((turn) => turn.sessionId === saved.activeSessionId)
				?.pathSummary?.sources.map((source) => source.sessionId)
				.find((id) => restoredIds.has(id)) ??
			restoredSessions[0]?.id ??
			null)
		: (saved.activeSessionId ?? null);
	const restoredTurns = (saved.turns ?? []).filter((turn) => !pendingSummaries.has(turn.sessionId));
	useAppStore.setState({
		sessions: recoverInterruptedSessions(restoredSessions, restoredTurns),
		activeSessionId,
		visibleSessionId: activeSessionId,
		turns: recoverInterruptedTurns(restoredTurns),
		entities: saved.entities ?? [],
		relations: saved.relations ?? [],
		diagrams: migrateMermaidDiagrams(saved.diagrams ?? []),
		sources: saved.sources ?? [],
		changesets: saved.changesets ?? [],
		settings: normalizeSettings(saved.settings),
		leafStatuses: normalizeLeafStatuses(saved.leafStatuses),
	});
}

function normalizeSettings(settings: Partial<Settings> | undefined): Settings {
	const current = settings ?? {};
	const theme = current.theme === "dark" ? "dark" : "light";
	const language = readLanguagePreference() ?? normalizeLanguage(current.language);
	return { ...defaultSettings, ...current, ...normalizeProviderSettings(current), theme, language };
}

function recoverInterruptedTurns(turns: Turn[]): Turn[] {
	const recoveredAt = new Date().toISOString();
	return turns.map((turn) =>
		isTurnActive(turn)
			? {
					...turn,
					content:
						turn.content ||
						"The response was interrupted because the application closed before the agent finished.",
					status: "interrupted",
					summary: "Interrupted before completion",
					completedAt: recoveredAt,
					tools: turn.tools?.map((tool) =>
						tool.status === "running"
							? {
									...tool,
									status: "error" as const,
									completedAt: recoveredAt,
									durationMs: Math.max(
										0,
										new Date(recoveredAt).getTime() - new Date(tool.startedAt).getTime(),
									),
								}
							: tool,
					),
				}
			: turn,
	);
}

function recoverInterruptedSessions(sessions: SessionNode[], turns: Turn[]): SessionNode[] {
	const interruptedSessionIds = new Set(turns.filter(isTurnActive).map((turn) => turn.sessionId));
	return sessions.map((session) => ({
		...session,
		status: interruptedSessionIds.has(session.id)
			? "interrupted"
			: session.status === "running"
				? "idle"
				: session.status,
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
			const previous = existing?.nodes.find(
				(item) => normalizeLabel(item.label) === normalizeLabel(node.label),
			);
			const id = previous?.id ?? createId("diagram_node");
			nodeIds.set(node.key, id);
			const entity = entities.find(
				(item) => !item.deletedAt && normalizeLabel(item.name) === normalizeLabel(node.label),
			);
			return { id, entityId: entity?.id, label: node.label, type: node.type };
		});
		const edges = candidate.edges.flatMap((edge) => {
			const source = nodeIds.get(edge.sourceKey);
			const target = nodeIds.get(edge.targetKey);
			if (!source || !target) return [];
			const previous = existing?.edges.find(
				(item) =>
					item.source === source &&
					item.target === target &&
					normalizeLabel(item.label ?? "") === normalizeLabel(edge.label ?? ""),
			);
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

			sourceRefs: [...(existing?.sourceRefs ?? []), { sessionId, turnId }],
			version,
			versions: [
				...(existing?.versions ?? []),
				{
					version,
					timestamp,
					addedNodeIds: nodes
						.filter((node) => !existing?.nodes.some((item) => item.id === node.id))
						.map((node) => node.id),
					addedEdgeIds: edges
						.filter((edge) => !existing?.edges.some((item) => item.id === edge.id))
						.map((edge) => edge.id),
					removedNodeIds:
						existing?.nodes
							.filter((node) => !nodes.some((item) => item.id === node.id))
							.map((node) => node.id) ?? [],
					removedEdgeIds:
						existing?.edges
							.filter((edge) => !edges.some((item) => item.id === edge.id))
							.map((edge) => edge.id) ?? [],
				},
			],
			updatedAt: timestamp,
		};
		nextDiagrams = existing
			? nextDiagrams.map((diagram) => (diagram.id === existing.id ? next : diagram))
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

function findMatchingDiagram(
	diagrams: Diagram[],
	candidate: KnowledgeDiagramCandidate,
): Diagram | undefined {
	const available = diagrams.filter(
		(diagram) => !diagram.deletedAt && diagram.id !== "workspace-knowledge-map",
	);
	const byId = candidate.existingDiagramId
		? available.find((diagram) => diagram.id === candidate.existingDiagramId)
		: undefined;
	if (byId) return byId;
	const byName = available.find(
		(diagram) => normalizeLabel(diagram.name) === normalizeLabel(candidate.name),
	);
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
	return entities.find(
		(entity) =>
			!entity.deletedAt &&
			(entity.id === id ||
				[entity.name, ...entity.aliases].some(
					(label) => normalizeLabel(label) === normalizeLabel(name),
				)),
	);
}

function dedupeSourceRefs(sourceRefs: SourceRef[]): SourceRef[] {
	const seen = new Set<string>();
	return sourceRefs.filter((source) => {
		const key = [
			source.sourceId,
			source.revision,
			source.path,
			source.lineStart,
			source.lineEnd,
			source.sessionId,
			source.turnId,
		].join(":");
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function migrateMermaidDiagrams(diagrams: Diagram[]): Diagram[] {
	return diagrams.filter((diagram) => isMermaidSource(diagram.mermaidSource));
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
