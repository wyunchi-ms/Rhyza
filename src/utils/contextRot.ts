import type { AgentModelRequestSnapshot, AgentUsage } from "../shared/ipc";

export type ContextBlockKind = "conversation" | "tool_io";

export interface ContextMessageAnalysis {
	index: number;
	role: string;
	kind: ContextBlockKind;
	preview: string;
	estimatedTokens: number;
	relevance: number;
	ageTurns: number;
	rotContribution: number;
	stale: boolean;
}

export interface ContextComposition {
	system: number;
	conversation: number;
	toolIo: number;
	total: number;
}

export interface ContextRotAnalysis {
	relevance: number;
	rot: number;
	estimatedTokens: number;
	deadWeightTokens: number;
	composition: ContextComposition;
	messages: ContextMessageAnalysis[];
}

export function analyzeContextRot(request: AgentModelRequestSnapshot): ContextRotAnalysis {
	const messages = request.context.messages.map(normalizeMessage);
	let currentUserIndex = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "user") { currentUserIndex = index; break; }
	}
	const currentRequest = messages[currentUserIndex]?.text ?? "";
	const queryTerms = terms(currentRequest);
	const currentTurn = messages.slice(0, currentUserIndex + 1).filter((message) => message.role === "user").length;
	let seenUserTurns = 0;
	const analyzed = messages.map((message, index): ContextMessageAnalysis => {
		if (message.role === "user") seenUserTurns += 1;
		const ageTurns = Math.max(0, currentTurn - seenUserTurns);
		const messageTerms = terms(message.text);
		const overlap = queryTerms.size
			? [...messageTerms].filter((term) => queryTerms.has(term)).length / Math.max(1, Math.min(queryTerms.size, messageTerms.size))
			: 0;
		const relevance = index === currentUserIndex
			? 100
			: Math.round(Math.min(100, (overlap * 0.85 + Math.max(0, 1 - ageTurns / 8) * 0.15) * 100));
		const kind = message.role === "toolResult" || message.hasToolCall ? "tool_io" : "conversation";
		const ageFactor = Math.min(1, ageTurns / (kind === "tool_io" ? 3 : 5));
		const irrelevance = 1 - relevance / 100;
		const rotContribution = index === currentUserIndex ? 0 : Math.min(1, ageFactor * irrelevance * (kind === "tool_io" ? 1.2 : 1));
		return {
			index,
			role: message.role,
			kind,
			preview: message.text.replace(/\s+/g, " ").trim().slice(0, 180) || "[non-text content]",
			estimatedTokens: estimateTokens(message.text),
			relevance,
			ageTurns,
			rotContribution,
			stale: rotContribution >= 0.45,
		};
	});
	const composition = analyzeContextComposition(request);
	const weightedRelevance = analyzed.reduce((sum, message) => sum + message.relevance * message.estimatedTokens, 0)
		+ composition.system * 100;
	const relevance = composition.total ? Math.round(weightedRelevance / composition.total) : 100;
	const deadWeightTokens = Math.round(analyzed.reduce((sum, message) => sum + message.estimatedTokens * message.rotContribution, 0));
	const rot = composition.total ? Math.round(deadWeightTokens / composition.total * 100) : 0;
	return { relevance, rot, estimatedTokens: composition.total, deadWeightTokens, composition, messages: analyzed };
}

export function analyzeContextComposition(request: AgentModelRequestSnapshot): ContextComposition {
	const system = estimateTokens(request.context.systemPrompt ?? "") + estimateTokens(JSON.stringify(request.context.tools ?? []));
	let conversation = 0;
	let toolIo = 0;
	for (const value of request.context.messages) {
		if (!value || typeof value !== "object") {
			conversation += estimateTokens(String(value ?? ""));
			continue;
		}
		const message = value as Record<string, unknown>;
		const role = typeof message.role === "string" ? message.role : "unknown";
		if (role === "toolResult") {
			toolIo += estimateTokens(contentText(message.content));
			continue;
		}
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				const block = blockText(part);
				if (block.tool) toolIo += estimateTokens(block.text);
				else conversation += estimateTokens(block.text);
			}
		} else {
			conversation += estimateTokens(contentText(message.content));
		}
	}
	return { system, conversation, toolIo, total: system + conversation + toolIo };
}

/** Input resident in the provider request. Output belongs to the response, not the context window. */
export function residentInputTokens(usage: AgentUsage | undefined): number | undefined {
	return usage ? usage.input + usage.cacheRead + usage.cacheWrite : undefined;
}

function normalizeMessage(value: unknown): { role: string; text: string; hasToolCall: boolean } {
	if (!value || typeof value !== "object") return { role: "unknown", text: String(value ?? ""), hasToolCall: false };
	const record = value as Record<string, unknown>;
	return {
		role: typeof record.role === "string" ? record.role : "unknown",
		text: contentText(record.content),
		hasToolCall: Array.isArray(record.content) && record.content.some((part) => blockText(part).tool),
	};
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return JSON.stringify(content ?? "");
	return content.map((part) => blockText(part).text).join("\n");
}

function blockText(part: unknown): { text: string; tool: boolean } {
	if (!part || typeof part !== "object") return { text: String(part ?? ""), tool: false };
	const record = part as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type.toLocaleLowerCase() : "";
	const tool = type.includes("tool") || "toolCallId" in record || "arguments" in record;
	const text = typeof record.text === "string" ? record.text
		: typeof record.thinking === "string" ? record.thinking
		: typeof record.name === "string" ? `${record.name} ${JSON.stringify(record.arguments ?? "")}`
		: JSON.stringify(record);
	return { text, tool };
}

function terms(text: string): Set<string> {
	const normalized = text.toLocaleLowerCase();
	const latin = normalized.match(/[a-z0-9_./-]{2,}/g) ?? [];
	const han = normalized.match(/[\p{Script=Han}]{2,}/gu)?.flatMap((chunk) => {
		const chars = [...chunk];
		return chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
	}) ?? [];
	return new Set([...latin, ...han]);
}

function estimateTokens(text: string): number {
	if (!text) return 0;
	const han = (text.match(/[\p{Script=Han}]/gu) ?? []).length;
	return Math.max(1, Math.ceil(han * 1.4 + (text.length - han) / 4));
}
