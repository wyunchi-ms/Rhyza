import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import type { Turn } from "../types";
import { buildTurnSessionMap, sessionAtViewportAnchor } from "../utils/sessionVisibility";
import { announceBranchSwitchEnd } from "../utils/branchSwitch";
import { recordPerformanceTiming } from "../utils/performanceMarks";

/** Coordinates the conversation viewport, keyboard cursor, and tree viewport marker. */
export function useConversationNavigation(turns: Turn[], activeSessionId: string | null) {
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const [keyboardTurnId, setKeyboardTurnId] = useState<string | null>(null);
	const sessionTurns = useMemo(() => turns.filter((turn) => turn.sessionId === activeSessionId), [turns, activeSessionId]);
	const turnSessionMap = useMemo(() => buildTurnSessionMap(turns), [turns]);

	useEffect(() => { useAppStore.getState().setVisibleSession(activeSessionId); }, [activeSessionId]);
	useEffect(() => trackVisibleSession(scrollContainerRef.current), [activeSessionId, sessionTurns.length, turnSessionMap]);
	// Position a newly selected branch before the browser paints it. Waiting for an
	// effect/frame exposes the first turn and lets the container's smooth-scroll CSS
	// animate through the entire transcript.
	const lastSessionTurnId = sessionTurns[sessionTurns.length - 1]?.id;
	useLayoutEffect(
		() => scrollToInitialTurn(scrollContainerRef.current),
		[activeSessionId, lastSessionTurnId],
	);
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
	if (!container) return () => undefined;
	container.classList.add("is-positioning");
	const position = () => {
		const startedAt = performance.now();
		const pendingTurnId = window.sessionStorage.getItem("rhyza-focus-turn");
		const pendingTurn = pendingTurnId ? document.getElementById(`turn-${pendingTurnId}`) : null;
		if (pendingTurn) {
			pendingTurn.scrollIntoView({ behavior: "auto", block: "center" });
		} else {
			container.scrollTop = container.scrollHeight - container.clientHeight;
		}
		recordPerformanceTiming("branch-scroll-position", performance.now() - startedAt);
	};
	position();
	const frame = window.requestAnimationFrame(() => {
		position();
		window.sessionStorage.removeItem("rhyza-focus-turn");
		container.classList.remove("is-positioning");
		announceBranchSwitchEnd();
	});
	return () => {
		window.cancelAnimationFrame(frame);
		container.classList.remove("is-positioning");
	};
}
