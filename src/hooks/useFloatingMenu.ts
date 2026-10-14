import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { floatingPosition } from "../utils/floatingPosition";

export function useFloatingMenu(
	anchor: { x: number; y: number },
	focus = true,
	placement: "at" | "above" | "above-center" = "at",
) {
	const ref = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const measure = () => {
			const bounds = element.getBoundingClientRect();
			const target =
				placement === "at"
					? anchor
					: {
							x: placement === "above-center" ? anchor.x - bounds.width / 2 : anchor.x,
							y: anchor.y - bounds.height - 8,
						};
			setPosition(floatingPosition(target, bounds, { width: innerWidth, height: innerHeight }));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		if (focus)
			element.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
			if (
				focus &&
				(element.contains(document.activeElement) || document.activeElement === document.body)
			) {
				if (previous?.isConnected) previous.focus({ preventScroll: true });
			}
		};
	}, [anchor.x, anchor.y, focus, placement]);
	return { ref, position };
}

export function navigateMenu(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
	if (event.key === "Escape" || event.key === "Tab") {
		event.preventDefault();
		event.stopPropagation();
		onClose();
		return;
	}
	const buttons = [
		...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
	];
	if (!buttons.length) return;
	const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
	const next =
		event.key === "ArrowDown"
			? (index + 1) % buttons.length
			: event.key === "ArrowUp"
				? (index + buttons.length - 1) % buttons.length
				: event.key === "Home"
					? 0
					: event.key === "End"
						? buttons.length - 1
						: undefined;
	if (next !== undefined) {
		event.preventDefault();
		event.stopPropagation();
		buttons[next]?.focus({ preventScroll: true });
	}
}
