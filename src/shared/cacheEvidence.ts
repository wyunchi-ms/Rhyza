import type { AgentCacheEvidence } from "./ipc.js";
import { isRecord } from "./value.js";

export function responseCacheEvidence(message: unknown): AgentCacheEvidence | undefined {
	if (!isRecord(message) || message.role !== "assistant") return;
	if (
		!["openai-responses", "azure-openai-responses", "openai-codex-responses"].includes(
			String(message.api),
		)
	)
		return;
	const cache = message.rhyzaPromptCache;
	if (!isRecord(cache) || typeof cache.ttl !== "string") return;
	const duration = /^([1-9]\d*)(s|m|h|d)$/.exec(cache.ttl);
	if (!duration) return;
	const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
	const ttlMs = Number(duration[1]) * units[duration[2]];
	if (!Number.isSafeInteger(ttlMs)) return;
	const startedAt =
		typeof cache.createdAt === "number" && Number.isFinite(cache.createdAt) && cache.createdAt > 0
			? new Date(cache.createdAt * 1000)
			: undefined;
	return {
		ttl: cache.ttl,
		ttlMs,
		mode: cache.mode === "implicit" || cache.mode === "explicit" ? cache.mode : undefined,
		semantics: "minimum",
		source: "response",
		startedAt:
			startedAt && Number.isFinite(startedAt.getTime()) ? startedAt.toISOString() : undefined,
	};
}
