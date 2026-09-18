import { Codex, type ThreadEvent, type ThreadOptions, type UserInput } from "@openai/codex-sdk";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentBridgeEvent, AgentUsage } from "../../src/shared/ipc.js";
import type { NativeAgentRequest, NativeAgentResult } from "./native-agent.js";

export function codexThreadOptions(request: NativeAgentRequest): ThreadOptions {
	return {
		workingDirectory: request.workspacePath,
		model: request.modelId || undefined,
		modelReasoningEffort: request.thinkingLevel === "off" ? "minimal" : request.thinkingLevel,
		sandboxMode: request.writable ? "workspace-write" : "read-only",
		approvalPolicy: "never",
		skipGitRepoCheck: true,
		networkAccessEnabled: false,
		webSearchMode: "disabled",
	};
}

export async function runCodexAgent(
	request: NativeAgentRequest,
	emit: (event: AgentBridgeEvent) => void,
	client: Pick<Codex, "startThread"> = new Codex({
		configOverrides: ["mcp_servers={}"],
		config: { features: { shell_tool: request.tools } },
	}),
): Promise<NativeAgentResult> {
	let imageDirectory: string | undefined;
	try {
		const input: UserInput[] = [];
		for (const part of request.parts) {
			if (part.type === "text") {
				input.push(part);
				continue;
			}
			imageDirectory ??= await mkdtemp(path.join(tmpdir(), "rhyza-codex-images-"));
			const imagePath = path.join(
				imageDirectory,
				`${input.length}.${part.image.mimeType.slice("image/".length)}`,
			);
			await writeFile(imagePath, Buffer.from(part.image.data, "base64"), { mode: 0o600 });
			input.push({ type: "local_image", path: imagePath });
		}
		const thread = client.startThread(codexThreadOptions(request));
		const { events } = await thread.runStreamed(input, { signal: request.signal });
		return await consumeCodexEvents(events, emit);
	} finally {
		if (imageDirectory) await rm(imageDirectory, { recursive: true, force: true });
	}
}

export async function consumeCodexEvents(
	events: AsyncIterable<ThreadEvent>,
	emit: (event: AgentBridgeEvent) => void,
): Promise<NativeAgentResult> {
	let sessionId: string | undefined;
	let assistantText = "";
	let usage: AgentUsage | undefined;
	let completed = false;
	const textItems = new Map<string, string>();
	const reasoningItems = new Map<string, string>();
	const startedTools = new Set<string>();
	for await (const event of events) {
		if (event.type === "thread.started") sessionId = event.thread_id;
		if (event.type === "error") throw new Error(event.message);
		if (event.type === "turn.failed") throw new Error(event.error.message);
		if (event.type === "turn.completed") {
			completed = true;
			usage = {
				input: Math.max(0, event.usage.input_tokens - event.usage.cached_input_tokens),
				output: event.usage.output_tokens,
				cacheRead: event.usage.cached_input_tokens,
				cacheWrite: event.usage.cache_write_input_tokens ?? 0,
				cost: 0,
			};
		}
		if (!("item" in event)) continue;
		const item = event.item;
		if (item.type === "agent_message" || item.type === "reasoning") {
			const items = item.type === "agent_message" ? textItems : reasoningItems;
			const previous = items.get(item.id) ?? "";
			items.set(item.id, item.text);
			const delta = item.text.startsWith(previous) ? item.text.slice(previous.length) : "";
			if (delta) {
				emit({
					type: "message_update",
					sessionId,
					streamKind: item.type === "reasoning" ? "reasoning" : "text",
					message: delta,
				});
			}
			if (item.type === "agent_message") assistantText = item.text;
			continue;
		}
		if (item.type === "todo_list") continue;
		const toolName = item.type === "mcp_tool_call" ? `${item.server}.${item.tool}` : item.type;
		const args =
			item.type === "command_execution"
				? { command: item.command }
				: item.type === "mcp_tool_call"
					? item.arguments
					: item;
		if (!startedTools.has(item.id)) {
			startedTools.add(item.id);
			emit({
				type: "tool_execution_start",
				sessionId,
				payload: { toolCallId: item.id, toolName, args },
			});
		}
		if (event.type === "item.completed") {
			const result =
				item.type === "command_execution"
					? item.aggregated_output
					: item.type === "mcp_tool_call"
						? (item.result ?? item.error)
						: item;
			const isError = item.type === "error" || ("status" in item && item.status === "failed");
			emit({
				type: "tool_execution_end",
				sessionId,
				payload: { toolCallId: item.id, toolName, result, isError },
			});
		}
	}
	if (!completed) throw new Error("Codex stream ended without a completed turn.");
	if (!assistantText.trim()) throw new Error("Codex returned no assistant text.");
	return {
		sessionId,
		assistantText,
		reasoningText: [...reasoningItems.values()].join("\n\n") || undefined,
		usage,
	};
}
