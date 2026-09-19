import assert from "node:assert/strict";
import test from "node:test";
import type { Turn, SessionNode } from "../src/types/index.js";
import type { AgentModelRequestSnapshot } from "../src/shared/ipc.js";
import { executionAppearance, roundMetrics } from "../src/utils/roundMetrics.js";
import { projectConversationGraph } from "../src/utils/conversationGraph.js";

const usage = { input: 100, output: 20, cacheRead: 300, cacheWrite: 100, cost: 0.002 };
const request = (id: string): AgentModelRequestSnapshot => ({
	id,
	sequence: 1,
	timestamp: "2026-09-13T00:00:00Z",
	model: "model",
	provider: "provider",
	api: "api",
	thinking: "off",
	context: { messages: [] },
	usage,
});
const answer = (overrides: Partial<Turn> = {}): Turn => ({
	id: "a",
	sessionId: "root",
	role: "assistant",
	content: "Answer",
	status: "complete",
	createdAt: "2026-09-13T00:00:00Z",
	completedAt: "2026-09-13T00:00:02Z",
	usage,
	modelRequests: [request("1"), request("2")],
	...overrides,
});
const round = (answers: Turn[]) => ({
	id: "u",
	sessionId: "root",
	parentId: null,
	title: "Question",
	answers,
});

test("metadata preserves every actual model and thinking mode without using current settings", () => {
	const metrics = roundMetrics(
		round([
			answer({
				modelRequests: [
					request("1"),
					{ ...request("2"), model: "other-model", thinking: "high" },
					request("3"),
				],
			}),
		]),
	);
	assert.deepEqual(metrics.models, ["model", "other-model"]);
	assert.deepEqual(metrics.thinkingModes, ["off", "high"]);
	assert.deepEqual(roundMetrics(round([answer({ modelRequests: undefined })])).models, []);
});

test("execution appearance distinguishes completed, failed, active, interrupted and unsynced runs", () => {
	assert.equal(executionAppearance("complete"), "complete");
	assert.equal(executionAppearance("error"), "error");
	assert.equal(executionAppearance("warning"), "warning");
	assert.equal(executionAppearance("queued"), "running");
	assert.equal(executionAppearance("running"), "running");
	assert.equal(executionAppearance("interrupted"), "interrupted");
	assert.equal(executionAppearance("complete_with_unsynced_knowledge"), "interrupted");
	assert.equal(executionAppearance("idle"), "idle");
	const agentError = {
		id: "agent" as const,
		label: "Agent",
		status: "error" as const,
		startedAt: "2026-09-13T00:00:00Z",
	};
	const knowledgeError = {
		id: "knowledge" as const,
		label: "Knowledge",
		status: "error" as const,
		startedAt: "2026-09-13T00:00:00Z",
	};
	assert.equal(
		roundMetrics(round([answer({ status: "interrupted", activities: [agentError] })])).status,
		"interrupted",
	);
	assert.equal(roundMetrics(round([answer({ activities: [agentError] })])).status, "error");
	assert.equal(roundMetrics(round([answer({ activities: [knowledgeError] })])).status, "warning");
	assert.equal(
		roundMetrics(
			round([answer({ status: "complete_with_unsynced_knowledge", activities: [agentError] })]),
		).status,
		"error",
	);
});

test("round usage prefers the turn total, counts all model calls and includes cache writes in hit denominator", () => {
	const metrics = roundMetrics(round([answer(), answer({ id: "a2" })]));
	assert.equal(metrics.totalTokens, 1040);
	assert.equal(metrics.usage?.cost, 0.004);
	assert.equal(metrics.cacheHitRate, 60);
	assert.equal(metrics.calls, 4);
	assert.equal(metrics.durationMs, 4000);
});

test("live requests supply usage before a turn total and elapsed duration advances", () => {
	const value = round([answer({ usage: undefined, completedAt: undefined, status: "running" })]);
	const metrics = roundMetrics(value, Date.parse("2026-09-13T00:00:05Z"));
	assert.equal(metrics.totalTokens, 1040);
	assert.equal(metrics.durationMs, 5000);
	assert.equal(metrics.status, "running");
	assert.equal(roundMetrics(value, Date.parse("2026-09-13T00:00:06Z")).durationMs, 6000);
});

test("missing historical metrics stay unknown, recorded zero stays zero, and partial usage is identified", () => {
	const legacy = answer({
		usage: undefined,
		modelRequests: undefined,
		completedAt: undefined,
		status: "interrupted",
	});
	const metrics = roundMetrics(round([legacy]));
	assert.equal(metrics.totalTokens, undefined);
	assert.equal(metrics.calls, undefined);
	assert.equal(metrics.durationMs, undefined);
	assert.equal(metrics.status, "interrupted");
	assert.equal(roundMetrics(round([legacy, answer()])).partialUsage, true);
	assert.equal(
		roundMetrics(
			round([answer({ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } })]),
		).totalTokens,
		0,
	);
	assert.equal(roundMetrics(round([])).calls, 0);
});

test("fork-point metrics exclude copied usage and descendants", () => {
	const root: SessionNode = {
		id: "root",
		parentId: null,
		title: "Root",
		isRoot: true,
		status: "idle",
		progressStatus: "parked",
	};
	const child: SessionNode = {
		...root,
		id: "child",
		parentId: "root",
		isRoot: false,
		forkedFromTurnId: "a",
		progressStatus: "todo",
	};
	const user: Turn = {
		...answer(),
		id: "u",
		role: "user",
		usage: undefined,
		modelRequests: undefined,
	};
	const original = [user, answer()];
	const copies = original.map((turn) => ({
		...turn,
		id: `copy-${turn.id}`,
		sourceTurnId: turn.id,
		sessionId: "child",
	}));
	const graph = projectConversationGraph(
		[root, child],
		[
			...original,
			...copies,
			{ ...user, id: "child-u", sessionId: "child" },
			answer({ id: "child-a", sessionId: "child" }),
		],
	);
	assert.equal(roundMetrics(graph.rounds.find((item) => item.id === "u")!).totalTokens, 520);
	assert.equal(roundMetrics(graph.rounds.find((item) => item.id === "child-u")!).totalTokens, 520);
	assert.equal(graph.rounds.find((item) => item.id === "child-u")?.sessionId, "child");
});
