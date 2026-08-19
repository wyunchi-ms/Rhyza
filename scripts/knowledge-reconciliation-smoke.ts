import assert from "node:assert/strict";
import type { Diagram, Entity, Relation } from "../src/types/index.js";
import { reconcileKnowledgeGraph } from "../src/utils/knowledgeReconciliation.js";

const entities: Entity[] = [
	{ id: "entity-runtime", name: "Web PubSub Runtime", aliases: ["runtime"], type: "Component", summary: "", content: "", confidence: "confirmed", sourceRefs: [], version: 1, updatedAt: "2026-01-01" },
	{ id: "entity-handler", name: "Customer Event Handler", aliases: ["event handler"], type: "Component", summary: "", content: "", confidence: "confirmed", sourceRefs: [], version: 1, updatedAt: "2026-01-01" },
];
const relations: Relation[] = [
	{ id: "relation-calls", sourceEntityId: "entity-runtime", targetEntityId: "entity-handler", type: "calls", description: "", confidence: "confirmed", sourceRefs: [], version: 1 },
];
const diagram: Diagram = {
	id: "diagram-flow",
	name: "Request flow",
	type: "sequence",
	nodes: [
		{ id: "node-runtime", label: "Runtime" },
		{ id: "node-handler", label: "Customer Event Handler" },
	],
	edges: [{ id: "edge-call", source: "node-runtime", target: "node-handler", label: "calls" }],
	mermaidSource: "sequenceDiagram\nRuntime->>Handler: calls",
	version: 1,
	versions: [],
	updatedAt: "2026-01-01",
};

const result = reconcileKnowledgeGraph(entities, relations, [diagram], "2026-01-02");
assert.equal(result.length, 1);
assert.equal(result[0].after.nodes[0].entityId, "entity-runtime");
assert.equal(result[0].after.nodes[1].entityId, "entity-handler");
assert.equal(result[0].after.edges[0].relationId, "relation-calls");
assert.equal(reconcileKnowledgeGraph(entities, relations, [result[0].after], "2026-01-03").length, 0, "reconciliation must be idempotent");

const ambiguousEntities = [...entities, { ...entities[0], id: "entity-runtime-2", name: "Runtime", aliases: [] }];
const ambiguous = reconcileKnowledgeGraph(ambiguousEntities, relations, [{ ...diagram, nodes: [{ id: "node-runtime", label: "Runtime" }], edges: [] }], "2026-01-02");
assert.equal(ambiguous.length, 0, "ambiguous labels must not be linked automatically");

console.log("knowledge reconciliation smoke passed");
