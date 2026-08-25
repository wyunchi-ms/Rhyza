import type { Turn } from "../types";

export function buildTurnSessionMap(turns: Turn[]): Map<string, string> {
	const ownerByTurnId = new Map(turns.map((turn) => [turn.id, turn.sessionId]));
	return new Map(turns.map((turn) => [
		turn.id,
		(turn.sourceTurnId && ownerByTurnId.get(turn.sourceTurnId)) || turn.sessionId,
	]));
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
	const visible = turns.filter((turn) => turn.bottom > viewportTop && turn.top < viewportBottom);
	if (visible.length === 0) return null;
	const anchor = viewportTop + (viewportBottom - viewportTop) * 0.35;
	const containingAnchor = visible.find((turn) => turn.top <= anchor && turn.bottom >= anchor);
	if (containingAnchor) return containingAnchor.sessionId;
	return visible.reduce((nearest, turn) => {
		const distance = Math.abs((turn.top + turn.bottom) / 2 - anchor);
		return distance < nearest.distance ? { sessionId: turn.sessionId, distance } : nearest;
	}, { sessionId: visible[0].sessionId, distance: Number.POSITIVE_INFINITY }).sessionId;
}
