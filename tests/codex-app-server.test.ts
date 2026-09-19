import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@earendil-works/pi-ai";
import { contextToInput } from "../electron/main/codex-app-server.js";

const context = {
	systemPrompt: "System",
	messages: [
		{ role: "user", content: "first" },
		{
			role: "assistant",
			content: [{ type: "text", text: "answer" }],
			api: "codex-app-server",
			provider: "codex",
			model: "model",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 0,
		},
		{ role: "user", content: "second" },
	],
} as Context;

test("fresh Codex threads receive history while reused threads receive only the new user turn", () => {
	const fresh = contextToInput(context, true)[0]?.text;
	const reused = contextToInput(context, false)[0]?.text;
	assert.match(String(fresh), /conversation_history/);
	assert.match(String(fresh), /first/);
	assert.match(String(fresh), /second/);
	assert.equal(reused, "second");
});
