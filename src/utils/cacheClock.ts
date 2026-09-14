/** One clock for all mounted cache indicators; no persisted status or per-node timers. */
export function createCacheClock(environment: {
	now: () => number;
	visible: () => boolean;
	start: (tick: () => void) => () => void;
	onWake: (wake: () => void) => () => void;
}) {
	let now = environment.now();
	const listeners = new Set<() => void>();
	let stopTimer: (() => void) | undefined;
	let stopWake: (() => void) | undefined;
	const refresh = () => {
		now = environment.now();
		listeners.forEach((listener) => listener());
	};
	const wake = () => {
		stopTimer?.();
		stopTimer = undefined;
		if (environment.visible()) {
			refresh();
			stopTimer = environment.start(refresh);
		}
	};
	return {
		getSnapshot: () => now,
		refresh,
		subscribe(listener: () => void) {
			listeners.add(listener);
			if (listeners.size === 1) {
				stopWake = environment.onWake(wake);
				wake();
			}
			return () => {
				listeners.delete(listener);
				if (!listeners.size) {
					stopTimer?.();
					stopWake?.();
					stopTimer = undefined;
					stopWake = undefined;
				}
			};
		},
	};
}
