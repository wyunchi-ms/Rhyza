import { useCallback, useEffect, useRef, type RefObject } from "react";
import { inHoverRegion } from "../utils/hoverRegion";

export function useHoverRetention(open: boolean, source: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, close: () => void, pinned = false) {
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const retain = useCallback(() => { clearTimeout(timer.current); timer.current = undefined; }, []);
	const leave = useCallback(() => {
		if (pinned || timer.current) return;
		timer.current = setTimeout(() => { timer.current = undefined; close(); }, 220);
	}, [pinned, close]);
	useEffect(() => {
		if (!open) { retain(); return; }
		const move = (event: MouseEvent) => {
			if (!source.current || !panel.current) return;
			if (inHoverRegion({ x: event.clientX, y: event.clientY }, source.current.getBoundingClientRect(), panel.current.getBoundingClientRect())) retain();
			else leave();
		};
		document.addEventListener("mousemove", move);
		return () => { document.removeEventListener("mousemove", move); retain(); };
	}, [open, source, panel, leave, retain]);
	return { retain, leave };
}
