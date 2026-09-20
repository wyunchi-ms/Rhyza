export interface PerformanceTimingAggregate {
	count: number;
	totalMs: number;
	maxMs: number;
	over16Ms?: number;
	over50Ms?: number;
	over100Ms?: number;
	totalBytes?: number;
	maxBytes?: number;
}

const timings = new Map<string, PerformanceTimingAggregate>();

/** Adds a cheap in-memory timing sample. Samples are flushed by the diagnostics loop. */
export function recordPerformanceTiming(name: string, durationMs: number, bytes?: number): void {
	if (!Number.isFinite(durationMs) || durationMs < 0) return;
	const current = timings.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
	current.count += 1;
	current.totalMs += durationMs;
	current.maxMs = Math.max(current.maxMs, durationMs);
	current.over16Ms = (current.over16Ms ?? 0) + Number(durationMs > 16);
	current.over50Ms = (current.over50Ms ?? 0) + Number(durationMs > 50);
	current.over100Ms = (current.over100Ms ?? 0) + Number(durationMs > 100);
	if (bytes !== undefined && Number.isFinite(bytes) && bytes >= 0) {
		current.totalBytes = (current.totalBytes ?? 0) + bytes;
		current.maxBytes = Math.max(current.maxBytes ?? 0, bytes);
	}
	timings.set(name, current);
}

export function measurePerformance<T>(name: string, action: () => T): T {
	const startedAt = performance.now();
	try {
		return action();
	} finally {
		recordPerformanceTiming(name, performance.now() - startedAt);
	}
}

export function drainPerformanceTimings(): Record<string, PerformanceTimingAggregate> {
	const snapshot = Object.fromEntries(
		[...timings].map(([name, timing]) => [
			name,
			{
				...timing,
				totalMs: Math.round(timing.totalMs * 10) / 10,
				maxMs: Math.round(timing.maxMs * 10) / 10,
			},
		]),
	);
	timings.clear();
	return snapshot;
}
