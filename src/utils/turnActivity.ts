import type { AgentBridgeEvent } from "../shared/ipc";
import type { Turn, TurnActivity } from "../types";

export function providerStatusActivityPatch(
	turn: Turn,
	event: Pick<AgentBridgeEvent, "type" | "message">,
): Pick<Turn, "summary" | "activities"> | undefined {
	if (turn.role !== "assistant" || turn.status !== "running") return undefined;
	const agent = turn.activities?.find((activity) => activity.id === "agent");
	if (agent && agent.status !== "running") return undefined;

	if (event.type === "provider_status") {
		const message = event.message?.trim();
		if (!message || (agent?.detail === message && turn.summary === message)) return undefined;
		const activities = agent
			? turn.activities!
			: startTurnActivity(turn.activities, "agent", "Generating response", turn.createdAt);
		return {
			summary: message,
			activities: activities.map((activity) =>
				activity.id === "agent" ? { ...activity, detail: message } : activity,
			),
		};
	}

	const resumed =
		(event.type === "message_update" && Boolean(event.message)) ||
		event.type === "tool_execution_start" ||
		event.type === "tool_execution_end" ||
		event.type === "message_end" ||
		event.type === "agent_end";
	if (!resumed || !agent?.detail) return undefined;
	// In-flight agent detail is transient provider progress, not model output.
	return {
		summary: turn.summary === agent.detail ? agent.label : turn.summary,
		activities: turn.activities?.map((activity) =>
			activity.id === "agent" ? { ...activity, detail: undefined } : activity,
		),
	};
}

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
	return (activities ?? []).map((activity) =>
		activity.id !== id
			? activity
			: {
					...activity,
					status,
					detail,
					completedAt,
					durationMs: Math.max(
						0,
						new Date(completedAt).getTime() - new Date(activity.startedAt).getTime(),
					),
				},
	);
}

export function failRunningTurnActivities(
	activities: TurnActivity[] | undefined,
	detail: string,
	completedAt = new Date().toISOString(),
): TurnActivity[] {
	return (activities ?? []).map((activity) =>
		activity.status !== "running"
			? activity
			: {
					...activity,
					status: "error",
					detail,
					completedAt,
					durationMs: Math.max(
						0,
						new Date(completedAt).getTime() - new Date(activity.startedAt).getTime(),
					),
				},
	);
}
