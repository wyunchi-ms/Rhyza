import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentBridgeEvent } from "../src/shared/ipc";
import {
	claudeArguments,
	claudeInput,
	consumeClaudeEvents,
	runClaudeAgent,
} from "../electron/main/claude-agent";
import type { NativeAgentRequest } from "../electron/main/native-agent";

async function* stream(events: unknown[]) {
	yield* events;
}

const request: NativeAgentRequest = {
	providerId: "claude-code",
	workspacePath: "C:\\workspace",
	parts: [
		{ type: "text", text: 'text with "quotes"\nand a newline' },
		{ type: "image", image: { mimeType: "image/png", data: "aGVsbG8=" } },
	],
	tools: true,
	writable: false,
	signal: new AbortController().signal,
};

test("Claude receives structured stdin, including images, rather than shell-interpolated prompts", () => {
	const input = claudeInput(request);
	assert.equal(input.split("\n").length, 2);
	const parsed = JSON.parse(input);
	assert.equal(parsed.type, "user");
	assert.equal(parsed.session_id, "");
	assert.equal(parsed.parent_tool_use_id, null);
	assert.equal(parsed.message.content[0].text, 'text with "quotes"\nand a newline');
	assert.deepEqual(parsed.message.content[1], {
		type: "image",
		source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
	});
});

test("Claude permissions match read-only, isolated writable and auxiliary sessions", () => {
	const read = claudeArguments(request);
	assert.equal(read[read.indexOf("--tools") + 1], "Read,Glob,Grep");
	assert.equal(read[read.indexOf("--permission-mode") + 1], "dontAsk");
	assert.ok(read.includes("--no-session-persistence"));
	assert.ok(read.includes("--strict-mcp-config"));
	assert.ok(!read.some((arg) => /bypass|dangerously/.test(arg)));
	const write = claudeArguments({ ...request, writable: true, modelId: "custom-model" });
	assert.equal(write[write.indexOf("--tools") + 1], "Read,Glob,Grep,Edit,Write,Bash");
	assert.match(write[write.indexOf("--allowedTools") + 1], /Edit\(\.\/\*\*\)/);
	assert.equal(write[write.indexOf("--model") + 1], "custom-model");
	const auxiliary = claudeArguments({ ...request, tools: false });
	assert.equal(auxiliary[auxiliary.indexOf("--tools") + 1], "");
	assert.ok(!auxiliary.includes("--allowedTools"));
});

test("Claude streaming text and thinking are not repeated by final assistant events", async () => {
	const emitted: AgentBridgeEvent[] = [];
	const result = await consumeClaudeEvents(
		stream([
			{ type: "system", subtype: "init", session_id: "native-session" },
			{ type: "stream_event", event: { type: "message_start" } },
			{
				type: "stream_event",
				event: {
					type: "content_block_delta",
					delta: { type: "thinking_delta", thinking: "Reasoning" },
				},
			},
			{
				type: "stream_event",
				event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
			},
			{
				type: "assistant",
				message: {
					content: [
						{ type: "thinking", thinking: "Reasoning" },
						{ type: "text", text: "Hello" },
					],
				},
			},
			{
				type: "result",
				subtype: "success",
				is_error: false,
				result: "Hello",
				total_cost_usd: 0.012,
				usage: {
					input_tokens: 5,
					output_tokens: 10,
					cache_read_input_tokens: 40,
					cache_creation_input_tokens: 8,
				},
			},
		]),
		(event) => emitted.push(event),
	);
	assert.equal(result.assistantText, "Hello");
	assert.equal(result.reasoningText, "Reasoning");
	assert.equal(result.sessionId, "native-session");
	assert.deepEqual(result.usage, {
		input: 5,
		output: 10,
		cacheRead: 40,
		cacheWrite: 8,
		cost: 0.012,
	});
	assert.equal(emitted.filter((event) => event.streamKind === "text").length, 1);
	assert.equal(emitted.filter((event) => event.streamKind === "reasoning").length, 1);
});

