import assert from "node:assert/strict";
import test from "node:test";
import type { Diagram, Entity, Source } from "../src/types";
import { buildKnowledgeInventory, sourceHitsToRefs } from "../src/utils/knowledgeExtraction";

const entity = (id: string, deletedAt?: string): Entity => ({
	id, name: `Entity ${id}`, aliases: [`Alias ${id}`], type: "Concept",
	summary: `Summary ${id}`, content: `Content ${id}`, confidence: "confirmed",
	sourceRefs: [], version: 2, updatedAt: "2026-01-01T00:00:00.000Z", deletedAt,
});

const diagram = (id: string, deletedAt?: string): Diagram => ({
	id, name: `Diagram ${id}`, type: "architecture",
	nodes: [{ id: `${id}-node`, label: "Runtime", type: "component" }], edges: [],
	mermaidSource: "flowchart TD\nA[Runtime]", sourceRefs: [], version: 1, versions: [],
	updatedAt: "2026-01-01T00:00:00.000Z", deletedAt,
});

test("knowledge inventory exposes active resources through one transport boundary", () => {
	const inventory = buildKnowledgeInventory([entity("active"), entity("archived", "2026-01-01")], [diagram("active"), diagram("archived", "2026-01-01")]);
	assert.deepEqual(inventory.existingEntities.map(({ id }) => id), ["active"]);
	assert.deepEqual(inventory.existingDiagrams, [{ id: "active", name: "Diagram active", type: "architecture", nodeLabels: ["Runtime"] }]);
});

test("source search hits inherit source revisions without repeated lookups", () => {
	const sources: Source[] = [{ id: "source-1", name: "Repository", path: "/repo", fileCount: 1, type: "repo", revision: "abc123", status: "indexed", indexedAt: "2026-01-01" }];
	assert.deepEqual(sourceHitsToRefs([{ sourceId: "source-1", path: "src/app.ts", line: 42, preview: "value" }], sources), [{
		sourceId: "source-1", path: "src/app.ts", revision: "abc123", lineStart: 42, lineEnd: 42,
	}]);
});
