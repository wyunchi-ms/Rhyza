import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppStateStore } from "../electron/main/app-state-store.js";
import type {
	AppStateSaveRequest,
	RhyzaBridge,
	WorkspaceStateEnvelope,
} from "../src/shared/ipc.js";
import {
	getWorkspacePersistencePath,
	loadWorkspaceState,
	setWorkspacePersistencePath,
	useAppStore,
} from "../src/store/index.js";
import { normalizeLeafStatuses, type LeafStatusFilter } from "../src/utils/conversationFilter.js";

const storageKey = "rhyza-workspace-v2";

async function withStorage(run: (storage: Map<string, string>) => void | Promise<void>) {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const originalState = useAppStore.getState();
	const originalPath = getWorkspacePersistencePath();
	const storage = new Map<string, string>();
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key),
			},
		},
	});
	try {
		await run(storage);
	} finally {
		setWorkspacePersistencePath(null);
		useAppStore.setState(originalState, true);
		setWorkspacePersistencePath(originalPath);
		if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
		else Reflect.deleteProperty(globalThis, "window");
	}
}

test("saved leaf status selections are normalized without losing supported states", () => {
	assert.deepEqual(
		normalizeLeafStatuses([
			"unmarked",
			"todo",
			"in_progress",
			"complete",
			"parked",
			"complete",
			"invalid",
			null,
			42,
		]),
		["unmarked", "todo", "in_progress", "complete", "parked"],
	);
	for (const value of [undefined, null, "complete", { complete: true }]) {
		assert.deepEqual(normalizeLeafStatuses(value), []);
	}
});

test("filter selections and clearing persist through app hydration", async () => {
	await withStorage(async (storage) => {
		loadWorkspaceState(
			JSON.stringify({
				state: {
					sessions: [{ id: "chat", parentId: null, title: "Chat", isRoot: true, status: "idle" }],
					activeSessionId: "chat",
				},
			}),
		);
		const sessions = useAppStore.getState().sessions;
		const selection: LeafStatusFilter[] = ["complete", "todo", "unmarked"];
		useAppStore.getState().setLeafStatuses(selection);
		const saved = storage.get(storageKey)!;
		assert.deepEqual(JSON.parse(saved).state.leafStatuses, selection);
		assert.equal(useAppStore.getState().activeSessionId, "chat");
		assert.strictEqual(useAppStore.getState().sessions, sessions);
		selection.push("parked");
		assert.deepEqual(useAppStore.getState().leafStatuses, ["complete", "todo", "unmarked"]);

		useAppStore.getState().setLeafStatuses([]);
		storage.set(storageKey, saved);
		await useAppStore.persist.rehydrate();
		assert.deepEqual(useAppStore.getState().leafStatuses, ["complete", "todo", "unmarked"]);

		useAppStore.getState().setLeafStatuses([]);
		const cleared = storage.get(storageKey)!;
		assert.deepEqual(JSON.parse(cleared).state.leafStatuses, []);
		useAppStore.getState().setLeafStatuses(["parked"]);
		storage.set(storageKey, cleared);
		await useAppStore.persist.rehydrate();
		assert.deepEqual(useAppStore.getState().leafStatuses, []);
	});
});

test("hydration and workspace loading reset legacy filters and normalize saved selections", async () => {
	await withStorage(async (storage) => {
		for (const [value, expected] of [
			[undefined, []],
			[null, []],
			["complete", []],
			[{ complete: true }, []],
			[
				["complete", "invalid", "complete", "unmarked"],
				["complete", "unmarked"],
			],
		]) {
			const serialized = JSON.stringify({ version: 2, state: { leafStatuses: value } });
			useAppStore.getState().setLeafStatuses(["parked"]);
			storage.set(storageKey, serialized);
			await useAppStore.persist.rehydrate();
			assert.deepEqual(useAppStore.getState().leafStatuses, expected);

			useAppStore.getState().setLeafStatuses(["parked"]);
			loadWorkspaceState(serialized);
			assert.deepEqual(useAppStore.getState().leafStatuses, expected);
		}
		useAppStore.getState().setLeafStatuses(["todo"]);
		loadWorkspaceState(null);
		assert.deepEqual(useAppStore.getState().leafStatuses, [], "new workspaces show all statuses");
	});
});

