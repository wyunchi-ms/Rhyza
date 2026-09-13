import type { TokenUsage } from "../types";
import type { ConversationRound } from "./conversationGraph";
import { addUsage, emptyUsage } from "./branchUsage";
import { resolveTurnUsage, usageMetrics } from "./usageMetrics";
import { isTurnActive } from "./sessionRuntime";

/** Only this round's original answers count; copied history and descendants do not. */
export function roundMetrics(round: ConversationRound, now = Date.now()) {
	let usage: TokenUsage | undefined;
	let missingUsage = false;
	let calls: number | undefined = 0;
	let durationMs: number | undefined = 0;
	for (const turn of round.answers) {
		const requests = turn.modelRequests;
		const { usage: turnUsage, partial } = resolveTurnUsage(turn, false);
		if (turnUsage) usage = addUsage(usage ?? emptyUsage(), turnUsage);
		if (partial) missingUsage = true;
		// An assistant answer can involve many provider calls. Never infer one call per answer.
		calls = calls === undefined || !requests ? undefined : calls + requests.length;
		const start = Date.parse(turn.createdAt);
		const end = turn.completedAt ? Date.parse(turn.completedAt) : isTurnActive(turn) ? now : NaN;
		durationMs = durationMs === undefined || !Number.isFinite(start) || !Number.isFinite(end)
			? undefined : durationMs + Math.max(0, end - start);
	}
	if (!round.answers.length) usage = emptyUsage();
	const active = round.answers.find(isTurnActive);
	const last = round.answers[round.answers.length - 1];
	const status = active?.status ?? (last?.status === "interrupted" ? "interrupted" : last?.activities?.some((activity) => activity.status === "error") ? "error" : last?.status)
		?? (round.user ? "waiting" : "idle");
	const requests = round.answers.flatMap((turn) => turn.modelRequests ?? []);
	const models = [...new Set(requests.map((request) => request.model).filter(Boolean))];
	const thinkingModes = [...new Set(requests.map((request) => request.thinking).filter(Boolean))];
	return {
		usage, ...usageMetrics(usage),
		partialUsage: Boolean(usage && missingUsage), calls, durationMs, status, models, thinkingModes,
	};
}

export function executionAppearance(status: string) {
	if (["queued", "retrieving", "running", "finalizing"].includes(status)) return "running";
	if (status === "error") return "error";
	if (status === "interrupted" || status === "complete_with_unsynced_knowledge") return "interrupted";
	if (status === "complete") return "complete";
	return "idle";
}
