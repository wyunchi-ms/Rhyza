import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode, TokenUsage, Turn } from "../src/types/index.js";
import { buildPriorAgentTranscript } from "../src/utils/agentTranscript.js";
import { allocateBranchUsage } from "../src/utils/branchUsage.js";
import { createForkDebugSnapshot, createSelectionAppendDebugSnapshot } from "../src/utils/forkDebug.js";
import { forkSessionAtTurn, selectionContinuationTarget } from "../src/utils/sessionFork.js";

test("forking a path splits it into a branch point with original and new continuations", () => {
	const createId = sequentialIds();
	const root: SessionNode = { id: "root", parentId: null, title: "Full path", isRoot: true, status: "idle" };
	const turns = [1, 2, 3, 4, 5].map((number) => makeTurn(`turn-${number}`, root.id, number % 2 ? "user" : "assistant", usage(number)));
	const beforeUsage = allocateBranchUsage([root], turns).total;

	const fork = forkSessionAtTurn({ sessions: [root], turns }, "turn-3", createId);
	assert.ok(fork);
	assert.equal(fork.branchPointSessionId, root.id);
	assert.notEqual(fork.originalSessionId, root.id);
	assert.deepEqual(childIds(fork.sessions, root.id).sort(), [fork.originalSessionId, fork.forkSessionId].sort());
	assert.deepEqual(contents(fork.turns, root.id), ["turn-1", "turn-2", "turn-3"]);
	assert.deepEqual(contents(fork.turns, fork.originalSessionId), ["turn-1", "turn-2", "turn-3", "turn-4", "turn-5"]);
	assert.deepEqual(contents(fork.turns, fork.forkSessionId), ["turn-1", "turn-2", "turn-3"]);
	assert.deepEqual(allocateBranchUsage(fork.sessions, fork.turns).total, beforeUsage);
	assert.ok(fork.turns.filter((turn) => turn.sessionId === fork.originalSessionId).slice(0, 3).every((turn) => turn.sourceTurnId));
	assert.ok(fork.turns.filter((turn) => turn.sessionId === fork.originalSessionId).slice(3).every((turn) => !turn.sourceTurnId));
});

test("selection questions append to a leaf even when the selected turn is inherited", () => {
	const root: SessionNode = { id: "root", parentId: null, title: "Root", isRoot: true, status: "idle" };
	const leaf: SessionNode = { id: "leaf", parentId: root.id, forkedFromTurnId: "root-turn", title: "Leaf", isRoot: false, status: "idle" };
	const rootTurn = makeTurn("root-turn", root.id, "assistant");
	const inheritedTurn = { ...makeTurn("inherited-turn", leaf.id, "assistant"), sourceTurnId: rootTurn.id };
	assert.deepEqual(
		selectionContinuationTarget({ sessions: [root, leaf], turns: [rootTurn, inheritedTurn] }, inheritedTurn.id),
		{ sessionId: leaf.id, mode: "append" },
	);
	const dump = createSelectionAppendDebugSnapshot(
		{ sessions: [root, leaf], turns: [rootTurn, inheritedTurn] },
		inheritedTurn.id,
		{ sessionId: leaf.id, mode: "append" },
	);
	assert.equal(dump.decision.mode, "append");
	assert.equal(dump.decision.selectedTurn?.id, inheritedTurn.id);
	assert.equal(dump.decision.sourceTurn?.id, rootTurn.id);
	assert.equal(dump.state.sessions.length, 2);
});

test("selection questions fork when the displayed session already has children", () => {
	const branchPoint: SessionNode = { id: "branch-point", parentId: null, title: "Branch point", isRoot: true, status: "idle" };
	const child: SessionNode = { id: "child", parentId: branchPoint.id, forkedFromTurnId: "turn", title: "Child", isRoot: false, status: "idle" };
	const turn = makeTurn("turn", branchPoint.id, "assistant");
	assert.deepEqual(
		selectionContinuationTarget({ sessions: [branchPoint, child], turns: [turn] }, turn.id),
		{ sessionId: branchPoint.id, mode: "fork" },
	);
});

test("selection questions fork from a middle turn even before the session has child branches", () => {
	const root: SessionNode = { id: "root", parentId: null, title: "Root", isRoot: true, status: "idle" };
	const turns = [1, 2, 3, 4, 5].map((number) => makeTurn(`turn-${number}`, root.id, number % 2 ? "user" : "assistant"));
	assert.deepEqual(
		selectionContinuationTarget({ sessions: [root], turns }, "turn-3"),
		{ sessionId: root.id, mode: "fork" },
	);
	assert.deepEqual(
		selectionContinuationTarget({ sessions: [root], turns }, "turn-5"),
		{ sessionId: root.id, mode: "append" },
	);
});

test("forking copied history adds a sibling at its existing branch point", () => {
	const createId = sequentialIds();
	const root: SessionNode = { id: "root", parentId: null, title: "Full path", isRoot: true, status: "idle" };
	const turns = [1, 2, 3, 4, 5].map((number) => makeTurn(`turn-${number}`, root.id, number % 2 ? "user" : "assistant"));
	const firstFork = forkSessionAtTurn({ sessions: [root], turns }, "turn-3", createId);
	assert.ok(firstFork);
	const copiedForkTurn = firstFork.turns.find((turn) => turn.sessionId === firstFork.originalSessionId && turn.sourceTurnId === "turn-3");
	assert.ok(copiedForkTurn);

	const siblingFork = forkSessionAtTurn(firstFork, copiedForkTurn.id, createId);
	assert.ok(siblingFork);
	assert.equal(siblingFork.branchPointSessionId, root.id);
	assert.equal(siblingFork.sessions.find((session) => session.id === siblingFork.forkSessionId)?.parentId, root.id);
	assert.equal(childIds(siblingFork.sessions, root.id).length, 3);
	assert.deepEqual(contents(siblingFork.turns, siblingFork.forkSessionId), ["turn-1", "turn-2", "turn-3"]);
});

