import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import type { Turn } from "../types";
import { buildTurnSessionMap, sessionAtViewportAnchor } from "../utils/sessionVisibility";

/** Coordinates the conversation viewport, keyboard cursor, and tree viewport marker. */
export function useConversationNavigation(turns: Turn[], activeSessionId: string | null) {
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const [keyboardTurnId, setKeyboardTurnId] = useState<string | null>(null);
	const sessionTurns = useMemo(() => turns.filter((turn) => turn.sessionId === activeSessionId), [turns, activeSessionId]);
	const turnSessionMap = useMemo(() => buildTurnSessionMap(turns), [turns]);

	useEffect(() => { useAppStore.getState().setVisibleSession(activeSessionId); }, [activeSessionId]);
	useEffect(() => trackVisibleSession(scrollContainerRef.current), [activeSessionId, sessionTurns.length, turnSessionMap]);
	useEffect(() => scrollToInitialTurn(scrollContainerRef.current), [activeSessionId]);
	useEffect(() => {
		const focusTurn = (event: Event) => {
			const turnId = (event as CustomEvent<{ turnId?: string }>).detail?.turnId;
			if (!turnId) return;
			const turn = document.getElementById(`turn-${turnId}`);
			if (!turn) return;
			turn.scrollIntoView({ behavior: "smooth", block: "center" });
			setKeyboardTurnId(turnId);
			window.sessionStorage.removeItem("rhyza-focus-turn");
		};
		window.addEventListener("rhyza:focus-turn", focusTurn);
		return () => window.removeEventListener("rhyza:focus-turn", focusTurn);
	}, []);

	const moveKeyboardTurn = useCallback((direction: -1 | 1) => {
		if (sessionTurns.length === 0) return;
		const currentIndex = keyboardTurnId
			? sessionTurns.findIndex((turn) => turn.id === keyboardTurnId)
			: direction < 0 ? sessionTurns.length : -1;
		const nextTurn = sessionTurns[Math.max(0, Math.min(sessionTurns.length - 1, currentIndex + direction))];
		if (!nextTurn) return;
		setKeyboardTurnId(nextTurn.id);
		document.getElementById(`turn-${nextTurn.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
	}, [keyboardTurnId, sessionTurns]);

	return { scrollContainerRef, keyboardTurnId, setKeyboardTurnId, sessionTurns, turnSessionMap, moveKeyboardTurn };
}

function trackVisibleSession(container: HTMLDivElement | null): () => void {
	if (!container) return () => undefined;
	let frame = 0;
	const update = () => {
		frame = 0;
		const viewport = container.getBoundingClientRect();
		const boxes = [...container.querySelectorAll<HTMLElement>("[data-session-node-id]")]
			.map((element) => {
				const bounds = element.getBoundingClientRect();
				return { sessionId: element.dataset.sessionNodeId ?? "", top: bounds.top, bottom: bounds.bottom };
			})
			.filter((item) => item.sessionId);
		const sessionId = sessionAtViewportAnchor(boxes, viewport.top, viewport.bottom);
		if (sessionId && useAppStore.getState().visibleSessionId !== sessionId) useAppStore.getState().setVisibleSession(sessionId);
	};
	const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
	container.addEventListener("scroll", schedule, { passive: true });
	const initialFrame = window.requestAnimationFrame(update);
	return () => {
		container.removeEventListener("scroll", schedule);
		window.cancelAnimationFrame(initialFrame);
		if (frame) window.cancelAnimationFrame(frame);
	};
}

function scrollToInitialTurn(container: HTMLDivElement | null): () => void {
	const frame = window.requestAnimationFrame(() => {
		const pendingTurnId = window.sessionStorage.getItem("rhyza-focus-turn");
		const pendingTurn = pendingTurnId ? document.getElementById(`turn-${pendingTurnId}`) : null;
		if (pendingTurn) {
			pendingTurn.scrollIntoView({ behavior: "smooth", block: "center" });
			window.sessionStorage.removeItem("rhyza-focus-turn");
		} else if (container) {
			container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
		}
	});
	return () => window.cancelAnimationFrame(frame);
}
