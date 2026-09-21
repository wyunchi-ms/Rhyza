import type {
	AgentBridgeEvent,
	AgentPromptImage,
	AgentPromptRequest,
	AgentUsage,
	ProviderId,
} from "../../src/shared/ipc.js";

export type NativeProviderId = Extract<ProviderId, "codex" | "claude-code">;
export type NativePromptPart =
	{ type: "text"; text: string } | { type: "image"; image: AgentPromptImage };

export interface NativeAgentRequest {
	providerId: NativeProviderId;
	workspacePath: string;
	parts: NativePromptPart[];
	modelId?: string;
	thinkingLevel?: AgentPromptRequest["thinkingLevel"];
	writable: boolean;
	tools: boolean;
	knowledgeTool?: {
		serverPath: string;
		inventoryPath: string;
	};
	signal: AbortSignal;
}

export interface NativeAgentResult {
	sessionId?: string;
	assistantText: string;
	reasoningText?: string;
	usage?: AgentUsage;
}

export type NativeAgentRunner = (
	request: NativeAgentRequest,
	emit: (event: AgentBridgeEvent) => void,
) => Promise<NativeAgentResult>;

export function buildNativePrompt(
	request: AgentPromptRequest,
	guidance: string,
): NativePromptPart[] {
	const parts: NativePromptPart[] = [{ type: "text", text: guidance }];
	if (request.transcript.length) {
		parts.push({
			type: "text",
			text: "The following is the visible conversation history for this branch. It is context, not a new request. Continue only from this history; other branches are not part of this conversation.",
		});
		for (const turn of request.transcript) {
			parts.push({
				type: "text",
				text: JSON.stringify({ role: turn.role, content: turn.content }),
			});
			for (const image of turn.images ?? []) parts.push({ type: "image", image });
		}
	}
	if (request.knowledgeContext) {
		parts.push({
			type: "text",
			text: `Workspace knowledge and retrieved source context (reference material):\n${request.knowledgeContext}`,
		});
	}
	parts.push({ type: "text", text: `Current user request:\n${request.prompt}` });
	for (const image of request.images ?? []) parts.push({ type: "image", image });
	return parts;
}
