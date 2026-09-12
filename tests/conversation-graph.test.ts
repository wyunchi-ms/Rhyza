import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode, Turn } from "../src/types/index.js";
import { projectConversationGraph } from "../src/utils/conversationGraph.js";
import { forkSessionAtTurn } from "../src/utils/sessionFork.js";

const root: SessionNode = { id: "root", parentId: null, title: "Chat", isRoot: true, status: "idle" };
const message = (id: string, role: Turn["role"], sessionId = "root"): Turn => ({ id, role, sessionId, content: id, status: "complete", createdAt: "2026-09-12T00:00:00Z" });
const history = () => [1, 2, 3, 4].flatMap((n) => [message(`u${n}`, "user"), message(`a${n}`, "assistant")]);

test("legacy copies and nested modern forks share one root regardless of session order", () => {
	const child: SessionNode = { ...root, id: "child", parentId: "root", isRoot: false, forkedFromTurnId: "a2" };
	const nested: SessionNode = { ...child, id: "nested", parentId: "child", forkedFromTurnId: "copy-a1" };
	const other: SessionNode = { ...root, id: "other" };
	const third: SessionNode = { ...root, id: "third" };
	const copies = history().slice(0, 4).map((turn) => ({ ...turn, id: `copy-${turn.id}`, sessionId: "child" }));
	const nestedCopies = copies.slice(0, 2).map((turn) => ({ ...turn, id: `nested-${turn.id}`, sourceTurnId: turn.id, sessionId: "nested" }));
	const turns = [...history(), ...copies, message("cu", "user", "child"), message("ca", "assistant", "child"), ...nestedCopies, message("nu", "user", "nested"), message("na", "assistant", "nested"), message("other-u", "user", "other"), message("third-u", "user", "third")];
	const original = JSON.stringify(turns);
	const graph = projectConversationGraph([nested, child, other, third, root], turns);
	assert.equal(graph.rounds.filter((round) => !round.parentId).length, 3);
	assert.deepEqual(graph.paths.get("child"), ["u1", "u2", "cu"]);
	assert.deepEqual(graph.paths.get("nested"), ["u1", "nu"]);
	assert.equal(graph.rounds.find((round) => round.id === "nu")?.parentId, "u1");
	assert.equal(graph.rounds.find((round) => round.id === "u1")?.answers.length, 1);
	assert.equal(graph.targets.get("nested")?.get("u1"), "nested-copy-u1");
	assert.equal(JSON.stringify(turns), original);
});

test("equal prompts outside the copied prefix remain distinct", () => {
	const child: SessionNode = { ...root, id: "child", parentId: "root", isRoot: false, forkedFromTurnId: "a1" };
	const copies = history().slice(0, 2).map((turn) => ({ ...turn, id: `copy-${turn.id}`, sessionId: "child" }));
	const repeat = { ...message("repeat", "user", "child"), content: "u1" };
	const graph = projectConversationGraph([root, child], [...history(), ...copies, repeat]);
	assert.ok(graph.rounds.some((round) => round.id === "repeat"));
	assert.equal(graph.rounds.find((round) => round.id === "repeat")?.parentId, "u1");
});

test("four questions and four answers produce four connected rounds", () => {
	const graph = projectConversationGraph([root], history());
	assert.equal(graph.rounds.length, 4);
	assert.deepEqual(graph.paths.get("root"), ["u1", "u2", "u3", "u4"]);
	assert.deepEqual(graph.rounds.map((round) => round.parentId), [null, "u1", "u2", "u3"]);
	assert.deepEqual(graph.rounds.map((round) => round.answers.map((answer) => answer.id)), [["a1"], ["a2"], ["a3"], ["a4"]]);
});

test("a fork shares historical nodes and attaches the new question to the fork round", () => {
	let sequence = 0;
	const fork = forkSessionAtTurn({ sessions: [root], turns: history() }, "a2", (prefix) => `${prefix}-${++sequence}`)!;
	const graph = projectConversationGraph(fork.sessions, [...fork.turns, message("branch-user", "user", fork.forkSessionId), message("branch-answer", "assistant", fork.forkSessionId)]);
	assert.equal(graph.rounds.length, 5);
	assert.deepEqual(graph.paths.get(fork.forkSessionId), ["u1", "u2", "branch-user"]);
	assert.deepEqual(graph.paths.get(fork.originalSessionId), ["u1", "u2", "u3", "u4"]);
	assert.equal(graph.rounds.find((round) => round.id === "branch-user")?.parentId, "u2");
	assert.equal(graph.rounds.find((round) => round.id === "u2")?.answers.length, 1);
	const copiedId = graph.targets.get(fork.forkSessionId)?.get("u1");
	assert.ok(copiedId && copiedId !== "u1");
	assert.equal(fork.turns.find((turn) => turn.id === copiedId)?.sourceTurnId, "u1");
});

test("forking at a question keeps its later answer in the same round", () => {
	let sequence = 0;
	const fork = forkSessionAtTurn({ sessions: [root], turns: history() }, "u2", (prefix) => `${prefix}-${++sequence}`)!;
	const graph = projectConversationGraph(fork.sessions, fork.turns);
	assert.equal(graph.rounds.filter((round) => round.user).length, 4);
	assert.deepEqual(graph.rounds.find((round) => round.id === "u2")?.answers.map((turn) => turn.id), ["a2"]);
	assert.equal(graph.rounds.find((round) => round.id === `empty:${fork.forkSessionId}`)?.parentId, "u2");
});
