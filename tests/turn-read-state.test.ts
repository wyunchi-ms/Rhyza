import assert from "node:assert/strict";
import test from "node:test";
import type { Turn } from "../src/types/index.js";
import {
	getWorkspacePersistencePath,
	loadWorkspaceState,
	setWorkspacePersistencePath,
	useAppStore,
} from "../src/store/index.js";
import { cloneSessionNode, forkSessionNode } from "../src/utils/sessionFork.js";
import { isTurnUnread, markTurnsRead, patchTurnReadState } from "../src/utils/turnReadState.js";

const answer = (id: string, status: Turn["status"] = "running"): Turn => ({
	id,
	sessionId: "chat",
	role: "assistant",
	content: "A generated response.",
	status,
	createdAt: "2026-10-15T00:00:00Z",
});

test("only newly completed assistant responses become unread", () => {
	for (const status of ["queued", "retrieving", "running", "finalizing"] as const) {
		for (const completion of ["complete", "complete_with_unsynced_knowledge"] as const) {
			const turn = patchTurnReadState(answer("a", status), { status: completion });
			assert.equal(isTurnUnread(turn), true, `${status} -> ${completion}`);
		}
	}
	assert.equal(isTurnUnread(answer("legacy", "complete")), false);
	assert.equal(
		isTurnUnread(patchTurnReadState({ ...answer("user"), role: "user" }, { status: "complete" })),
		false,
	);
	const read = { ...answer("read", "complete"), unread: false };
	assert.equal(
		isTurnUnread(patchTurnReadState(read, { status: "complete", summary: "Updated" })),
		false,
	);
	const unread = { ...read, unread: true };
	assert.equal(isTurnUnread(patchTurnReadState(unread, { summary: "Updated" })), true);
});

test("failures and interruptions keep their existing status instead of unread notifications", () => {
	for (const patch of [
		{ status: "interrupted" as const },
		{ status: "complete_with_unsynced_knowledge" as const, summary: "Request failed" },
		{
			status: "complete" as const,
			activities: [
				{
					id: "agent" as const,
					label: "Agent",
					status: "error" as const,
					startedAt: "2026-10-15T00:00:00Z",
				},
			],
		},
	]) {
		assert.equal(isTurnUnread(patchTurnReadState(answer("a"), patch)), false);
		assert.equal(
			patchTurnReadState({ ...answer("a", "complete"), unread: true }, patch).unread,
			false,
		);
	}
	const warning = patchTurnReadState(answer("warning"), {
		status: "complete",
		activities: [
			{
				id: "knowledge",
				label: "Knowledge",
				status: "warning",
				startedAt: "2026-10-15T00:00:00Z",
			},
		],
	});
	assert.equal(isTurnUnread(warning), true);
	assert.equal(
		patchTurnReadState(warning, { status: "queued" }).unread,
		false,
		"retry resets unread",
	);
});

test("reading shared history clears its canonical response and copies but not other answers", () => {
	const turns: Turn[] = [
		{ ...answer("original", "complete"), unread: true },
		{ ...answer("copy", "complete"), sourceTurnId: "original", unread: true },
		{ ...answer("nested-copy", "complete"), sourceTurnId: "copy", unread: true },
		{ ...answer("unrelated", "complete"), unread: true },
	];
	const read = markTurnsRead(turns, "nested-copy");
	assert.deepEqual(
		read.map((turn) => turn.unread),
		[false, false, false, true],
	);
	assert.strictEqual(read[3], turns[3]);
	assert.strictEqual(markTurnsRead(read, "original"), read, "already-read updates are no-ops");
});

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
	setWorkspacePersistencePath(null);
	try {
		loadWorkspaceState(null);
		await run(storage);
	} finally {
		useAppStore.setState(originalState, true);
		setWorkspacePersistencePath(originalPath);
		if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
		else Reflect.deleteProperty(globalThis, "window");
	}
}

test("both finalization modes and path summaries produce unread responses", async () => {
	await withStorage(() => {
		for (const autoExtract of [false, true]) {
			useAppStore.getState().updateSettings({ autoExtract, knowledgeMode: "suggest" });
			useAppStore.setState({ turns: [answer("generated", "finalizing")] });
			useAppStore.getState().finalizeTurn("chat", "generated", "A generated response.");
			assert.equal(isTurnUnread(useAppStore.getState().turns[0]), true);
			useAppStore.getState().markTurnRead("generated");
			assert.equal(isTurnUnread(useAppStore.getState().turns[0]), false);
		}
		const snapshot = {
			sources: [
				{
					roundId: "question",
					sessionId: "chat",
					title: "Question",
					roundIds: ["question"],
					contentHash: "hash",
				},
			],
			createdAt: "2026-10-15T00:00:00Z",
			model: { providerId: "github-copilot" as const, modelId: "test" },
		};
		const pending = useAppStore.getState().createSummarySession("", snapshot);
		useAppStore.getState().completeSummarySession(pending, "Completed path summary");
		const complete = useAppStore.getState().createSummarySession("Immediate summary", snapshot);
		for (const id of [pending, complete]) {
			assert.equal(
				useAppStore.getState().turns.some((turn) => turn.sessionId === id && isTurnUnread(turn)),
				true,
			);
		}
	});
});

test("unread and read states survive hydration and workspace switching without marking old history unread", async () => {
	await withStorage(async (storage) => {
		useAppStore.getState().addManualTurn(answer("generated"));
		useAppStore.getState().updateTurn("generated", { status: "complete" });
		const saved = storage.get("rhyza-workspace-v2")!;
		assert.equal(JSON.parse(saved).state.turns[0].unread, true);
		loadWorkspaceState(null);
		assert.deepEqual(useAppStore.getState().turns, []);
		loadWorkspaceState(saved);
		assert.equal(isTurnUnread(useAppStore.getState().turns[0]), true);
		storage.set("rhyza-workspace-v2", saved);
		await useAppStore.persist.rehydrate();
		assert.equal(isTurnUnread(useAppStore.getState().turns[0]), true);
		useAppStore.getState().markTurnRead("generated");
		const read = storage.get("rhyza-workspace-v2")!;
		loadWorkspaceState(null);
		loadWorkspaceState(read);
		assert.equal(isTurnUnread(useAppStore.getState().turns[0]), false);
		loadWorkspaceState({ state: { turns: [answer("old", "complete")] } });
		assert.equal(isTurnUnread(useAppStore.getState().turns[0]), false);
	});
});

test("forks share read state while independent clones do not invent new output notifications", () => {
	let id = 0;
	const createId = (prefix: "session" | "turn") => `${prefix}-${++id}`;
	const state = {
		sessions: [
			{ id: "chat", parentId: null, isRoot: true, title: "Chat", status: "idle" as const },
		],
		turns: [{ ...answer("generated", "complete"), unread: true }],
	};
	const fork = forkSessionNode(state, "chat", createId)!;
	const copy = fork.turns.find((turn) => turn.sourceTurnId === "generated")!;
	assert.equal(isTurnUnread(copy), true);
	assert.equal(markTurnsRead(fork.turns, copy.id).some(isTurnUnread), false);
	const clone = cloneSessionNode(state, "chat", createId)!;
	assert.equal(
		clone.turns.filter((turn) => turn.sessionId === clone.cloneSessionId).some(isTurnUnread),
		false,
	);
	assert.equal(isTurnUnread(clone.turns[0]), true);
});
