import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "../store";
import type { Turn } from "../types";
import type { AgentBridgeEvent } from "../shared/ipc";
import { addUsage, emptyUsage } from "../utils/branchUsage";
import { summarizeToolTarget } from "../utils/knowledgeContext";
import { isTurnActive } from "../utils/sessionRuntime";
import { isRecord } from "../shared/value";
import { getKnowbranchBridge } from "./useKnowbranchBridge";
import { recordPerformanceTiming } from "../utils/performanceMarks";

/** Owns the bridge-to-turn projection so chat surfaces do not duplicate stream semantics. */
export function useAgentEventStream() {
	const streamingTurns = useRef(new Map<string, string>());
	const pendingText = useRef(new Map<string, { content: string; reasoning: string; eventCount: number }>());
	const flushTimer = useRef<number | null>(null);
	const flushPendingText = useCallback(() => {
		if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
		flushTimer.current = null;
		const startedAt = performance.now();
		let eventCount = 0;
		for (const [turnId, pending] of pendingText.current) {
			const store = useAppStore.getState();
			const current = store.turns.find((turn) => turn.id === turnId);
			if (!current) continue;
			store.updateTurn(turnId, {
				...(pending.content ? { content: `${current.content}${pending.content}` } : {}),
				...(pending.reasoning ? { reasoning: `${current.reasoning ?? ""}${pending.reasoning}` } : {}),
			});
			eventCount += pending.eventCount;
		}
		pendingText.current.clear();
		if (eventCount) recordPerformanceTiming("stream-batch-commit", performance.now() - startedAt);
	}, []);
	const queueText = useCallback((turnId: string, field: "content" | "reasoning", text: string) => {
		const pending = pendingText.current.get(turnId) ?? { content: "", reasoning: "", eventCount: 0 };
		pending[field] += text;
		pending.eventCount += 1;
		pendingText.current.set(turnId, pending);
		if (flushTimer.current === null) flushTimer.current = window.setTimeout(flushPendingText, 75);
	}, [flushPendingText]);

	useEffect(() => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		return bridge.onAgentEvent((event) => {
			if (!event.frontendSessionId) return;
			const state = useAppStore.getState();
			const turnId = streamingTurns.current.get(event.frontendSessionId)
				?? [...state.turns].reverse().find((turn) =>
					turn.sessionId === event.frontendSessionId
					&& turn.role === "assistant"
					&& isTurnActive(turn),
				)?.id;
			if (!turnId) return;
			if (event.message && event.type === "message_update") {
				queueText(turnId, event.streamKind === "reasoning" ? "reasoning" : "content", event.message);
				return;
			}
			flushPendingText();
			applyAgentEvent(turnId, event);
		});
	}, [flushPendingText, queueText]);

	useEffect(() => () => flushPendingText(), [flushPendingText]);

	const registerStreamingTurn = useCallback((sessionId: string, turnId: string) => {
		streamingTurns.current.set(sessionId, turnId);
	}, []);
	const unregisterStreamingTurn = useCallback((sessionId: string) => {
		streamingTurns.current.delete(sessionId);
	}, []);

	return { registerStreamingTurn, unregisterStreamingTurn };
}

function applyAgentEvent(turnId: string, event: AgentBridgeEvent): void {
	const store = useAppStore.getState();
	const current = store.turns.find((turn) => turn.id === turnId);
	if (!current) return;
	if (event.type === "model_request" && event.modelRequest) {
		store.updateTurn(turnId, {
			modelRequests: [...(current.modelRequests ?? []).filter((request) => request.id !== event.modelRequest!.id), event.modelRequest],
		});
		return;
	}
	if (event.type === "wire_request" && event.requestId) {
		store.updateTurn(turnId, {
			modelRequests: (current.modelRequests ?? []).map((request) => request.id === event.requestId
				? { ...request, wirePayload: event.wirePayload }
				: request),
		});
		return;
	}
	if (event.type === "message_end" && event.usage) {
		store.updateTurn(turnId, {
			usage: addUsage(current.usage ?? emptyUsage(), event.usage),
			modelRequests: (current.modelRequests ?? []).map((request) => request.id === event.requestId
				? { ...request, usage: event.usage }
				: request),
		});
		return;
	}
	if (event.message && event.type === "message_update") {
		const field: "reasoning" | "content" = event.streamKind === "reasoning" ? "reasoning" : "content";
		store.updateTurn(turnId, { [field]: `${current[field] ?? ""}${event.message}` });
		return;
	}
	if (event.type === "tool_execution_start" && isRecord(event.payload)) {
		const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : crypto.randomUUID();
		const toolName = typeof event.payload.toolName === "string" ? event.payload.toolName : "tool";
		const tool = {
			id: toolCallId,
			name: toolName,
			target: summarizeToolTarget(event.payload.args),
			status: "running" as const,
			startedAt: new Date().toISOString(),
		};
		store.updateTurn(turnId, { tools: [...(current.tools ?? []).filter((item) => item.id !== toolCallId), tool] });
		return;
	}
	if (event.type === "tool_execution_end" && isRecord(event.payload)) {
		const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
		const isError = event.payload.isError === true;
		const completedAt = new Date();
		store.updateTurn(turnId, {
			tools: (current.tools ?? []).map((tool) => tool.id === toolCallId ? completeTool(tool, completedAt, isError) : tool),
		});
	}
}

function completeTool(tool: NonNullable<Turn["tools"]>[number], completedAt: Date, isError: boolean): NonNullable<Turn["tools"]>[number] {
	return {
		...tool,
		status: isError ? "error" : "complete",
		completedAt: completedAt.toISOString(),
		durationMs: Math.max(0, completedAt.getTime() - new Date(tool.startedAt).getTime()),
	};
}
