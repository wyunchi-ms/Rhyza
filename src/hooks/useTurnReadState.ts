import { useEffect, useRef } from "react";
import { useAppStore } from "../store";
import type { Turn } from "../types";
import { isTurnUnread } from "../utils/turnReadState";

export function useTurnReadState(turn: Turn, collapsed: boolean) {
	const ref = useRef<HTMLDivElement>(null);
	const unread = isTurnUnread(turn);
	useEffect(() => {
		const element = ref.current;
		if (!element || !unread || collapsed) return;
		let inView = false;
		const markRead = () => {
			if (inView && document.visibilityState === "visible" && document.hasFocus()) {
				useAppStore.getState().markTurnRead(turn.id);
			}
		};
		const observer = new IntersectionObserver((entries) => {
			const entry = entries[entries.length - 1];
			inView = entry.isIntersecting && entry.intersectionRect.height > 0;
			markRead();
		});
		observer.observe(element);
		document.addEventListener("visibilitychange", markRead);
		window.addEventListener("focus", markRead);
		return () => {
			observer.disconnect();
			document.removeEventListener("visibilitychange", markRead);
			window.removeEventListener("focus", markRead);
		};
	}, [turn.id, unread, collapsed]);
	return ref;
}
