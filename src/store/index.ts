import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
	ChangeSet,
	Entity,
	SessionNode,
	Settings,
	Source,
	Turn,
} from "../types";

interface AppState {
	sessions: SessionNode[];
	activeSessionId: string | null;
	turns: Turn[];
	entities: Entity[];
	sources: Source[];
	changesets: ChangeSet[];
	settings: Settings;
	sidebarOpen: boolean;
	rightPaneOpen: boolean;

	setActiveSession: (id: string) => void;
	toggleSidebar: () => void;
	toggleRightPane: () => void;

	createRootSession: () => void;
	forkSession: (turnId: string) => void;
	addTurn: (sessionId: string, content: string) => void;
	addManualTurn: (turn: Turn) => void;
	updateTurn: (turnId: string, patch: Partial<Turn>) => void;

	addSource: () => void;
	refreshSource: (id: string) => void;

	undoChangeSet: (id: string) => void;

	updateSettings: (settings: Partial<Settings>) => void;
}

const mockSessions: SessionNode[] = [
	{
		id: "1",
		parentId: null,
		title: "Understand Auth Flow",
		isRoot: true,
		status: "idle",
	},
	{
		id: "2",
		parentId: "1",
		title: "OAuth Provider Setup",
		isRoot: false,
		status: "idle",
	},
	{
		id: "3",
		parentId: "1",
		title: "JWT Token Refresh",
		isRoot: false,
		status: "idle",
	},
	{
		id: "4",
		parentId: null,
		title: "Architecture Review",
		isRoot: true,
		status: "idle",
	},
];

const mockTurns: Turn[] = [
	{
		id: "t1",
		sessionId: "1",
		role: "user",
		content: "How does authentication work in this project?",
		status: "complete",
		summary: "Ask about Auth",
	},
	{
		id: "t2",
		sessionId: "1",
		role: "assistant",
		content:
			"Authentication is handled via OAuth2 using GitHub Provider. The frontend uses a JWT token that is refreshed every 15 minutes. You can see the configuration in auth.ts.",
		status: "complete",
		summary: "Explain OAuth & JWT",
		entities: [
			{ id: "e1", name: "OAuth2", type: "Concept" },
			{ id: "e2", name: "auth.ts", type: "File" },
		],
		changeSetId: "cs1",
	},
];

const mockEntities: Entity[] = [
	{
		id: "e1",
		name: "OAuth2",
		type: "Concept",
		summary: "Industry-standard protocol for authorization.",
		content: "Delegated authorization framework...",
		confidence: "confirmed",
		version: 1,
	},
	{
		id: "e2",
		name: "auth.ts",
		type: "File",
		summary: "Main authentication configuration file.",
		content: "Contains GitHub Provider setup and JWT logic.",
		confidence: "confirmed",
		version: 1,
	},
];

const mockSources: Source[] = [
	{
		id: "s1",
		name: "frontend-client",
		path: "~/projects/frontend-client",
		fileCount: 1245,
		status: "indexed",
		type: "repo",
	},
	{
		id: "s2",
		name: "architecture-docs",
		path: "~/docs/architecture",
		fileCount: 42,
		status: "indexed",
		type: "docs",
	},
];

const mockChangeSets: ChangeSet[] = [
	{
		id: "cs1",
		title: "Extracted Authentication Flow",
		timestamp: new Date(Date.now() - 10 * 60000).toISOString(),
		sessionId: "1",
		turnId: "t2",
		summary:
			'Added 2 entities and 1 diagram based on "Understand Auth Flow" session.',
		addedEntities: [
			{ id: "e1", name: "OAuth2" },
			{ id: "e2", name: "auth.ts" },
		],
		addedRelations: 1,
		reverted: false,
	},
	{
		id: "cs2",
		title: "Initial Architecture Scan",
		timestamp: new Date(Date.now() - 120 * 60000).toISOString(),
		sessionId: "1",
		summary: "Batch import from frontend-client source indexing.",
		addedEntities: [{ id: "mock_45", name: "45 Entities" }],
		addedRelations: 120,
		reverted: false,
	},
];

