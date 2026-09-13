import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { ReactFlowInstance } from "reactflow";
import { sessionGraphNodeSize } from "../utils/sessionGraph";

export const graphMaxZoom = 1.65;

/** Follow node changes, while letting any manual gesture interrupt the camera. */
export function useGraphFocus(flow: ReactFlowInstance | null, canvas: RefObject<HTMLDivElement | null>,
	visible: boolean, nodeId: string | undefined, position: { x: number; y: number } | undefined, reduceMotion: boolean) {
	const frame = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const opening = useRef(true);
	const cancel = useCallback(() => {
		cancelAnimationFrame(frame.current);
		clearTimeout(timer.current);
	}, []);
	const move = useCallback((maximize: boolean) => {
		cancel();
		if (!flow || !position || !canvas.current) return;
		const { width, height } = canvas.current.getBoundingClientRect();
		if (!width || !height) return;
		opening.current = false;
		const from = flow.getViewport();
		const zoom = maximize ? Math.max(0.2, Math.min(graphMaxZoom,
			(width - 32) / sessionGraphNodeSize.width, (height - 32) / sessionGraphNodeSize.height)) : from.zoom;
		const to = { x: width / 2 - (position.x + sessionGraphNodeSize.width / 2) * zoom,
			y: height / 2 - (position.y + sessionGraphNodeSize.height / 2) * zoom, zoom };
		const started = performance.now();
		const duration = reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360;
		const animate = () => {
			const progress = duration ? Math.min(1, (performance.now() - started) / duration) : 1;
			const eased = 1 - (1 - progress) ** 3;
			void flow.setViewport({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased,
				zoom: from.zoom + (to.zoom - from.zoom) * eased }, { duration: 0 });
			if (progress < 1) frame.current = requestAnimationFrame(animate);
		};
		frame.current = requestAnimationFrame(animate);
	}, [flow, canvas, position?.x, position?.y, reduceMotion, cancel]);
	useEffect(() => {
		if (!visible) { opening.current = true; cancel(); return; }
		if (!nodeId || !flow) return;
		// Let the sidebar finish opening before measuring its available area.
		if (opening.current) timer.current = setTimeout(() => move(true), 360);
		else move(false);
		return cancel;
	}, [visible, nodeId, flow, move, cancel]);
	return {
		focusActive: () => move(false),
		interrupt: () => { opening.current = false; cancel(); },
	};
}
