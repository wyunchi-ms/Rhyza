import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode, Turn } from "../src/types/index.js";
import { isSessionRunning, isTurnActive, runningSessionIds, syncSessionExecutionStatus } from "../src/utils/sessionRuntime.js";

const session = (id: string, status: SessionNode["status"]): SessionNode => ({ id, parentId: null, title: id, isRoot: true, status });
const turn = (id: string, sessionId: string, status: Turn["status"]): Turn => ({ id, sessionId, role: "assistant", content: "", status, createdAt: "2026-08-25T00:00:00.000Z" });

test("tree running state is derived from unfinished turns rather than stale session flags", () => {
	assert.deepEqual([...runningSessionIds([turn("done", "stale", "complete"), turn("live", "active", "running")])], ["active"]);
});

test("session completion is synchronized atomically while queued turns keep it running", () => {
	assert.equal(syncSessionExecutionStatus([session("s", "running")], [turn("done", "s", "complete")], "s")[0]?.status, "idle");
	assert.equal(syncSessionExecutionStatus([session("s", "running")], [turn("done", "s", "complete"), turn("queued", "s", "retrieving")], "s")[0]?.status, "running");
});

test("all consumers share the same active turn definition", () => {
	assert.equal(isTurnActive("queued"), true);
	assert.equal(isTurnActive("retrieving"), true);
	assert.equal(isTurnActive("running"), true);
	assert.equal(isTurnActive("finalizing"), true);
	assert.equal(isTurnActive("complete"), false);
	assert.equal(isSessionRunning([turn("queued", "session-a", "retrieving")], "session-a"), true);
	assert.equal(isSessionRunning([turn("done", "session-a", "complete")], "session-a"), false);
});
