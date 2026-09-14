import type { AgentCacheRequest } from "../shared/ipc";
import type { Turn } from "../types";

export function lastCacheRequest(turns: Turn[]): AgentCacheRequest | undefined {
	for (let index = turns.length - 1; index >= 0; index--) {
		const turn = turns[index];
		if (turn.role !== "assistant") continue;
		const requests = turn.modelRequests;
		return requests?.length ? requests[requests.length - 1] : turn.cacheRequest;
	}
}

export interface CacheStatus {
	state: "estimated" | "expired";
	label: string;
	detail: string;
	expiresAt: number;
}

/** Missing actual TTL evidence means no UI, including historical and pending requests. */
export function cacheStatus(
	request: AgentCacheRequest | undefined,
	now = Date.now(),
	selectedModel?: string,
): CacheStatus | undefined {
	if (!request || (selectedModel && selectedModel !== request.model)) return;
	const { usage, cache } = request;
	if (!usage || !cache || cache.source !== "response" || cache.semantics !== "minimum") return;
	if (
		!Number.isFinite(usage.cacheRead) ||
		!Number.isFinite(usage.cacheWrite) ||
		usage.cacheRead + usage.cacheWrite <= 0
	)
		return;
	if (!Number.isFinite(cache.ttlMs) || cache.ttlMs <= 0) return;
	const startedAt = Date.parse(cache.startedAt ?? request.timestamp);
	if (!Number.isFinite(startedAt) || !Number.isFinite(now) || now < startedAt) return;
	const expiresAt = startedAt + cache.ttlMs;
	if (!Number.isFinite(new Date(expiresAt).getTime())) return;
	const expired = now >= expiresAt;
	return {
		state: expired ? "expired" : "estimated",
		label: expired
			? "Cache may have expired"
			: `Cache · ~${Math.ceil((expiresAt - now) / 60_000)}m remaining`,
		expiresAt,
		detail: `The provider reported a ${cache.ttl} minimum cache lifetime${cache.mode ? ` (${cache.mode})` : ""}. The time shown is estimated from the latest request start, including response generation time. Cache may remain available after this window. Reuse also depends on the same model and matching prompt prefix; activity in other branches can extend its lifetime.`,
	};
}