test("Claude tool calls/results use matching renderer IDs and ignore subagent text", async () => {
	const emitted: AgentBridgeEvent[] = [];
	await consumeClaudeEvents(
		stream([
			{
				type: "assistant",
				message: {
					content: [
						{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "file.ts" } },
					],
				},
			},
			{
				type: "user",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "read-1",
							content: "Permission denied",
							is_error: true,
						},
					],
				},
			},
			{
				type: "assistant",
				parent_tool_use_id: "child",
				message: { content: [{ type: "text", text: "Not the final response" }] },
			},
			{ type: "assistant", message: { content: [{ type: "text", text: "Done" }] } },
			{ type: "result", subtype: "success", result: "Done" },
		]),
		(event) => emitted.push(event),
	);
	assert.deepEqual(
		emitted.map((event) => event.type),
		["tool_execution_start", "tool_execution_end", "message_update"],
	);
	assert.deepEqual(emitted[1].payload, {
		toolCallId: "read-1",
		result: "Permission denied",
		isError: true,
	});
});

test("Claude failures cannot become successful empty or partial answers", async () => {
	for (const events of [
		[],
		[{ type: "assistant", message: { content: [{ type: "text", text: "Partial" }] } }],
		[{ type: "result", subtype: "error_during_execution", errors: ["Authentication failed"] }],
		[{ type: "result", subtype: "success", result: "" }],
		[{ type: "error", error: { message: "Expired credentials" } }],
	]) {
		await assert.rejects(consumeClaudeEvents(stream(events), () => {}));
	}
});

test("Claude API retries surface connection status without fabricating reasoning or tool calls", async () => {
	const emitted: AgentBridgeEvent[] = [];
	await consumeClaudeEvents(
		stream([
			{ type: "system", subtype: "api_retry", retry_attempt: 2 },
			{ type: "result", subtype: "success", result: "Recovered" },
		]),
		(event) => emitted.push(event),
	);
	assert.equal(emitted.length, 1);
	assert.equal(emitted[0].type, "provider_status");
	assert.match(emitted[0].message ?? "", /attempt 2/);
	assert.equal(emitted[0].streamKind, undefined);
});

test("the complete Claude adapter launches a local CLI with structured input and streams its response", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-claude-adapter-"));
	const previousPath = process.env.RHYZA_CLAUDE_PATH;
	try {
		const executable = path.join(directory, "mock & claude.cjs");
		await writeFile(
			executable,
			`
			const assert = require("node:assert/strict");
			assert.ok(process.argv.includes("--input-format"));
			assert.ok(process.argv.includes("stream-json"));
			assert.ok(process.argv.includes("dontAsk"));
			let input = "";
			process.stdin.setEncoding("utf8");
			process.stdin.on("data", chunk => input += chunk);
			process.stdin.on("end", () => {
				const message = JSON.parse(input);
				assert.equal(message.type, "user");
				assert.equal(message.session_id, "");
				assert.equal(message.parent_tool_use_id, null);
				assert.equal(message.message.content[1].source.media_type, "image/png");
				const emit = event => console.log(JSON.stringify(event));
				emit({ type: "system", subtype: "init", session_id: "mock-session" });
				emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "OK" } } });
				emit({ type: "assistant", message: { content: [{ type: "text", text: "OK" }] } });
				emit({ type: "result", subtype: "success", is_error: false, result: "OK", usage: { input_tokens: 4, output_tokens: 1 } });
			});
		`,
			"utf8",
		);
		process.env.RHYZA_CLAUDE_PATH = executable;
		const events: AgentBridgeEvent[] = [];
		const result = await runClaudeAgent(
			{ ...request, workspacePath: directory, signal: AbortSignal.timeout(10_000) },
			(event) => events.push(event),
		);
		assert.equal(result.assistantText, "OK");
		assert.equal(result.sessionId, "mock-session");
		assert.equal(result.usage?.input, 4);
		assert.equal(events.filter((event) => event.streamKind === "text").length, 1);
	} finally {
		if (previousPath === undefined) delete process.env.RHYZA_CLAUDE_PATH;
		else process.env.RHYZA_CLAUDE_PATH = previousPath;
		await rm(directory, { recursive: true, force: true });
	}
});
