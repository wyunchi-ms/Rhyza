import assert from "node:assert/strict";
import test from "node:test";
import type { Turn } from "../src/types/index.js";
import {
	failRunningTurnActivities,
	finishTurnActivity,
	providerStatusActivityPatch,
	startTurnActivity,
} from "../src/utils/turnActivity.js";

test("turn activities preserve an ordered, timed execution timeline", () => {
	const started = startTurnActivity(
		undefined,
		"retrieval",
		"Retrieving workspace context",
		"2026-08-25T00:00:00.000Z",
	);
	const completed = finishTurnActivity(
		started,
		"retrieval",
		"complete",
		"8 source matches",
		"2026-08-25T00:00:02.500Z",
	);
	const withAgent = startTurnActivity(
		completed,
		"agent",
		"Generating response",
		"2026-08-25T00:00:02.500Z",
	);
	assert.equal(withAgent[0]?.durationMs, 2500);
	assert.equal(withAgent[0]?.detail, "8 source matches");
	assert.equal(withAgent[1]?.status, "running");
});

test("a failed turn closes every running activity", () => {
	const activities = startTurnActivity(
		undefined,
		"agent",
		"Generating response",
		"2026-08-25T00:00:00.000Z",
	);
	const failed = failRunningTurnActivities(
		activities,
		"Provider failed",
		"2026-08-25T00:00:01.000Z",
	);
	assert.equal(failed[0]?.status, "error");
	assert.equal(failed[0]?.durationMs, 1000);
	assert.equal(failed[0]?.detail, "Provider failed");
});

function runningTurn(): Turn {
	const startedAt = "2026-09-17T00:00:00.000Z";
	return {
		id: "assistant",
		sessionId: "session",
		role: "assistant",
		status: "running",
		summary: "Claude Code is running",
		content: "Existing response",
		reasoning: "Actual model reasoning",
		tools: [{ id: "read", name: "read", status: "complete", startedAt }],
		createdAt: startedAt,
		activities: startTurnActivity(
			finishTurnActivity(
				startTurnActivity(undefined, "retrieval", "Retrieving workspace context", startedAt),
				"retrieval",
				"complete",
				"2 source matches",
				startedAt,
			),
			"agent",
			"Generating response",
			startedAt,
		),
	};
}

const retryStatus = {
	type: "provider_status",
	message: "Claude Code is retrying its API request after a connection failure.",
};

test("provider retry status updates only the running agent activity and turn summary", () => {
	const turn = runningTurn();
	const patch = providerStatusActivityPatch(turn, retryStatus);
	assert.ok(patch);
	assert.deepEqual(Object.keys(patch).sort(), ["activities", "summary"]);
	assert.equal(patch.summary, retryStatus.message);
	assert.equal(patch.activities?.[1].detail, retryStatus.message);
	assert.equal(patch.activities?.[1].status, "running");
	assert.equal(patch.activities?.[1].startedAt, turn.activities?.[1].startedAt);
	assert.strictEqual(patch.activities?.[0], turn.activities?.[0]);
	assert.equal(turn.activities?.[1].detail, undefined);
	const updated = { ...turn, ...patch };
	assert.equal(updated.content, turn.content);
	assert.equal(updated.reasoning, turn.reasoning);
	assert.strictEqual(updated.tools, turn.tools);
	assert.equal(providerStatusActivityPatch(updated, retryStatus), undefined);
	const next = providerStatusActivityPatch(updated, { ...retryStatus, message: "Retrying again…" });
	assert.equal(next?.summary, "Retrying again…");
	assert.equal(next?.activities?.length, turn.activities?.length);
	assert.equal(next?.activities?.[1].startedAt, turn.activities?.[1].startedAt);
});

test("real streaming, tools, and completion clear transient provider retry details", () => {
	const turn = runningTurn();
	const retrying = { ...turn, ...providerStatusActivityPatch(turn, retryStatus) };
	for (const event of [
		{ type: "message_update", message: "Response resumed" },
		{ type: "message_update", message: "Reasoning resumed", streamKind: "reasoning" },
		{ type: "tool_execution_start" },
		{ type: "tool_execution_end" },
		{ type: "message_end" },
		{ type: "agent_end" },
	]) {
		const patch = providerStatusActivityPatch(retrying, event);
		assert.ok(patch, event.type);
		assert.equal(patch.summary, "Generating response");
		assert.equal(patch.activities?.[1].detail, undefined);
		assert.equal(patch.activities?.[1].startedAt, turn.activities?.[1].startedAt);
		assert.equal(providerStatusActivityPatch({ ...retrying, ...patch }, event), undefined);
	}
	assert.equal(
		providerStatusActivityPatch({ ...retrying, summary: "Newer status" }, { type: "message_end" })
			?.summary,
		"Newer status",
	);
	for (const event of [
		{ type: "model_request" },
		{ type: "wire_request" },
		{ type: "message_update", message: "" },
	]) {
		assert.equal(providerStatusActivityPatch(retrying, event), undefined);
	}
	assert.equal(
		providerStatusActivityPatch(turn, { type: "message_update", message: "Normal stream" }),
		undefined,
	);
});

test("provider retry events ignore blank messages and turns outside the running agent phase", () => {
	const turn = runningTurn();
	assert.equal(
		providerStatusActivityPatch(turn, { type: "provider_status", message: " " }),
		undefined,
	);
	assert.equal(providerStatusActivityPatch({ ...turn, role: "user" }, retryStatus), undefined);
	for (const status of ["queued", "retrieving", "finalizing", "complete", "interrupted"] as const) {
		assert.equal(providerStatusActivityPatch({ ...turn, status }, retryStatus), undefined);
	}
	assert.equal(
		providerStatusActivityPatch(
			{ ...turn, activities: finishTurnActivity(turn.activities, "agent", "complete") },
			retryStatus,
		),
		undefined,
	);
});

test("running turns without an activity timeline can show and clear provider status", () => {
	const turn = { ...runningTurn(), activities: undefined };
	const patch = providerStatusActivityPatch(turn, retryStatus);
	assert.equal(patch?.activities?.[0].id, "agent");
	assert.equal(patch?.activities?.[0].detail, retryStatus.message);
	assert.equal(patch?.activities?.[0].startedAt, turn.createdAt);
	const resumed = providerStatusActivityPatch(
		{ ...turn, ...patch },
		{ type: "message_update", message: "Answer" },
	);
	assert.equal(resumed?.summary, "Generating response");
	assert.equal(resumed?.activities?.[0].detail, undefined);
});
