import type { TokenUsage, Turn } from "../types";
import { addUsage, emptyUsage, usageTokens } from "./branchUsage";

export const cacheHitDescription = "Cache read ÷ (input + cache read + cache write)";

export function inputTokens(usage: TokenUsage): number {
	return usage.input + usage.cacheRead + usage.cacheWrite;
}

export function usageMetrics(usage?: TokenUsage) {
	const input = usage ? inputTokens(usage) : undefined;
	return {
		totalTokens: usage ? usageTokens(usage) : undefined,
		inputTokens: input,
		cacheHitRate: usage && input ? usage.cacheRead / input * 100 : undefined,
	};
}

export function formatCacheHitRate(rate?: number): string {
	return rate === undefined ? "—" : `${rate.toFixed(1)}%`;
}

/** Completed turn totals are authoritative. Request usage fills in live/legacy gaps.
 * Inherited usage is display-only and must not be counted again by graph totals. */
export function resolveTurnUsage(turn: Turn, includeInherited = true) {
	if (turn.usage) return { usage: turn.usage, partial: false, inherited: false };
	if (includeInherited && turn.inheritedUsage) return { usage: turn.inheritedUsage, partial: false, inherited: true };
	const requests = turn.modelRequests ?? [];
	const recorded = requests.filter((request) => request.usage);
	return {
		usage: recorded.length ? recorded.reduce((sum, request) => addUsage(sum, request.usage), emptyUsage()) : undefined,
		partial: !recorded.length || recorded.length !== requests.length,
		inherited: false,
	};
}
