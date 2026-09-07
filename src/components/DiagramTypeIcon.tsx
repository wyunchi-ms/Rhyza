import { Boxes, Columns3, GitFork, ListOrdered, Network, RefreshCw, Route, Waypoints, Workflow } from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import type { Diagram } from "../types";

const icons: Record<Diagram["type"], ComponentType<LucideProps>> = {
	architecture: Boxes,
	structure: Network,
	flowchart: Workflow,
	sequence: ListOrdered,
	swimlane: Columns3,
	dependency: GitFork,
	workflow: Route,
	dataflow: Waypoints,
	lifecycle: RefreshCw,
};

export function DiagramTypeIcon({ type, ...props }: LucideProps & { type: Diagram["type"] }) {
	const Icon = icons[type];
	return <Icon {...props} />;
}
