import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode, Turn } from "../src/types/index.js";
import { cloneSessionNode, forkSessionNode } from "../src/utils/sessionFork.js";
import { projectConversationGraph } from "../src/utils/conversationGraph.js";
import { allocateBranchUsage } from "../src/utils/branchUsage.js";

const root: SessionNode = { id: "root", parentId: null, isRoot: true, title: "Original", status: "idle" };
const turn = (id: string, role: Turn["role"] = "user"): Turn => ({
	id, sessionId: root.id, role, content: id, status: "complete", createdAt: "2026-09-13T00:00:00Z",
	usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
});
const ids = () => { let next = 0; return (prefix: "session" | "turn") => `${prefix}-${++next}`; };

test("node fork uses the chosen round's end and preserves the original continuation", () => {
	const state = { sessions: [root], turns: [turn("u1"), turn("a1", "assistant"), turn("u2"), turn("a2", "assistant")] };
	const result = forkSessionNode(state, root.id, ids(), "a1")!;
	assert.deepEqual(result.turns.filter((t) => t.sessionId === result.forkSessionId).map((t) => t.content), ["u1", "a1"]);
	assert.deepEqual(result.turns.filter((t) => t.sessionId === result.originalSessionId).map((t) => t.content), ["u1", "a1", "u2", "a2"]);
	assert.deepEqual(allocateBranchUsage(result.sessions, result.turns).total, allocateBranchUsage(state.sessions, state.turns).total);
});

test("forking a history-only leaf attaches to that selected leaf", () => {
	const leaf: SessionNode = { ...root, id: "leaf", parentId: root.id, isRoot: false };
	const original = turn("u1");
	const copy = { ...original, id: "copy", sourceTurnId: original.id, sessionId: leaf.id };
	const result = forkSessionNode({ sessions: [root, leaf], turns: [original, copy] }, leaf.id, ids())!;
	assert.equal(result.sessions.find((s) => s.id === result.forkSessionId)?.parentId, leaf.id);
});

test("empty nodes can be forked and cloned, and the graph connects the new branch", () => {
	const state = { sessions: [root], turns: [] };
	const fork = forkSessionNode(state, root.id, ids())!;
	const graph = projectConversationGraph(fork.sessions, fork.turns);
	assert.equal(graph.rounds.find((r) => r.sessionId === fork.forkSessionId)?.parentId, `empty:${root.id}`);
	const clone = cloneSessionNode(state, root.id, ids())!;
	assert.equal(clone.sessions[1].isRoot, true);
	assert.equal(clone.turns.length, 0);
});

test("clone creates an independent prefix, remaps quotes, and does not duplicate model costs", () => {
	const source = { ...root, worktreePath: "source-worktree", titleUsage: turn("usage").usage };
	const first = { ...turn("u1"), images: [{ mimeType: "image/png" as const, data: "image" }] };
	const answer = { ...turn("a1", "assistant"), quote: { turnId: first.id, text: "quote" }, changeSetId: "changes" };
	const state = { sessions: [source], turns: [first, answer, turn("u2")] };
	const clone = cloneSessionNode(state, root.id, ids(), answer.id)!;
	const copy = clone.sessions[1];
	const copiedTurns = clone.turns.filter((t) => t.sessionId === copy.id);
	assert.equal(copy.parentId, null);
	assert.equal(copy.worktreePath, undefined);
	assert.equal(copy.titleUsage, undefined);
	assert.equal(copiedTurns.length, 2);
	assert.ok(copiedTurns.every((t) => !t.sourceTurnId && !t.changeSetId && !t.usage));
	assert.equal(copiedTurns[1].quote?.turnId, copiedTurns[0].id);
	assert.equal(copiedTurns[0].inheritedUsage?.cost, 0.01);
	assert.deepEqual(allocateBranchUsage(clone.sessions, clone.turns).total, allocateBranchUsage(state.sessions, state.turns).total);
	assert.equal(projectConversationGraph(clone.sessions, clone.turns).rounds.length, 3);
	copiedTurns[0].images![0].data = "changed";
	assert.equal(first.images[0].data, "image");
});

test("cloning inherited history gives it independent identities and local quote targets", () => {
	const inherited = { ...turn("copy"), sourceTurnId: "canonical" };
	const quoted = { ...turn("quoted"), quote: { turnId: "canonical", text: "quote" } };
	const clone = cloneSessionNode({ sessions: [root], turns: [inherited, quoted] }, root.id, ids())!;
	const copies = clone.turns.filter((t) => t.sessionId === clone.cloneSessionId);
	assert.equal(copies[0].sourceTurnId, undefined);
	assert.equal(copies[1].quote?.turnId, copies[0].id);
});

test("node actions reject stale targets and running sessions without mutating them", () => {
	const state = { sessions: [root], turns: [turn("u1")] };
	for (const action of [forkSessionNode, cloneSessionNode]) {
		assert.equal(action(state, "missing", ids()), null);
		assert.equal(action(state, root.id, ids(), "missing"), null);
		assert.equal(action({ ...state, turns: [{ ...state.turns[0], status: "running" }] }, root.id, ids()), null);
	}
	assert.equal(state.sessions.length, 1);
	assert.equal(state.turns.length, 1);
});
