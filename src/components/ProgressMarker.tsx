import clsx from "clsx";
import { CheckCircle2, Circle, CircleDot, PauseCircle } from "lucide-react";
import type { SessionProgressStatus } from "../types";

export const progressOptions: Array<{
	value?: SessionProgressStatus;
	label: string;
	description: string;
	icon: typeof Circle;
}> = [
	{ label: "Unmarked", description: "Do not track this node", icon: Circle },
	{ value: "todo", label: "To explore", description: "Questions still need investigation", icon: Circle },
	{ value: "in_progress", label: "In progress", description: "Currently being worked through", icon: CircleDot },
	{ value: "complete", label: "Completed", description: "This question has been answered", icon: CheckCircle2 },
	{ value: "parked", label: "On hold", description: "Keep this node for later", icon: PauseCircle },
];

export const ProgressMarker = ({ status, active }: { status?: SessionProgressStatus; active: boolean }) => {
	const option = progressOptions.find((item) => item.value === status) ?? progressOptions[0];
	const Icon = option.icon;
	return (
		<span title={option.label} aria-label={`Node status: ${option.label}`} className={clsx("session-progress-marker", status && `status-${status}`, active && "is-active")}>
			<Icon size={status ? 12 : 7} strokeWidth={status ? 2.25 : 3} />
		</span>
	);
};
