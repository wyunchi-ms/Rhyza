import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "../store";
import type { Turn } from "../types";
import type { AgentBridgeEvent } from "../shared/ipc";
import { addUsage, emptyUsage } from "../utils/branchUsage";
import { summarizeToolTarget } from "../utils/knowledgeContext";
import { isTurnActive } from "../utils/sessionRuntime";
import { isRecord } from "../shared/value";
import { getKnowbranchBridge } from "./useKnowbranchBridge";

/** Owns the bridge-to-turn projection so chat surfaces do not duplicate stream semantics. */
export function useAgentEventStream() {
	const streamingTurns = useRef(new Map<string, string>());

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
			applyAgentEvent(turnId, event);
		});
	}, []);

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
	if (event.type === "message_end" && event.usage) {
		store.updateTurn(turnId, { usage: addUsage(current.usage ?? emptyUsage(), event.usage) });
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
