import { useSyncExternalStore } from "react";
import { createCacheClock } from "../utils/cacheClock";

const clock = createCacheClock({
	now: Date.now,
	visible: () => document.visibilityState !== "hidden",
	start: (tick) => {
		const timer = window.setInterval(tick, 15_000);
		return () => window.clearInterval(timer);
	},
	onWake: (wake) => {
		window.addEventListener("focus", wake);
		window.addEventListener("pageshow", wake);
		document.addEventListener("visibilitychange", wake);
		return () => {
			window.removeEventListener("focus", wake);
			window.removeEventListener("pageshow", wake);
			document.removeEventListener("visibilitychange", wake);
		};
	},
});

export const refreshCacheClock = clock.refresh;
export function useCacheClock() {
	return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}