test("forking copied history splits its source path instead of silently failing", () => {
	const createId = sequentialIds();
	const root: SessionNode = { id: "root", parentId: null, title: "Full path", isRoot: true, status: "idle" };
	const child: SessionNode = { id: "child", parentId: root.id, forkedFromTurnId: "turn-3", title: "Existing branch", isRoot: false, status: "idle" };
	const rootTurns = [1, 2, 3, 4, 5].map((number) => makeTurn(`turn-${number}`, root.id, number % 2 ? "user" : "assistant"));
	const copiedTurn = { ...makeTurn("copied-turn-3", child.id, "user"), sourceTurnId: "turn-3" };

	const fork = forkSessionAtTurn({ sessions: [root, child], turns: [...rootTurns, copiedTurn] }, copiedTurn.id, createId);
	assert.ok(fork);
	assert.deepEqual(contents(fork.turns, root.id), ["turn-1", "turn-2", "turn-3"]);
	assert.equal(fork.sessions.find((session) => session.id === child.id)?.parentId, fork.originalSessionId);
	assert.deepEqual(childIds(fork.sessions, root.id).sort(), [fork.originalSessionId, fork.forkSessionId].sort());
	const dump = createForkDebugSnapshot({ sessions: [root, child], turns: [...rootTurns, copiedTurn] }, copiedTurn.id, fork);
	assert.equal(dump.forkEvent.selectedTurn?.id, copiedTurn.id);
	assert.equal(dump.forkEvent.sourceTurn?.id, "turn-3");
	assert.equal(dump.forkEvent.branchPointSessionId, root.id);
	assert.equal(dump.before.sessions.length, 2);
	assert.equal(dump.after.sessions.length, 4);
	assert.equal(dump.beforeTree[0]?.children.length, 1);
	assert.equal(dump.afterTree[0]?.children.length, 2);
});

test("forking a local continuation creates a nested branch point", () => {
	const createId = sequentialIds();
	const root: SessionNode = { id: "root", parentId: null, title: "Full path", isRoot: true, status: "idle" };
	const turns = [1, 2, 3, 4, 5].map((number) => makeTurn(`turn-${number}`, root.id, number % 2 ? "user" : "assistant"));
	const firstFork = forkSessionAtTurn({ sessions: [root], turns }, "turn-3", createId);
	assert.ok(firstFork);
	const localTurn = firstFork.turns.find((turn) => turn.sessionId === firstFork.originalSessionId && turn.id === "turn-4");
	assert.ok(localTurn);

	const nestedFork = forkSessionAtTurn(firstFork, localTurn.id, createId);
	assert.ok(nestedFork);
	assert.equal(nestedFork.branchPointSessionId, firstFork.originalSessionId);
	assert.deepEqual(childIds(nestedFork.sessions, firstFork.originalSessionId).sort(), [nestedFork.originalSessionId, nestedFork.forkSessionId].sort());
	assert.deepEqual(contents(nestedFork.turns, firstFork.originalSessionId), ["turn-1", "turn-2", "turn-3", "turn-4"]);
	assert.deepEqual(contents(nestedFork.turns, nestedFork.originalSessionId), ["turn-1", "turn-2", "turn-3", "turn-4", "turn-5"]);
});

test("the current prompt is excluded from replay and is sent only once", () => {
	const turns = [
		makeTurn("prior-user", "branch", "user"),
		makeTurn("prior-assistant", "branch", "assistant"),
		makeTurn("current-user", "branch", "user"),
		makeTurn("pending-assistant", "branch", "assistant"),
		makeTurn("other-session", "other", "user"),
	];
	const transcript = buildPriorAgentTranscript(turns, "branch", ["current-user", "pending-assistant"]);
	assert.deepEqual(transcript.map((turn) => turn.id), ["prior-user", "prior-assistant"]);
});

function sequentialIds(): (prefix: "session" | "turn") => string {
	let sessionSequence = 0;
	let turnSequence = 0;
	return (prefix) => prefix === "session" ? `session-${++sessionSequence}` : `copy-${++turnSequence}`;
}

function makeTurn(id: string, sessionId: string, role: Turn["role"], turnUsage?: TokenUsage): Turn {
	return { id, sessionId, role, content: id, status: "complete", usage: turnUsage, createdAt: "2026-08-25T00:00:00.000Z" };
}

function usage(value: number): TokenUsage {
	return { input: value, output: value, cacheRead: value, cacheWrite: value, cost: value / 1000 };
}

function childIds(sessions: SessionNode[], parentId: string): string[] {
	return sessions.filter((session) => session.parentId === parentId).map((session) => session.id);
}

function contents(turns: Turn[], sessionId: string): string[] {
	return turns.filter((turn) => turn.sessionId === sessionId).map((turn) => turn.content);
}
