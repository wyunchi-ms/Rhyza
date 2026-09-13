import type { SessionNode, Turn } from "../types";
import { resolveGraphHistory } from "./conversationGraph";

export function buildTurnSessionMap(turns: Turn[], sessions: SessionNode[] = []): Map<string, string> {
	turns = resolveGraphHistory(sessions, turns);
	const byId = new Map(turns.map((turn) => [turn.id, turn]));
	return new Map(turns.map((turn) => {
		const id = turn.id;
		const seen = new Set<string>();
		while (turn.sourceTurnId && !seen.has(turn.id)) {
			seen.add(turn.id);
			const source = byId.get(turn.sourceTurnId);
			if (!source) break;
			turn = source;
		}
		return [id, turn.sessionId];
	}));
}

export interface VisibleTurnBox {
	sessionId: string;
	top: number;
	bottom: number;
}

export function sessionAtViewportAnchor(
	turns: VisibleTurnBox[],
	viewportTop: number,
	viewportBottom: number,
): string | null {
	return turnAtViewportAnchor(turns, viewportTop, viewportBottom)?.sessionId ?? null;
}

/** Use the middle of the viewport; in a gap choose the closest bubble edge. */
export function turnAtViewportAnchor<T extends { top: number; bottom: number }>(
	turns: T[], viewportTop: number, viewportBottom: number,
): T | null {
	if (viewportBottom <= viewportTop) return null;
	const visible = turns.filter((turn) => turn.bottom > viewportTop && turn.top < viewportBottom);
	if (visible.length === 0) return null;
	const anchor = (viewportTop + viewportBottom) / 2;
	const containingAnchor = visible.find((turn) => turn.top <= anchor && turn.bottom > anchor);
	if (containingAnchor) return containingAnchor;
	const distance = (turn: T) => Math.max(turn.top - anchor, anchor - turn.bottom, 0);
	return visible.reduce((nearest, turn) => {
		return distance(turn) < distance(nearest) ? turn : nearest;
	});
}

export interface ReadingTurnBox {
	turnId: string;
	role: Turn["role"];
	top: number;
	bottom: number;
}

/** A central reading band gives short questions time to remain selected.
 * The wider exit band prevents tiny reversals at its boundary from flickering. */
export function turnAtViewportRegion<T extends ReadingTurnBox>(
	turns: T[], viewportTop: number, viewportBottom: number,
	currentTurnId: string | null, direction: -1 | 0 | 1,
): T | null {
	const height = viewportBottom - viewportTop;
	if (height <= 0) return null;
	const visible = turns.filter((turn) => turn.bottom > viewportTop && turn.top < viewportBottom);
	const middle = (viewportTop + viewportBottom) / 2;
	const halfBand = Math.min(height * 0.15, 100);
	const exitPadding = Math.min(height * 0.04, 24);
	const overlaps = (turn: T, padding = 0) =>
		turn.bottom > middle - halfBand - padding && turn.top < middle + halfBand + padding;
	const currentUser = visible.find((turn) => turn.turnId === currentTurnId && turn.role === "user");
	if (currentUser && overlaps(currentUser, exitPadding)) return currentUser;
	const inBand = visible.filter((turn) => overlaps(turn));
	const users = inBand.filter((turn) => turn.role === "user");
	const candidates = users.length ? users : inBand;
	if (!candidates.length || direction === 0) {
		return turnAtViewportAnchor(candidates.length ? candidates : visible, viewportTop, viewportBottom);
	}
	// Advance toward the incoming content, including when several short messages
	// fit in the band. Input follows transcript order.
	return direction > 0 ? candidates[candidates.length - 1] : candidates[0];
}
