import assert from "node:assert/strict";
import test from "node:test";
import {
	validateAgentPromptRequest,
	validateModelRequestHistoryRequest,
	validateWorkspaceTodosRequest,
} from "../src/shared/ipc";

test("model request history requires a frontend session id", () => {
	assert.deepEqual(validateModelRequestHistoryRequest({ frontendSessionId: "session-1" }), {
		frontendSessionId: "session-1",
	});
	assert.throws(() => validateModelRequestHistoryRequest({ frontendSessionId: "" }));
});

test("workspace TODO request accepts an optional session and rejects non-objects", () => {
	assert.deepEqual(validateWorkspaceTodosRequest(undefined), {});
	assert.deepEqual(validateWorkspaceTodosRequest({ frontendSessionId: "session-1" }), { frontendSessionId: "session-1" });
	assert.deepEqual(validateWorkspaceTodosRequest({ frontendSessionId: "" }), {});
	assert.throws(() => validateWorkspaceTodosRequest("session-1"), /Invalid workspace TODO request/);
});

test("agent prompt preserves the frontend turn id used to normalize telemetry", () => {
	const request = validateAgentPromptRequest({
		frontendSessionId: "session-1",
		frontendTurnId: "turn-2",
		prompt: "Inspect this context",
		transcript: [],
	});
	assert.equal(request.frontendTurnId, "turn-2");
});
