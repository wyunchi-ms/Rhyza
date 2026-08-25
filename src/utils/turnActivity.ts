import type { TurnActivity } from "../types";

export function startTurnActivity(
	activities: TurnActivity[] | undefined,
	id: TurnActivity["id"],
	label: string,
	startedAt = new Date().toISOString(),
): TurnActivity[] {
	return [
		...(activities ?? []).filter((activity) => activity.id !== id),
		{ id, label, status: "running", startedAt },
	];
}

export function finishTurnActivity(
	activities: TurnActivity[] | undefined,
	id: TurnActivity["id"],
	status: "complete" | "error",
	detail?: string,
	completedAt = new Date().toISOString(),
): TurnActivity[] {
	return (activities ?? []).map((activity) => activity.id !== id ? activity : {
		...activity,
		status,
		detail,
		completedAt,
		durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(activity.startedAt).getTime()),
	});
}

export function failRunningTurnActivities(
	activities: TurnActivity[] | undefined,
	detail: string,
	completedAt = new Date().toISOString(),
): TurnActivity[] {
	return (activities ?? []).map((activity) => activity.status !== "running" ? activity : {
		...activity,
		status: "error",
		detail,
		completedAt,
		durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(activity.startedAt).getTime()),
	});
}
