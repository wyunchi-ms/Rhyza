import type { KnowledgeExtractionRequest, SourceSearchHit } from "../shared/ipc";
import type { Diagram, Entity, Source, SourceRef } from "../types";

export type KnowledgeInventory = Pick<KnowledgeExtractionRequest, "existingEntities" | "existingDiagrams">;

/**
 * Creates the stable, transport-safe knowledge snapshot supplied to extraction jobs.
 * Keeping this boundary centralized makes new knowledge resource types additive instead
 * of requiring every extraction caller to understand the persisted domain model.
 */
export function buildKnowledgeInventory(entities: Entity[], diagrams: Diagram[]): KnowledgeInventory {
	return {
		existingEntities: entities
			.filter((entity) => !entity.deletedAt)
			.map(({ id, name, aliases, type, summary, content, version }) => ({ id, name, aliases, type, summary, content, version })),
		existingDiagrams: diagrams
			.filter((diagram) => !diagram.deletedAt)
			.map(({ id, name, type, nodes }) => ({ id, name, type, nodeLabels: nodes.map((node) => node.label) })),
	};
}

export function sourceHitsToRefs(hits: SourceSearchHit[], sources: Source[]): SourceRef[] {
	const revisions = new Map(sources.map((source) => [source.id, source.revision]));
	return hits.map((hit) => ({
		sourceId: hit.sourceId,
		path: hit.path,
		revision: revisions.get(hit.sourceId),
		lineStart: hit.line,
		lineEnd: hit.line,
	}));
}
