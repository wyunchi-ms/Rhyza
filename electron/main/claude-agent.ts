import type { AgentBridgeEvent, AgentUsage } from "../../src/shared/ipc.js";
import { isRecord } from "../../src/shared/value.js";
import { localClaudeCommand, streamCliJson } from "./cli-process.js";
import type { NativeAgentRequest, NativeAgentResult } from "./native-agent.js";

export function claudeArguments(request: NativeAgentRequest): string[] {
	const builtInTools = !request.tools
		? []
		: request.writable
			? ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]
			: ["Read", "Glob", "Grep"];
	const knowledgeTool = request.knowledgeTool
		? "mcp__rhyza_knowledge__search_knowledge"
		: undefined;
	const tools = [...builtInTools, ...(knowledgeTool ? [knowledgeTool] : [])];
	const allowedTools = tools.map((tool) =>
		tool === "Edit" || tool === "Write" ? `${tool}(./**)` : tool,
	);
	const mcpServers = request.knowledgeTool
		? {
				rhyza_knowledge: {
					command: process.execPath,
					args: [request.knowledgeTool.serverPath],
					env: {
						ELECTRON_RUN_AS_NODE: "1",
						RHYZA_KNOWLEDGE_INVENTORY: request.knowledgeTool.inventoryPath,
					},
				},
			}
		: {};
	const args = [
		"--print",
		"--verbose",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--include-partial-messages",
		"--no-session-persistence",
		"--permission-mode",
		"dontAsk",
		"--tools",
		tools.join(","),
		"--strict-mcp-config",
		"--mcp-config",
		JSON.stringify({ mcpServers }),
		"--disable-slash-commands",
		"--no-chrome",
	];
	if (allowedTools.length) args.push("--allowedTools", allowedTools.join(","));
	if (request.modelId) args.push("--model", request.modelId);
	if (request.thinkingLevel) {
		args.push("--effort", request.thinkingLevel === "off" ? "low" : request.thinkingLevel);
	}
	return args;
}

export function claudeInput(request: NativeAgentRequest): string {
	return `${JSON.stringify({
		type: "user",
		session_id: "",
		parent_tool_use_id: null,
		message: {
			role: "user",
			content: request.parts.map((part) =>
				part.type === "text"
					? part
					: {
							type: "image",
							source: {
								type: "base64",
								media_type: part.image.mimeType,
								data: part.image.data,
							},
						},
			),
		},
	})}\n`;
}

export async function runClaudeAgent(
	request: NativeAgentRequest,
	emit: (event: AgentBridgeEvent) => void,
): Promise<NativeAgentResult> {
	const command = await localClaudeCommand();
	if (request.parts.some((part) => part.type === "image" && part.image.mimeType === "image/bmp")) {
		throw new Error("Claude Code does not support BMP images. Use PNG, JPEG, GIF, or WebP.");
	}
	return consumeClaudeEvents(
		streamCliJson(
			command,
			claudeArguments(request),
			claudeInput(request),
			request.workspacePath,
			request.signal,
		),
		emit,
	);
}

export async function consumeClaudeEvents(
	events: AsyncIterable<unknown>,
	emit: (event: AgentBridgeEvent) => void,
): Promise<NativeAgentResult> {
	let sessionId: string | undefined;
	let assistantText = "";
	let reasoningText = "";
	let usage: AgentUsage | undefined;
	let completed = false;
	let streamedText = false;
	let streamedReasoning = false;
	const startedTools = new Set<string>();
	for await (const event of events) {
		if (!isRecord(event) || typeof event.type !== "string") {
			throw new Error("Claude Code returned an invalid stream event.");
		}
		if (typeof event.session_id === "string") sessionId = event.session_id;
		if (event.parent_tool_use_id) continue;
		if (event.type === "system" && event.subtype === "api_retry") {
			const attempt =
				typeof event.retry_attempt === "number" ? ` (attempt ${event.retry_attempt})` : "";
			emit({
				type: "provider_status",
				sessionId,
				message: `Claude Code is retrying its API request${attempt}. If this continues, check the CLI's authentication, network, and model access.`,
			});
		}
		if (event.type === "error") {
			throw new Error(
				typeof event.message === "string"
					? event.message
					: isRecord(event.error) && typeof event.error.message === "string"
						? event.error.message
						: "Claude Code reported a stream error.",
			);
		}
		if (event.type === "stream_event" && isRecord(event.event)) {
			const update = event.event;
			if (update.type === "message_start") {
				streamedText = false;
				streamedReasoning = false;
			}
			if (update.type !== "content_block_delta" || !isRecord(update.delta)) continue;
			const delta = update.delta;
			if (delta.type === "text_delta" && typeof delta.text === "string") {
				streamedText = true;
				emit({ type: "message_update", sessionId, streamKind: "text", message: delta.text });
			}
			if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
				streamedReasoning = true;
				reasoningText += delta.thinking;
				emit({
					type: "message_update",
					sessionId,
					streamKind: "reasoning",
					message: delta.thinking,
				});
			}
		}
		if ((event.type === "assistant" || event.type === "user") && isRecord(event.message)) {
			const content = event.message.content;
			if (!Array.isArray(content)) continue;
			const text = content
				.flatMap((part) =>
					isRecord(part) && part.type === "text" && typeof part.text === "string"
						? [part.text]
						: [],
				)
				.join("");
			if (event.type === "assistant" && text) {
				assistantText = text;
				if (!streamedText)
					emit({ type: "message_update", sessionId, streamKind: "text", message: text });
			}
			for (const part of content) {
				if (!isRecord(part)) continue;
				if (part.type === "thinking" && typeof part.thinking === "string" && !streamedReasoning) {
					reasoningText += part.thinking;
					emit({
						type: "message_update",
						sessionId,
						streamKind: "reasoning",
						message: part.thinking,
					});
				}
				if (part.type === "tool_use" && typeof part.id === "string" && !startedTools.has(part.id)) {
					startedTools.add(part.id);
					emit({
						type: "tool_execution_start",
						sessionId,
						payload: { toolCallId: part.id, toolName: part.name, args: part.input },
					});
				}
				if (part.type === "tool_result" && typeof part.tool_use_id === "string") {
					emit({
						type: "tool_execution_end",
						sessionId,
						payload: {
							toolCallId: part.tool_use_id,
							result: part.content,
							isError: part.is_error === true,
						},
					});
				}
			}
		}
		if (event.type === "result") {
			if (event.is_error === true || event.subtype !== "success") {
				const errors = Array.isArray(event.errors)
					? event.errors.filter((error): error is string => typeof error === "string").join("\n")
					: "";
				throw new Error(
					errors ||
						(typeof event.result === "string" && event.result) ||
						`Claude Code failed: ${String(event.subtype)}`,
				);
			}
			completed = true;
			if (typeof event.result === "string") assistantText = event.result;
			if (isRecord(event.usage)) {
				usage = {
					input: tokenCount(event.usage.input_tokens),
					output: tokenCount(event.usage.output_tokens),
					cacheRead: tokenCount(event.usage.cache_read_input_tokens),
					cacheWrite: tokenCount(event.usage.cache_creation_input_tokens),
					cost: tokenCount(event.total_cost_usd),
				};
			}
		}
	}
	if (!completed) throw new Error("Claude Code stream ended without a successful result.");
	if (!assistantText.trim()) throw new Error("Claude Code returned no assistant text.");
	return { sessionId, assistantText, reasoningText: reasoningText || undefined, usage };
}

function tokenCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
