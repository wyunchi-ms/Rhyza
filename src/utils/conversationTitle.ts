import type { Turn } from "../types";
import { summarize } from "./common";

export function conversationTurnTitle(turn: Pick<Turn, "content" | "summary" | "quote">): string {
	const summary = turn.summary?.trim();
	const content = turn.content.trim();
	const isExplain = (value: string) => /^explain[.!?]?$/i.test(value);
	const passage = turn.quote?.text.replace(/\s+/g, " ").trim();
	if (passage && isExplain(content) && (!summary || isExplain(summary))) {
		return summarize(`Explain: ${passage}`);
	}
	return summary || content || "Image prompt";
}
