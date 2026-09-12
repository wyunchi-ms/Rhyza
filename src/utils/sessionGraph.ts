import dagre from "dagre";
import type { SessionNode } from "../types";

export type SessionGraphOrientation = "horizontal" | "vertical";

export const sessionGraphNodeSize = { width: 248, height: 126 } as const;

export interface PositionedSessionNode {
	id: string;
	x: number;
	y: number;
}

export function layoutSessionGraph(
	sessions: Pick<SessionNode, "id" | "parentId">[],
	orientation: SessionGraphOrientation,
): PositionedSessionNode[] {
	const graph = new dagre.graphlib.Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({
		rankdir: orientation === "horizontal" ? "LR" : "TB",
		ranksep: orientation === "horizontal" ? 82 : 70,
		nodesep: orientation === "horizontal" ? 34 : 48,
	});

	const sessionIds = new Set(sessions.map((session) => session.id));
	for (const session of sessions) graph.setNode(session.id, { ...sessionGraphNodeSize });
	for (const session of sessions) {
		if (session.parentId && sessionIds.has(session.parentId)) graph.setEdge(session.parentId, session.id);
	}
	dagre.layout(graph);

	return sessions.map((session) => {
		const point = graph.node(session.id);
		return {
			id: session.id,
			x: point.x - sessionGraphNodeSize.width / 2,
			y: point.y - sessionGraphNodeSize.height / 2,
		};
	});
}
