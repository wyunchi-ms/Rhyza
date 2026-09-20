import { recordPerformanceTiming } from "./performanceMarks";

type InputKind = "text" | "ime" | "paste";
type Sample = { kind: InputKind; startedAt: number; handledAt: number };

export function inputEventStart(timestamp: number, now: number, timeOrigin: number): number {
	const normalized = timestamp > timeOrigin ? timestamp - timeOrigin : timestamp;
	return Number.isFinite(normalized) && normalized > 0 && normalized <= now ? normalized : now;
}

type InputDiagnosticsClock = {
	now: () => number;
	timeOrigin: number;
	visible: () => boolean;
	afterFrame: (callback: () => void) => () => void;
};

/** Contains only timestamps and fixed categories, never draft text or key values. */
export function createInputDiagnostics(clock: InputDiagnosticsClock) {
	let pending: Sample[] = [];
	const scheduled = new Map<Sample[], () => void>();
	const record = (sample: Sample, stage: string, duration: number) => {
		recordPerformanceTiming(`composer-input-${sample.kind}-${stage}`, duration);
	};
	return {
		begin(event: { timeStamp: number; isComposing?: boolean; inputType?: string }) {
			if (!clock.visible()) return () => undefined;
			const handledAt = clock.now();
			const sample: Sample = {
				kind:
					event.isComposing || event.inputType?.includes("Composition")
						? "ime"
						: event.inputType === "insertFromPaste"
							? "paste"
							: "text",
				startedAt: inputEventStart(event.timeStamp, handledAt, clock.timeOrigin),
				handledAt,
			};
			record(sample, "queue", handledAt - sample.startedAt);
			// Keep diagnostics bounded even if updates never commit.
			if (pending.length < 32) pending.push(sample);
			else recordPerformanceTiming("composer-input-sample-dropped", 0);
			let finished = false;
			return () => {
				if (finished) return;
				finished = true;
				record(sample, "handler", clock.now() - handledAt);
			};
		},
		commit() {
			if (!pending.length) return;
			const samples = pending;
			pending = [];
			if (!clock.visible()) return;
			const committedAt = clock.now();
			for (const sample of samples) {
				record(sample, "to-commit", committedAt - sample.handledAt);
			}
			if (scheduled.size >= 32) {
				recordPerformanceTiming("composer-input-frame-sample-dropped", 0);
				return;
			}
			scheduled.set(
				samples,
				clock.afterFrame(() => {
					scheduled.delete(samples);
					if (!clock.visible()) return;
					const finishedAt = clock.now();
					for (const sample of samples) {
						record(sample, "after-frame", finishedAt - sample.startedAt);
					}
				}),
			);
		},
		reset() {
			pending = [];
			for (const cancel of scheduled.values()) cancel();
			scheduled.clear();
		},
	};
}

export function createBrowserInputDiagnostics() {
	return createInputDiagnostics({
		now: () => performance.now(),
		timeOrigin: performance.timeOrigin,
		visible: () => document.visibilityState === "visible",
		afterFrame: (callback) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			// Approximation only: rAF runs before paint, a following task gives the
			// browser a rendering opportunity. This is not an INP measurement.
			const frame = requestAnimationFrame(() => {
				timer = setTimeout(callback, 0);
			});
			return () => {
				cancelAnimationFrame(frame);
				clearTimeout(timer);
			};
		},
	});
}
