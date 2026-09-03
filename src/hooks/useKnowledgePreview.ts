import { createElement, useCallback, useLayoutEffect } from "react";
import { create } from "zustand";
import { KnowledgePreviewDialog, type KnowledgePreview } from "../components/KnowledgePreviewDialog";
import { useAppStore } from "../store";
import type { Diagram, Entity } from "../types";
import { recordPerformanceTiming } from "../utils/performanceMarks";

interface KnowledgePreviewState {
	preview: KnowledgePreview | null;
	setPreview: (preview: KnowledgePreview | null) => void;
}

const useKnowledgePreviewStore = create<KnowledgePreviewState>((set) => ({
	preview: null,
	setPreview: (preview) => set({ preview }),
}));

let previewTransition: { kind: "open" | "close"; startedAt: number } | undefined;

/** Stable preview actions that do not subscribe the surrounding chat to modal state. */
export function useKnowledgePreviewActions() {
	const setPreview = useKnowledgePreviewStore((state) => state.setPreview);
	const openEntityById = useCallback((id: string) => {
		const entity = useAppStore.getState().entities.find((item) => item.id === id && !item.deletedAt);
		if (entity) openPreview(setPreview, { kind: "entity", item: entity });
	}, [setPreview]);
	const openDiagramById = useCallback((id: string) => {
		const diagram = useAppStore.getState().diagrams.find((item) => item.id === id && !item.deletedAt);
		if (diagram) openPreview(setPreview, { kind: "diagram", item: diagram });
	}, [setPreview]);
	const openEntity = useCallback((entity: Entity) => openPreview(setPreview, { kind: "entity", item: entity }), [setPreview]);
	const openDiagram = useCallback((diagram: Diagram) => openPreview(setPreview, { kind: "diagram", item: diagram }), [setPreview]);
	const closePreview = useCallback(() => {
		previewTransition = { kind: "close", startedAt: performance.now() };
		setPreview(null);
	}, [setPreview]);
	return { openEntityById, openDiagramById, openEntity, openDiagram, closePreview };
}

/** Isolates modal updates so opening/closing a preview does not rerender chat history. */
export function KnowledgePreviewHost() {
	const preview = useKnowledgePreviewStore((state) => state.preview);
	const { closePreview } = useKnowledgePreviewActions();
	useLayoutEffect(() => {
		if (!previewTransition) return;
		recordPerformanceTiming(`knowledge-preview-${previewTransition.kind}`, performance.now() - previewTransition.startedAt);
		previewTransition = undefined;
	}, [preview]);
	return preview ? createElement(KnowledgePreviewDialog, { preview, onClose: closePreview }) : null;
}

function openPreview(setPreview: KnowledgePreviewState["setPreview"], preview: KnowledgePreview): void {
	previewTransition = { kind: "open", startedAt: performance.now() };
	setPreview(preview);
}
