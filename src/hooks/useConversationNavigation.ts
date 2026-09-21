import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useConversationFocus } from "../store/conversationFocus";
import type { SessionNode, Turn } from "../types";
import { buildTurnSessionMap, turnAtViewportRegion } from "../utils/sessionVisibility";
import { announceBranchSwitchEnd } from "../utils/branchSwitch";
import { recordPerformanceTiming } from "../utils/performanceMarks";

/** Coordinates the conversation viewport, keyboard cursor, and tree viewport marker. */
export function useConversationNavigation(
	turns: Turn[],
	activeSessionId: string | null,
	sessions: SessionNode[],
) {
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const focus = useConversationFocus();
	const focusedTurnId = focus.sessionId === activeSessionId ? focus.turnId : null;
	const setFocusedTurnId = useCallback(
		(id: string | null) => {
			useConversationFocus.getState().setFocus(activeSessionId, id);
		},
		[activeSessionId],
	);
	const getFocusedTurnId = useCallback(() => {
		const current = useConversationFocus.getState();
		return current.sessionId === activeSessionId ? current.turnId : null;
	}, [activeSessionId]);
	const sessionTurns = useMemo(
		() => turns.filter((turn) => turn.sessionId === activeSessionId),
		[turns, activeSessionId],
	);
	const turnSessionMap = useMemo(() => buildTurnSessionMap(turns, sessions), [turns, sessions]);
	const turnIds = JSON.stringify(sessionTurns.map((turn) => turn.id));
	const readingPosition = useRef<{ scrollTop: number; sourceTurnId: string | null } | null>(null);
	const preserveReadingPosition = useCallback(() => {
		const container = scrollContainerRef.current;
		if (!container) return;
		const focusedTurn = sessionTurns.find((turn) => turn.id === getFocusedTurnId());
		readingPosition.current = {
			scrollTop: container.scrollTop,
			sourceTurnId: focusedTurn?.sourceTurnId ?? focusedTurn?.id ?? null,
		};
	}, [getFocusedTurnId, sessionTurns]);

	useEffect(
		() => trackVisibleTurn(scrollContainerRef.current, setFocusedTurnId, getFocusedTurnId),
		[setFocusedTurnId, getFocusedTurnId, turnIds],
	);
	// Position a newly selected branch before the browser paints it. Waiting for an
	// effect/frame exposes the first turn and lets the container's smooth-scroll CSS
	// animate through the entire transcript.
	const lastSessionTurnId = sessionTurns[sessionTurns.length - 1]?.id;
	useLayoutEffect(() => {
		if (readingPosition.current) return;
		return scrollToInitialTurn(scrollContainerRef.current);
	}, [activeSessionId, lastSessionTurnId]);
	useLayoutEffect(() => {
		const saved = readingPosition.current;
		const container = scrollContainerRef.current;
		if (!saved || !container) return;
		readingPosition.current = null;
		container.classList.add("is-positioning");
		container.scrollTop = saved.scrollTop;
		container.classList.remove("is-positioning");
		const retainedTurn = sessionTurns.find(
			(turn) => (turn.sourceTurnId ?? turn.id) === saved.sourceTurnId,
		);
		setFocusedTurnId(retainedTurn?.id ?? null);
	});
	useEffect(() => {
		const focusTurn = (event: Event) => {
			const turnId = (event as CustomEvent<{ turnId?: string }>).detail?.turnId;
			if (!turnId) return;
			const turn = document.getElementById(`turn-${turnId}`);
			if (!turn) return;
			turn.scrollIntoView({ behavior: "smooth", block: "center" });
			setFocusedTurnId(turnId);
			window.sessionStorage.removeItem("rhyza-focus-turn");
		};
		window.addEventListener("rhyza:focus-turn", focusTurn);
		return () => window.removeEventListener("rhyza:focus-turn", focusTurn);
	}, [setFocusedTurnId]);

	const moveKeyboardTurn = useCallback(
		(direction: -1 | 1) => {
			if (sessionTurns.length === 0) return;
			const currentIndex = focusedTurnId
				? sessionTurns.findIndex((turn) => turn.id === focusedTurnId)
				: direction < 0
					? sessionTurns.length
					: -1;
			const nextTurn =
				sessionTurns[Math.max(0, Math.min(sessionTurns.length - 1, currentIndex + direction))];
			if (!nextTurn) return;
			setFocusedTurnId(nextTurn.id);
			document
				.getElementById(`turn-${nextTurn.id}`)
				?.scrollIntoView({ behavior: "smooth", block: "center" });
		},
		[focusedTurnId, sessionTurns, setFocusedTurnId],
	);

	return {
		scrollContainerRef,
		focusedTurnId,
		setFocusedTurnId,
		sessionTurns,
		turnSessionMap,
		moveKeyboardTurn,
		preserveReadingPosition,
	};
}

export function trackVisibleTurn(
	container: HTMLDivElement | null,
	onFocus: (id: string | null) => void,
	getFocusedTurnId: () => string | null,
): () => void {
	if (!container) return () => undefined;
	let frame = 0;
	let lastScrollTop = container.scrollTop;
	let direction: -1 | 0 | 1 = 0;
	const update = () => {
		frame = 0;
		const delta = container.scrollTop - lastScrollTop;
		if (Math.abs(delta) >= 1) {
			direction = delta > 0 ? 1 : -1;
			lastScrollTop = container.scrollTop;
		}
		const viewport = container.getBoundingClientRect();
		const boxes = [...container.querySelectorAll<HTMLElement>("[data-turn-id]")]
			.map((element) => {
				const bounds = (element.querySelector(".turn-body") ?? element).getBoundingClientRect();
				return {
					turnId: element.dataset.turnId ?? "",
					role: element.classList.contains("is-user") ? ("user" as const) : ("assistant" as const),
					top: bounds.top,
					bottom: bounds.bottom,
				};
			})
			.filter((item) => item.turnId);
		onFocus(
			turnAtViewportRegion(boxes, viewport.top, viewport.bottom, getFocusedTurnId(), direction)
				?.turnId ?? null,
		);
	};
	const schedule = () => {
		if (!frame) frame = window.requestAnimationFrame(update);
	};
	container.addEventListener("scroll", schedule, { passive: true });
	window.addEventListener("resize", schedule);
	const observer = new ResizeObserver(schedule);
	observer.observe(container);
	for (const element of container.querySelectorAll<HTMLElement>("[data-turn-id], .turn-body"))
		observer.observe(element);
	schedule();
	return () => {
		container.removeEventListener("scroll", schedule);
		window.removeEventListener("resize", schedule);
		observer.disconnect();
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