test("desktop workspaces independently restore filters from disk after switching and reopening", async () => {
	const dataRoot = await mkdtemp(path.join(os.tmpdir(), "rhyza-filter-persistence-"));
	const workspaceA = path.join(dataRoot, "workspace-a");
	const workspaceB = path.join(dataRoot, "workspace-b");
	const pendingSaves: Promise<unknown>[] = [];
	let diskStore = new AppStateStore(dataRoot);
	let currentWorkspace = workspaceA;
	try {
		await withStorage(async () => {
			const bridge: Pick<RhyzaBridge, "appStateLoad" | "appStateSave"> = {
				appStateLoad: async () => diskStore.load(currentWorkspace),
				appStateSave: (request) => {
					assert.equal(request.workspacePath, currentWorkspace);
					const pending = diskStore
						.save(
							currentWorkspace,
							typeof request.value === "string" ? request.value : JSON.stringify(request.value),
						)
						.then<{ ok: true }>(() => ({ ok: true }));
					pendingSaves.push(pending);
					return pending;
				},
			};
			Object.defineProperty(window, "rhyza", { configurable: true, value: bridge });
			const flush = async () => {
				await Promise.all(pendingSaves.splice(0));
			};
			const switchWorkspace = async (workspacePath: string) => {
				await flush();
				currentWorkspace = workspacePath;
				setWorkspacePersistencePath(workspacePath);
				loadWorkspaceState(await bridge.appStateLoad());
				await flush();
			};

			setWorkspacePersistencePath(workspaceA);
			await useAppStore.persist.rehydrate();
			useAppStore.getState().setLeafStatuses(["complete", "unmarked"]);
			await flush();
			assert.deepEqual(JSON.parse(diskStore.load(workspaceA)!).state.leafStatuses, [
				"complete",
				"unmarked",
			]);

			await switchWorkspace(workspaceB);
			assert.deepEqual(useAppStore.getState().leafStatuses, []);
			useAppStore.getState().setLeafStatuses(["todo", "parked"]);
			await flush();
			await switchWorkspace(workspaceA);
			assert.deepEqual(useAppStore.getState().leafStatuses, ["complete", "unmarked"]);
			await switchWorkspace(workspaceB);
			assert.deepEqual(useAppStore.getState().leafStatuses, ["todo", "parked"]);
			useAppStore.getState().setLeafStatuses([]);
			await flush();

			setWorkspacePersistencePath(null);
			useAppStore.setState({ leafStatuses: [] });
			diskStore = new AppStateStore(dataRoot);
			currentWorkspace = workspaceA;
			setWorkspacePersistencePath(workspaceA);
			await useAppStore.persist.rehydrate();
			assert.deepEqual(useAppStore.getState().leafStatuses, ["complete", "unmarked"]);
			await switchWorkspace(workspaceB);
			assert.deepEqual(useAppStore.getState().leafStatuses, [], "clearing survives reopening");
		});
	} finally {
		await Promise.all(pendingSaves);
		await rm(dataRoot, { recursive: true, force: true, maxRetries: 5 });
	}
});

test("desktop persistence and parsed workspace loading do not serialize or parse JSON in the renderer", async () => {
	await withStorage(async () => {
		const saved: AppStateSaveRequest[] = [];
		const bridge: Pick<RhyzaBridge, "appStateLoad" | "appStateSave"> = {
			appStateLoad: async () => null,
			appStateSave: async (request) => {
				saved.push(request);
				return { ok: true };
			},
		};
		Object.defineProperty(window, "rhyza", { configurable: true, value: bridge });
		setWorkspacePersistencePath("workspace-a");
		await useAppStore.persist.rehydrate();
		const stringify = JSON.stringify;
		const parse = JSON.parse;
		try {
			JSON.stringify = () => {
				throw new Error("Renderer JSON serialization is forbidden.");
			};
			JSON.parse = () => {
				throw new Error("Renderer JSON parsing is forbidden.");
			};
			loadWorkspaceState({ version: 2, state: { leafStatuses: ["todo"] } });
			useAppStore.getState().setLeafStatuses(["complete"]);
		} finally {
			JSON.stringify = stringify;
			JSON.parse = parse;
		}
		assert.ok(saved.length >= 2);
		const latest = saved.at(-1)!;
		assert.equal(latest.workspacePath, "workspace-a");
		assert.notEqual(typeof latest.value, "string");
		assert.ok(typeof latest.value !== "string");
		assert.equal(latest.value.workspacePath, "workspace-a");
		assert.deepEqual(latest.value.state.leafStatuses, ["complete"]);
	});
});

test("delayed hydration and its pending save cannot cross a workspace switch", async () => {
	await withStorage(async () => {
		const loads: Array<(value: WorkspaceStateEnvelope | null) => void> = [];
		const saves: AppStateSaveRequest[] = [];
		const warnings: unknown[][] = [];
		const reportError = console.error;
		const bridge: Pick<RhyzaBridge, "appStateLoad" | "appStateSave"> = {
			appStateLoad: () => new Promise((resolve) => loads.push(resolve)),
			appStateSave: async (request) => {
				saves.push(request);
				return { ok: true };
			},
		};
		Object.defineProperty(window, "rhyza", { configurable: true, value: bridge });
		console.error = (...args) => warnings.push(args);
		try {
			setWorkspacePersistencePath(null);
			loadWorkspaceState(null);
			setWorkspacePersistencePath("workspace-a");
			const hydration = useAppStore.persist.rehydrate();
			useAppStore.getState().setLeafStatuses(["parked"]);
			assert.equal(loads.length, 2);
			setWorkspacePersistencePath("workspace-b");
			const oldState: WorkspaceStateEnvelope = {
				version: 2,
				state: { leafStatuses: ["complete"], turns: [{ id: "workspace-a-turn" }] },
			};
			loads[0](oldState);
			loads[1](oldState);
			await hydration;
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(saves.length, 0, "stale hydration must not save to either workspace");
			assert.equal(useAppStore.getState().turns.length, 0);
			assert.ok(
				warnings.some((args) =>
					args.some((arg) => arg instanceof Error && arg.message.includes("Workspace changed")),
				),
			);
			const freshHydration = useAppStore.persist.rehydrate();
			loads[2]({ version: 2, state: { leafStatuses: ["todo"] } });
			await freshHydration;
			assert.deepEqual(useAppStore.getState().leafStatuses, ["todo"]);
			assert.equal(useAppStore.persist.hasHydrated(), true);
		} finally {
			console.error = reportError;
		}
	});
});
