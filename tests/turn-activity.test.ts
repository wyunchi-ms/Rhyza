import assert from "node:assert/strict";
import test from "node:test";
import { failRunningTurnActivities, finishTurnActivity, startTurnActivity } from "../src/utils/turnActivity.js";

test("turn activities preserve an ordered, timed execution timeline", () => {
	const started = startTurnActivity(undefined, "retrieval", "Retrieving workspace context", "2026-08-25T00:00:00.000Z");
	const completed = finishTurnActivity(started, "retrieval", "complete", "8 source matches", "2026-08-25T00:00:02.500Z");
	const withAgent = startTurnActivity(completed, "agent", "Generating response", "2026-08-25T00:00:02.500Z");
	assert.equal(withAgent[0]?.durationMs, 2500);
	assert.equal(withAgent[0]?.detail, "8 source matches");
	assert.equal(withAgent[1]?.status, "running");
});

test("a failed turn closes every running activity", () => {
	const activities = startTurnActivity(undefined, "agent", "Generating response", "2026-08-25T00:00:00.000Z");
	const failed = failRunningTurnActivities(activities, "Provider failed", "2026-08-25T00:00:01.000Z");
	assert.equal(failed[0]?.status, "error");
	assert.equal(failed[0]?.durationMs, 1000);
	assert.equal(failed[0]?.detail, "Provider failed");
});
