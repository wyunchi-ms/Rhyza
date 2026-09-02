import type { KnowledgeExtractionRequest, SourceSearchHit } from "../shared/ipc";
import type { Diagram, Entity, Source, SourceRef } from "../types";
import { rankSourceEvidence } from "../shared/source-ranking";

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
			.map(({ id, name, aliases, type, summary, content, sourceScope, version }) => ({ id, name, aliases, type, summary, content, sourceScope, version })),
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

/** Keeps durable session provenance while preferring authoritative file evidence. */
export function prioritizeKnowledgeSourceRefs(sourceRefs: SourceRef[], query: string, limit = 12): SourceRef[] {
	const unique = new Map<string, SourceRef>();
	for (const ref of sourceRefs) {
		const key = ref.path
			? [ref.sourceId, ref.path.replace(/\\/g, "/").toLocaleLowerCase(), ref.lineStart ?? "", ref.lineEnd ?? ""].join(":")
			: [ref.sessionId, ref.turnId].join(":");
		if (!unique.has(key)) unique.set(key, ref);
	}
	const sessionRefs = [...unique.values()].filter((ref) => !ref.path).slice(-2);
	const fileRefs = [...unique.values()].filter((ref): ref is SourceRef & { path: string } => Boolean(ref.path));
	const ranked = rankSourceEvidence(
		fileRefs.map((ref) => ({ ref, path: ref.path, line: ref.lineStart })),
		query,
		Math.max(0, limit - sessionRefs.length),
	).map(({ ref }) => ref);
	return [...sessionRefs, ...ranked];
}

/** General knowledge keeps conversational provenance without claiming unrelated repo files as evidence. */
export function sourceRefsForKnowledgeScope(
	scope: "workspace" | "general" | "mixed",
	turnRefs: SourceRef[],
	query: string,
): SourceRef[] {
	const eligible = scope === "general" ? turnRefs.filter((ref) => !ref.path) : turnRefs;
	return prioritizeKnowledgeSourceRefs(eligible, query);
}