export const useAppStore = create<AppState>()(
	persist(
		(set, get) => ({
			sessions: mockSessions,
			activeSessionId: "1",
			turns: mockTurns,
			entities: mockEntities,
			sources: mockSources,
			changesets: mockChangeSets,
			settings: {
				provider: "GitHub Copilot",
				defaultModel: "GPT-4o (Default)",
				autoExtract: true,
				strictConflict: true,
			},
			sidebarOpen: true,
			rightPaneOpen: true,

			setActiveSession: (id) => set({ activeSessionId: id }),
			toggleSidebar: () =>
				set((state) => ({ sidebarOpen: !state.sidebarOpen })),
			toggleRightPane: () =>
				set((state) => ({ rightPaneOpen: !state.rightPaneOpen })),

			createRootSession: () => {
				const id = Date.now().toString();
				const newSession: SessionNode = {
					id,
					parentId: null,
					title: "New Chat",
					isRoot: true,
					status: "idle",
				};
				set((state) => ({
					sessions: [...state.sessions, newSession],
					activeSessionId: id,
				}));
			},

			forkSession: (turnId: string) => {
				const state = get();
				const turn = state.turns.find((t) => t.id === turnId);
				if (!turn) return;
				const newId = Date.now().toString();
				const newSession: SessionNode = {
					id: newId,
					parentId: turn.sessionId,
					title: "Forked Chat",
					isRoot: false,
					status: "idle",
				};

				// Copy turns up to the forked turn
				const sessionTurns = state.turns.filter(
					(t) => t.sessionId === turn.sessionId,
				);
				const turnIndex = sessionTurns.findIndex((t) => t.id === turnId);
				const turnsToCopy = sessionTurns.slice(0, turnIndex + 1);

				const newTurns = turnsToCopy.map((t) => ({
					...t,
					id: Date.now().toString() + Math.random(),
					sessionId: newId,
				}));

				set((s) => ({
					sessions: [...s.sessions, newSession],
					turns: [...s.turns, ...newTurns],
					activeSessionId: newId,
				}));
			},

			addTurn: (sessionId: string, content: string) => {
				const userTurnId = Date.now().toString();
				const userTurn: Turn = {
					id: userTurnId,
					sessionId,
					role: "user",
					content,
					status: "complete",
					summary: `${content.substring(0, 15)}...`,
				};

				set((s) => ({ turns: [...s.turns, userTurn] }));

				// Mock assistant response
				setTimeout(() => {
					const s = get();
					const autoExtract = s.settings.autoExtract;
					const modelName = s.settings.defaultModel;

					const astTurnId = (Date.now() + 1).toString();
					const astTurn: Turn = {
						id: astTurnId,
						sessionId,
						role: "assistant",
						content: `[${modelName}] I analyzed your request. I found references to DataModel and Config.`,
						status: "complete",
						summary: "Analysis complete",
					};

					if (autoExtract) {
						const e1Id = `e_${Date.now()}_1`;
						const e2Id = `e_${Date.now()}_2`;
						
						astTurn.entities = [
							{ id: e1Id, name: "DataModel", type: "Component" },
							{ id: e2Id, name: "Config", type: "Concept" },
						];

						const newEntities: Entity[] = [
							{
								id: e1Id,
								name: "DataModel",
								type: "Component",
								summary: "Core data model.",
								content: "Extracted automatically.",
								confidence: "inferred",
								version: 1,
							},
							{
								id: e2Id,
								name: "Config",
								type: "Concept",
								summary: "System configuration.",
								content: "Extracted automatically.",
								confidence: "inferred",
								version: 1,
							},
						];

						const csId = `cs${Date.now()}`;
						const newCs: ChangeSet = {
							id: csId,
							title: "Extracted from conversation",
							timestamp: new Date().toISOString(),
							sessionId,
							turnId: astTurnId,
							summary: "Added 2 entities based on conversation",
							addedEntities: [
								{ id: e1Id, name: "DataModel" },
								{ id: e2Id, name: "Config" }
							],
							addedRelations: 0,
							reverted: false,
						};

						astTurn.changeSetId = csId;

						set((s) => ({
							turns: [...s.turns, astTurn],
							entities: [...s.entities, ...newEntities],
							changesets: [newCs, ...s.changesets],
						}));
					} else {
						set((s) => ({
							turns: [...s.turns, astTurn],
						}));
					}
				}, 800);
			},

			addManualTurn: (turn: Turn) => {
				set((s) => ({ turns: [...s.turns, turn] }));
			},

			updateTurn: (turnId: string, patch: Partial<Turn>) => {
				set((s) => ({
					turns: s.turns.map((turn) =>
						turn.id === turnId ? { ...turn, ...patch } : turn,
					),
				}));
			},

			addSource: () => {
				const newSource: Source = {
					id: `s${Date.now()}`,
					name: "new-service-backend",
					path: "~/projects/new-service",
					fileCount: 0,
					status: "scanning",
					type: "repo",
				};
				set((s) => ({ sources: [...s.sources, newSource] }));
				setTimeout(() => {
					set((s) => ({
						sources: s.sources.map((src) =>
							src.id === newSource.id
								? { ...src, status: "indexed", fileCount: 342 }
								: src,
						),
					}));
				}, 1500);
			},

			refreshSource: (id: string) => {
				set((s) => ({
					sources: s.sources.map((src) =>
						src.id === id ? { ...src, status: "scanning" } : src,
					),
				}));
				setTimeout(() => {
					set((s) => ({
						sources: s.sources.map((src) =>
							src.id === id
								? { ...src, status: "indexed", fileCount: src.fileCount + 5 }
								: src,
						),
					}));
				}, 1000);
			},

			undoChangeSet: (id: string) => {
				const state = get();
				const cs = state.changesets.find((c) => c.id === id);
				if (!cs || cs.reverted) return;

				const entityIdsToRemove = new Set(cs.addedEntities.map(e => e.id));

				set((s) => ({
					changesets: s.changesets.map((c) =>
						c.id === id ? { ...c, reverted: true } : c,
					),
					entities: s.entities.filter((e) => !entityIdsToRemove.has(e.id)),
				}));
			},

			updateSettings: (newSettings) => {
				set((s) => ({ settings: { ...s.settings, ...newSettings } }));
			},
		}),
		{
			name: "knowbranch-storage",
			partialize: (state) => ({ settings: state.settings }),
		},
	),
);
