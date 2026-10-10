import dagre from "dagre";
import type { SessionNode } from "../types";

export type SessionGraphOrientation = "horizontal" | "vertical";

export const sessionGraphNodeSize = { width: 280, height: 136 } as const;
export const summaryJunctionSize = { width: 8, height: 8 } as const;

export interface SummarySourceGroup {
	id: string;
	sources: string[];
	targets: string[];
}

export function groupSummarySourceEdges(
	edges: readonly { source: string; target: string }[],
): SummarySourceGroup[] {
	const sourcesByTarget = new Map<string, Set<string>>();
	for (const { source, target } of edges) {
		const sources = sourcesByTarget.get(target) ?? new Set<string>();
		sources.add(source);
		sourcesByTarget.set(target, sources);
	}
	const groups = new Map<string, SummarySourceGroup>();
	for (const [target, sourceIds] of sourcesByTarget) {
		const sources = [...sourceIds].sort();
		const key = JSON.stringify(sources);
		const group = groups.get(key);
		if (group) group.targets.push(target);
		else groups.set(key, { id: `summary-sources:${target}`, sources, targets: [target] });
	}
	return [...groups.values()];
}

export interface PositionedSessionNode {
	id: string;
	x: number;
	y: number;
}

export function layoutSessionGraph(
	sessions: Pick<SessionNode, "id" | "parentId">[],
	orientation: SessionGraphOrientation,
	sourceGroups: readonly SummarySourceGroup[] = [],
): PositionedSessionNode[] {
	const graph = new dagre.graphlib.Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({
		rankdir: orientation === "horizontal" ? "LR" : "TB",
		ranksep: sourceGroups.length ? 48 : orientation === "horizontal" ? 82 : 70,
		nodesep: orientation === "horizontal" ? 34 : 48,
	});

	const sessionIds = new Set(sessions.map((session) => session.id));
	for (const session of sessions) graph.setNode(session.id, { ...sessionGraphNodeSize });
	for (const session of sessions) {
		if (session.parentId && sessionIds.has(session.parentId))
			graph.setEdge(session.parentId, session.id);
	}
	const visibleGroups = sourceGroups.filter(
		(group) =>
			!sessionIds.has(group.id) &&
			group.sources.some((source) => sessionIds.has(source)) &&
			group.targets.some((target) => sessionIds.has(target)),
	);
	for (const group of visibleGroups) {
		graph.setNode(group.id, { ...summaryJunctionSize });
		for (const source of group.sources) {
			if (sessionIds.has(source)) graph.setEdge(source, group.id);
		}
		for (const target of group.targets) {
			if (sessionIds.has(target)) graph.setEdge(group.id, target);
		}
	}
	dagre.layout(graph);

	return [
		...sessions.map((session) => ({ id: session.id, size: sessionGraphNodeSize })),
		...visibleGroups.map((group) => ({ id: group.id, size: summaryJunctionSize })),
	].map(({ id, size }) => {
		const point = graph.node(id);
		return {
			id,
			x: point.x - size.width / 2,
			y: point.y - size.height / 2,
		};
	});
}
