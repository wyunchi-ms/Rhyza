import { useCallback, useState } from "react";
import type { Diagram, Entity } from "../types";
import type { KnowledgePreview } from "../components/KnowledgePreviewDialog";

export function useKnowledgePreview(entities: Entity[], diagrams: Diagram[]) {
	const [preview, setPreview] = useState<KnowledgePreview | null>(null);
	const openEntityById = useCallback((id: string) => {
		const entity = entities.find((item) => item.id === id && !item.deletedAt);
		if (entity) setPreview({ kind: "entity", item: entity });
	}, [entities]);
	const openDiagramById = useCallback((id: string) => {
		const diagram = diagrams.find((item) => item.id === id && !item.deletedAt);
		if (diagram) setPreview({ kind: "diagram", item: diagram });
	}, [diagrams]);
	const openEntity = useCallback((entity: Entity) => setPreview({ kind: "entity", item: entity }), []);
	const openDiagram = useCallback((diagram: Diagram) => setPreview({ kind: "diagram", item: diagram }), []);
	const closePreview = useCallback(() => setPreview(null), []);
	return { preview, openEntityById, openDiagramById, openEntity, openDiagram, closePreview };
}
