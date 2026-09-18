import assert from "node:assert/strict";
import test from "node:test";
import type { ThreadEvent } from "@openai/codex-sdk";
import type { AgentBridgeEvent } from "../src/shared/ipc";
import { buildNativePrompt, type NativeAgentRequest } from "../electron/main/native-agent";
import { codexThreadOptions, consumeCodexEvents } from "../electron/main/codex-agent";

async function* stream<T>(items: T[]) {
	yield* items;
}

test("native prompts replay only the visible branch, preserving history and current images", () => {
	const image = { mimeType: "image/png" as const, data: "aGVsbG8=" };
	const parts = buildNativePrompt(
		{
			frontendSessionId: "branch",
			transcript: [
				{ id: "user-1", role: "user", content: "Earlier question", images: [image] },
				{ id: "assistant-1", role: "assistant", content: "Earlier answer" },
			],
			prompt: "Current question",
			images: [image],
			knowledgeContext: "Attached evidence",
		},
		"Follow workspace instructions",
	);
	assert.equal(parts[0].type, "text");
	assert.equal(parts.filter((part) => part.type === "image").length, 2);
	const text = parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
	assert.match(text, /"role":"user","content":"Earlier question"/);
	assert.match(text, /"role":"assistant","content":"Earlier answer"/);
	assert.match(text, /Attached evidence/);
	assert.match(text, /Current user request:\nCurrent question/);
	assert.ok(text.indexOf("Earlier answer") < text.indexOf("Current question"));
});

test("Codex uses explicit sandbox and approvals without bypass flags", () => {
	const request: NativeAgentRequest = {
		providerId: "codex",
		workspacePath: "C:\\workspace",
		parts: [],
		tools: true,
		writable: false,
		signal: new AbortController().signal,
		thinkingLevel: "off",
	};
	assert.deepEqual(codexThreadOptions(request), {
		workingDirectory: "C:\\workspace",
		model: undefined,
		modelReasoningEffort: "minimal",
		sandboxMode: "read-only",
		approvalPolicy: "never",
		skipGitRepoCheck: true,
		networkAccessEnabled: false,
		webSearchMode: "disabled",
	});
	assert.equal(codexThreadOptions({ ...request, writable: true }).sandboxMode, "workspace-write");
	assert.equal(codexThreadOptions({ ...request, modelId: "custom" }).model, "custom");
});

test("Codex cumulative item updates emit deltas once and return the final answer with usage", async () => {
	const events: ThreadEvent[] = [
		{ type: "thread.started", thread_id: "native-id" },
		{ type: "item.started", item: { type: "agent_message", id: "a", text: "Hel" } },
		{ type: "item.updated", item: { type: "agent_message", id: "a", text: "Hello" } },
		{ type: "item.completed", item: { type: "agent_message", id: "a", text: "Hello" } },
		{ type: "item.completed", item: { type: "reasoning", id: "r", text: "A summary" } },
		{
			type: "turn.completed",
			usage: {
				input_tokens: 100,
				cached_input_tokens: 40,
				cache_write_input_tokens: 3,
				output_tokens: 12,
				reasoning_output_tokens: 2,
			},
		},
	];
	const emitted: AgentBridgeEvent[] = [];
	const result = await consumeCodexEvents(stream(events), (event) => emitted.push(event));
	assert.equal(result.sessionId, "native-id");
	assert.equal(result.assistantText, "Hello");
	assert.equal(result.reasoningText, "A summary");
	assert.deepEqual(result.usage, { input: 60, output: 12, cacheRead: 40, cacheWrite: 3, cost: 0 });
	assert.deepEqual(
		emitted.filter((event) => event.streamKind === "text").map((event) => event.message),
		["Hel", "lo"],
	);
});

test("Codex tools that arrive only completed still get matched start/end events", async () => {
	const events: ThreadEvent[] = [
		{
			type: "item.completed",
			item: {
				id: "cmd",
				type: "command_execution",
				command: "read file",
				aggregated_output: "denied",
				exit_code: 1,
				status: "failed",
			},
		},
		{ type: "item.completed", item: { type: "agent_message", id: "a", text: "Could not read" } },
		{
			type: "turn.completed",
			usage: {
				input_tokens: 0,
				cached_input_tokens: 0,
				cache_write_input_tokens: 0,
				output_tokens: 0,
				reasoning_output_tokens: 0,
			},
		},
	];
	const emitted: AgentBridgeEvent[] = [];
	await consumeCodexEvents(stream(events), (event) => emitted.push(event));
	assert.deepEqual(
		emitted.slice(0, 2).map((event) => event.type),
		["tool_execution_start", "tool_execution_end"],
	);
	assert.deepEqual(emitted[1].payload, {
		toolCallId: "cmd",
		toolName: "command_execution",
		result: "denied",
		isError: true,
	});
});

test("Codex rejects explicit failures, truncated streams and empty completed responses", async () => {
	await assert.rejects(
		consumeCodexEvents(
			stream<ThreadEvent>([{ type: "turn.failed", error: { message: "Login expired" } }]),
			() => {},
		),
		/Login expired/,
	);
	await assert.rejects(
		consumeCodexEvents(stream<ThreadEvent>([]), () => {}),
		/without a completed turn/,
	);
	await assert.rejects(
		consumeCodexEvents(
			stream<ThreadEvent>([
				{
					type: "turn.completed",
					usage: {
						input_tokens: 0,
						cached_input_tokens: 0,
						cache_write_input_tokens: 0,
						output_tokens: 0,
						reasoning_output_tokens: 0,
					},
				},
			]),
			() => {},
		),
		/no assistant text/,
	);
});
