import { cacheHitDescription, formatCacheHitRate } from "../utils/usageMetrics";
import { X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { roundMetrics } from "../utils/roundMetrics";
import { formatTokens } from "../utils/branchUsage";
import { formatDuration } from "../utils/common";
import { floatingPosition } from "../utils/floatingPosition";
import { useHoverRetention } from "../hooks/useHoverRetention";

type Metrics = ReturnType<typeof roundMetrics>;
export function coreMetricValues(metrics: Metrics) {
	const usage = metrics.usage;
	return [
		metrics.totalTokens === undefined ? "—" : `${formatTokens(metrics.totalTokens)}${metrics.partialUsage ? "+" : ""}`,
		formatCacheHitRate(metrics.cacheHitRate),
		metrics.durationMs === undefined ? "—" : formatDuration(metrics.durationMs),
		usage ? `${usage.cost > 0 && usage.cost < 0.0001 ? "<$0.0001" : `$${usage.cost.toFixed(4)}`}${metrics.partialUsage ? "+" : ""}` : "—",
	];
}

export function NodeInformation({ metrics, nodeId, onOpen, closeSignal, disabled = false }: { metrics: Metrics; nodeId: string; onOpen: () => void; closeSignal: number; disabled?: boolean }) {
	const button = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
	const [position, setPosition] = useState({ left: 0, top: 0 });
	const [pinned, setPinned] = useState(false);
	const close = useCallback(() => { clearTimeout(timer.current); setAnchor(null); setPinned(false); }, []);
	const hover = useHoverRetention(Boolean(anchor), button, panel, close, pinned);
	useEffect(close, [closeSignal, close]);
	useEffect(() => { if (disabled) close(); }, [disabled, close]);
	const open = () => {
		if (disabled) return;
		clearTimeout(timer.current);
		hover.retain();
		onOpen();
		const rect = button.current!.getBoundingClientRect();
		setAnchor({ x: rect.right + 8, y: rect.top });
	};
	const enter = () => { clearTimeout(timer.current); hover.retain(); timer.current = setTimeout(open, 250); };
	const leave = () => { clearTimeout(timer.current); hover.leave(); };
	useEffect(() => () => clearTimeout(timer.current), []);
	useLayoutEffect(() => {
		if (!anchor || !panel.current) return;
		const element = panel.current;
		const measure = () => setPosition(floatingPosition(anchor, element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		const outside = (event: Event) => { if (!element.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close(); };
		const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
		window.addEventListener("pointerdown", outside);
		window.addEventListener("scroll", outside, true);
		window.addEventListener("resize", close);
		window.addEventListener("blur", close);
		window.addEventListener("keydown", key);
		return () => { observer.disconnect(); window.removeEventListener("pointerdown", outside); window.removeEventListener("scroll", outside, true); window.removeEventListener("resize", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", key); };
	}, [anchor, close]);
	const usage = metrics.usage;
	const exact = (value?: number) => value === undefined ? "—" : value.toLocaleString();
	const cells = [
		["Total tokens", exact(metrics.totalTokens)], ["Input tokens", exact(usage?.input)], ["Output tokens", exact(usage?.output)],
		["Cache read", exact(usage?.cacheRead)], ["Cache write", exact(usage?.cacheWrite)], ["Cache hit", coreMetricValues(metrics)[1]],
		["Duration", coreMetricValues(metrics)[2]], ["Cost", usage ? `$${usage.cost.toFixed(8)}` : "—"], ["LLM calls", exact(metrics.calls)],
		["Model", metrics.models.join(", ") || "—"], ["Thinking mode", metrics.thinkingModes.join(", ") || "—"],
		["Execution", metrics.status.replace(/_/g, " ")],
	];
	return <>
		<button ref={button} type="button" className="graph-runtime-compact nodrag nopan" aria-label={`LLM Call Details: ${coreMetricValues(metrics).join(" · ")} (Tokens · Cache hit · Duration · Cost)`} aria-haspopup="dialog" aria-expanded={Boolean(anchor)} aria-controls={anchor ? `llm-call-details-${nodeId}` : undefined}
			onMouseEnter={enter} onMouseLeave={leave} onFocus={open} onBlur={leave}
			onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (pinned) close(); else { open(); setPinned(true); } }}>
			{coreMetricValues(metrics).map((value, index) => <span key={index}>{value}</span>)}
		</button>
		{anchor && createPortal(<div ref={panel} id={`llm-call-details-${nodeId}`} role="dialog" aria-label="LLM Call Details" className="node-information-panel nodrag nopan" style={position}
			onMouseEnter={hover.retain} onMouseLeave={leave} onFocus={hover.retain} onBlur={leave} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
			<header><strong>LLM Call Details</strong><button type="button" aria-label="Close LLM Call Details" onClick={close}><X size={14} /></button></header>
			<dl>{cells.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
			{metrics.partialUsage && <p>Partial recorded usage; totals marked + may increase.</p>}
			<p>— Unrecorded or not applicable. {cacheHitDescription}.</p>
		</div>, document.body)}
	</>;
}
