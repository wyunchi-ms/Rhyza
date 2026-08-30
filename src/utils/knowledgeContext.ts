import type { SourceSearchHit } from "../shared/ipc";
import type { Diagram, Entity, Relation } from "../types";

export function buildKnowledgeContext(prompt: string, entities: Entity[], relations: Relation[], diagrams: Diagram[], sourceHits: SourceSearchHit[]): string {
	const lowerPrompt = prompt.toLocaleLowerCase();
	const terms = lowerPrompt.split(/[^\p{L}\p{N}_.-]+/u).filter((term) => term.length >= 2);
	const mentioned = getMentionedKnowledgeIds(prompt);
	const rankedEntities = entities.filter((entity) => !entity.deletedAt).map((entity) => {
		const names = [entity.name, ...entity.aliases].map((name) => name.toLocaleLowerCase());
		const exact = names.some((name) => lowerPrompt.includes(name));
		const searchable = `${entity.name} ${entity.aliases.join(" ")} ${entity.type} ${entity.summary}`.toLocaleLowerCase();
		const overlap = terms.filter((term) => searchable.includes(term)).length;
		return { entity, score: (mentioned.entityIds.has(entity.id) ? 1000 : 0) + (exact ? 100 : 0) + overlap * 10 };
	}).filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 8);
	const selectedIds = new Set(rankedEntities.map(({ entity }) => entity.id));
	const relationLines = relations.filter((relation) => !relation.deletedAt && (selectedIds.has(relation.sourceEntityId) || selectedIds.has(relation.targetEntityId))).slice(0, 12).map((relation) => `${relation.sourceEntityId} -[${relation.type}]-> ${relation.targetEntityId}`);
	for (const relation of relations.filter((item) => !item.deletedAt)) {
		if (selectedIds.has(relation.sourceEntityId)) selectedIds.add(relation.targetEntityId);
		if (selectedIds.has(relation.targetEntityId)) selectedIds.add(relation.sourceEntityId);
	}
	const entityLines = rankedEntities.map(({ entity }) => {
		const content = mentioned.entityIds.has(entity.id) && entity.content.trim() ? `\nContent:\n${entity.content.trim().slice(0, 12_000)}` : "";
		return `${entity.id} | ${entity.name} | ${entity.type} | ${entity.confidence}\nSummary: ${entity.summary}${content}`;
	});
	const diagramLines = diagrams.filter((diagram) => !diagram.deletedAt && (mentioned.diagramIds.has(diagram.id) || lowerPrompt.includes(diagram.name.toLocaleLowerCase()) || diagram.nodes.some((node) => node.entityId && selectedIds.has(node.entityId)))).slice(0, 5).map((diagram) => {
		const structure = `Nodes: ${diagram.nodes.map((node) => `${node.label}${node.entityId ? ` [entity:${node.entityId}]` : ""}`).slice(0, 24).join(", ")}\nEdges: ${diagram.edges.map((edge) => `${edge.source}->${edge.target}${edge.label ? ` (${edge.label})` : ""}`).slice(0, 36).join(", ")}`;
		const diagramSource = mentioned.diagramIds.has(diagram.id)
			? diagram.archifySource?.trim()
				? `\nArchify source:\n${diagram.archifySource.trim().slice(0, 40_000)}`
				: diagram.mermaidSource.trim() ? `\nMermaid source:\n${diagram.mermaidSource.trim().slice(0, 12_000)}` : ""
			: "";
		return `${diagram.id} | ${diagram.name} | ${diagram.type} | v${diagram.version}\n${structure}${diagramSource}`;
	});
	const sourceLines = sourceHits.map((hit) => `${hit.path}:${hit.line} | ${hit.preview}`);
	return [`Entities:\n${entityLines.join("\n\n") || "None"}`, `Relations:\n${relationLines.join("\n") || "None"}`, `Diagrams:\n${diagramLines.join("\n\n") || "None"}`, `Source matches:\n${sourceLines.join("\n") || "None"}`].join("\n\n");
}

function getMentionedKnowledgeIds(prompt: string): { entityIds: Set<string>; diagramIds: Set<string> } {
	const entityIds = new Set<string>();
	const diagramIds = new Set<string>();
	for (const match of prompt.matchAll(/#knowledge\/(entity|diagram)\/([^\s)]+)/g)) {
		let id: string;
		try { id = decodeURIComponent(match[2]); }
		catch { continue; }
		if (match[1] === "entity") entityIds.add(id);
		else diagramIds.add(id);
	}
	return { entityIds, diagramIds };
}

export function summarizeToolTarget(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of ["path", "pattern", "command", "query", "file", "directory"]) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim().replace(/\s+/g, " ").slice(0, 160);
	}
	return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
