import type { Diagram, DiagramEdge, DiagramNode, Entity, Relation } from "../types";

export interface ReconciledDiagram {
	before: Diagram;
	after: Diagram;
}

/**
 * Reconnects durable knowledge IDs without inventing knowledge. Matching is
 * intentionally conservative: only a unique exact name/alias or relation
 * endpoint match is accepted.
 */
export function reconcileKnowledgeGraph(
	entities: Entity[],
	relations: Relation[],
	diagrams: Diagram[],
	timestamp: string,
): ReconciledDiagram[] {
	const activeEntities = entities.filter((entity) => !entity.deletedAt);
	const activeRelations = relations.filter((relation) => !relation.deletedAt);
	const entityById = new Map(activeEntities.map((entity) => [entity.id, entity]));
	const relationById = new Map(activeRelations.map((relation) => [relation.id, relation]));
	const entitiesByLabel = buildEntityLabelIndex(activeEntities);

	return diagrams.filter((diagram) => !diagram.deletedAt).flatMap((diagram): ReconciledDiagram[] => {
		const nodes = diagram.nodes.map((node) => reconcileNode(node, entityById, entitiesByLabel));
		const nodeById = new Map(nodes.map((node) => [node.id, node]));
		const edges = diagram.edges.map((edge) => reconcileEdge(edge, nodeById, activeRelations, relationById));
		if (sameNodeLinks(diagram.nodes, nodes) && sameEdgeLinks(diagram.edges, edges)) return [];
		const version = diagram.version + 1;
		return [{
			before: diagram,
			after: {
				...diagram,
				nodes,
				edges,
				version,
				updatedAt: timestamp,
				versions: [...(diagram.versions ?? []), {
					version,
					timestamp,
					addedNodeIds: [],
					addedEdgeIds: [],
					removedNodeIds: [],
					removedEdgeIds: [],
				}],
			},
		}];
	});
}

function buildEntityLabelIndex(entities: Entity[]): Map<string, Entity[]> {
	const index = new Map<string, Entity[]>();
	for (const entity of entities) {
		for (const label of [entity.name, ...entity.aliases]) {
			const key = normalizeKnowledgeLabel(label);
			if (!key) continue;
			const matches = index.get(key) ?? [];
			if (!matches.some((item) => item.id === entity.id)) matches.push(entity);
			index.set(key, matches);
		}
	}
	return index;
}

function reconcileNode(node: DiagramNode, entityById: Map<string, Entity>, entitiesByLabel: Map<string, Entity[]>): DiagramNode {
	if (node.entityId && entityById.has(node.entityId)) return node;
	const matches = entitiesByLabel.get(normalizeKnowledgeLabel(node.label)) ?? [];
	const entityId = matches.length === 1 ? matches[0].id : undefined;
	return entityId === node.entityId ? node : { ...node, entityId };
}

function reconcileEdge(
	edge: DiagramEdge,
	nodeById: Map<string, DiagramNode>,
	relations: Relation[],
	relationById: Map<string, Relation>,
): DiagramEdge {
	const sourceEntityId = nodeById.get(edge.source)?.entityId;
	const targetEntityId = nodeById.get(edge.target)?.entityId;
	const existing = edge.relationId ? relationById.get(edge.relationId) : undefined;
	if (existing && (!sourceEntityId || !targetEntityId || (existing.sourceEntityId === sourceEntityId && existing.targetEntityId === targetEntityId))) return edge;
	if (!sourceEntityId || !targetEntityId) return edge.relationId ? { ...edge, relationId: undefined } : edge;

	const endpointMatches = relations.filter((relation) => relation.sourceEntityId === sourceEntityId && relation.targetEntityId === targetEntityId);
	const edgeLabel = normalizeKnowledgeLabel(edge.label ?? "");
	const labelMatches = edgeLabel
		? endpointMatches.filter((relation) => relationLabelMatches(edgeLabel, relation))
		: [];
	const match = labelMatches.length === 1 ? labelMatches[0] : endpointMatches.length === 1 ? endpointMatches[0] : undefined;
	return match?.id === edge.relationId ? edge : { ...edge, relationId: match?.id };
}

function relationLabelMatches(edgeLabel: string, relation: Relation): boolean {
	const type = normalizeKnowledgeLabel(relation.type);
	return edgeLabel === type || edgeLabel.includes(type) || type.includes(edgeLabel);
}

function sameNodeLinks(before: DiagramNode[], after: DiagramNode[]): boolean {
	return before.length === after.length && before.every((node, index) => node.entityId === after[index]?.entityId);
}

function sameEdgeLinks(before: DiagramEdge[], after: DiagramEdge[]): boolean {
	return before.length === after.length && before.every((edge, index) => edge.relationId === after[index]?.relationId);
}

export function normalizeKnowledgeLabel(value: string): string {
	return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s_.:/\\-]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ");
}
