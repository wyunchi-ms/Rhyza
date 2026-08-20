import { useEffect } from "react";
import { useAppStore } from "../store";

const reconciliationDelayMs = 800;
const fullReconciliationIntervalMs = 5 * 60_000;

export function useKnowledgeReconciliation(): void {
	const entities = useAppStore((state) => state.entities);
	const relations = useAppStore((state) => state.relations);
	const diagrams = useAppStore((state) => state.diagrams);
	const reconcileKnowledge = useAppStore((state) => state.reconcileKnowledge);

	useEffect(() => {
		const timeout = window.setTimeout(reconcileKnowledge, reconciliationDelayMs);
		return () => window.clearTimeout(timeout);
	}, [entities, relations, diagrams, reconcileKnowledge]);

	useEffect(() => {
		const interval = window.setInterval(reconcileKnowledge, fullReconciliationIntervalMs);
		return () => window.clearInterval(interval);
	}, [reconcileKnowledge]);
}
