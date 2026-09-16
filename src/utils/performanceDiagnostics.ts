import { getKnowbranchBridge } from "../hooks/useKnowbranchBridge";
import { useAppStore } from "../store";
import { isTurnActive } from "./sessionRuntime";
import {
	branchSwitchEndEvent,
	branchSwitchStartEvent,
	type BranchSwitchDetail,
} from "./branchSwitch";
import { drainPerformanceTimings, recordPerformanceTiming } from "./performanceMarks";

const sampleIntervalMs = 10_000;
const heartbeatIntervalMs = 1_000;

export function startPerformanceDiagnostics(): () => void {
	const bridge = getKnowbranchBridge();
	if (!bridge) return () => undefined;
	let lastRegion = "unknown";
	let lastRegionAt = 0;
	let branchSwitchStartedAt: number | undefined;
	let expectedHeartbeat = performance.now() + heartbeatIntervalMs;
	let longTasks = { count: 0, totalMs: 0, maxMs: 0 };
	let heartbeat = { delayedCount: 0, totalDelayMs: 0, maxDelayMs: 0 };
	let regionStalls: Record<string, number> = {};

	const rememberRegion = (event: Event) => {
		lastRegion = diagnosticRegion(event.target);
		lastRegionAt = performance.now();
	};
	window.addEventListener("pointerdown", rememberRegion, true);
	window.addEventListener("keydown", rememberRegion, true);

	const observer =
		typeof PerformanceObserver !== "undefined" &&
		PerformanceObserver.supportedEntryTypes.includes("longtask")
			? new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) {
						const duration = Math.round(entry.duration);
						longTasks.count += 1;
						longTasks.totalMs += duration;
						longTasks.maxMs = Math.max(longTasks.maxMs, duration);
						const region =
							performance.now() - lastRegionAt <= 2_000 ? lastRegion : "render/background";
						regionStalls[region] = (regionStalls[region] ?? 0) + duration;
					}
				})
			: null;
	observer?.observe({ entryTypes: ["longtask"] });

	const heartbeatTimer = window.setInterval(() => {
		const now = performance.now();
		const delay = Math.max(0, Math.round(now - expectedHeartbeat));
		if (document.visibilityState === "visible" && delay >= 100 && delay <= 5_000) {
			heartbeat.delayedCount += 1;
			heartbeat.totalDelayMs += delay;
			heartbeat.maxDelayMs = Math.max(heartbeat.maxDelayMs, delay);
			regionStalls[lastRegion] = (regionStalls[lastRegion] ?? 0) + delay;
		}
		expectedHeartbeat = now + heartbeatIntervalMs;
	}, heartbeatIntervalMs);
	const resetHeartbeat = () => {
		expectedHeartbeat = performance.now() + heartbeatIntervalMs;
	};
	const branchStart = (event: Event) => {
		branchSwitchStartedAt = performance.now();
		const sessionId = (event as CustomEvent<BranchSwitchDetail>).detail?.sessionId;
		if (sessionId) lastRegion = "branch-switch";
	};
	const branchEnd = () => {
		if (branchSwitchStartedAt !== undefined)
			recordPerformanceTiming("branch-switch-total", performance.now() - branchSwitchStartedAt);
		branchSwitchStartedAt = undefined;
	};
	document.addEventListener("visibilitychange", resetHeartbeat);
	window.addEventListener(branchSwitchStartEvent, branchStart);
	window.addEventListener(branchSwitchEndEvent, branchEnd);

	const flush = () => {
		const state = useAppStore.getState();
		const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
		void bridge
			.diagnosticReport({
				timestamp: new Date().toISOString(),
				route: window.location.hash || "#/",
				visibility: document.visibilityState,
				uptimeMs: Math.round(performance.now()),
				domNodes: document.getElementsByTagName("*").length,
				memoryBytes: memory?.usedJSHeapSize,
				activeSessionId: state.activeSessionId ?? undefined,
				turnCount: state.turns.length,
				runningTurnCount: state.turns.filter(isTurnActive).length,
				entityCount: state.entities.length,
				longTasks,
				heartbeat,
				regionStalls,
				timings: drainPerformanceTimings(),
			})
			.catch(() => undefined);
		longTasks = { count: 0, totalMs: 0, maxMs: 0 };
		heartbeat = { delayedCount: 0, totalDelayMs: 0, maxDelayMs: 0 };
		regionStalls = {};
	};
	const sampleTimer = window.setInterval(flush, sampleIntervalMs);
	window.addEventListener("pagehide", flush);
	return () => {
		observer?.disconnect();
		window.clearInterval(heartbeatTimer);
		window.clearInterval(sampleTimer);
		window.removeEventListener("pointerdown", rememberRegion, true);
		window.removeEventListener("keydown", rememberRegion, true);
		window.removeEventListener("pagehide", flush);
		document.removeEventListener("visibilitychange", resetHeartbeat);
		window.removeEventListener(branchSwitchStartEvent, branchStart);
		window.removeEventListener(branchSwitchEndEvent, branchEnd);
		flush();
	};
}

function diagnosticRegion(target: EventTarget | null): string {
	if (!(target instanceof Element)) return "unknown";
	for (const [selector, name] of [
		[".mermaid-diagram", "diagram"],
		[".html-preview", "interactive-diagram"],
		[".chat-scroll", "chat"],
		[".chat-composer", "composer"],
		[".app-sidebar", "sidebar"],
		[".knowledge-pane", "knowledge-pane"],
		["[role='dialog']", "dialog"],
	] as const) {
		if (target.closest(selector)) return name;
	}
	return target.tagName.toLocaleLowerCase();
}
