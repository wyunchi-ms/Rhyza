import { Activity, BarChart3, Braces, Check, ChevronDown, Copy, Layers3, RadioTower, TrendingUp, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AgentModelRequestSnapshot, AgentUsage } from "../../shared/ipc";
import type { RightPaneView, Turn } from "../../types";
import { usageTokens } from "../../utils/branchUsage";
import { analyzeContextComposition, analyzeContextRot, residentInputTokens, type ContextRotAnalysis } from "../../utils/contextRot";
import { JsonPreviewButton, JsonText } from "../JsonViewer";

type UsageMetric = "tokens" | "cost";
type GrowthMetric = "context" | "churn";

export function TurnInspectorPanel({ turn, turns, view, onClose }: { turn: Turn; turns: Turn[]; view: Exclude<RightPaneView, "todo">; onClose: () => void }) {
	const [metric, setMetric] = useState<UsageMetric>("tokens");
	const [growthMetric, setGrowthMetric] = useState<GrowthMetric>("context");
	const [requestIndex, setRequestIndex] = useState(0);
	const [analysis, setAnalysis] = useState<ContextRotAnalysis | null>(null);
	const [copied, setCopied] = useState<"context" | "wire" | null>(null);
	const request = turn.modelRequests?.[requestIndex];
	const composition = useMemo(() => request ? analyzeContextComposition(request) : undefined, [request]);
	const assistantTurns = turns.filter((item) => item.role === "assistant");
	const round = Math.max(1, assistantTurns.findIndex((item) => item.id === turn.id) + 1);
	const panelTitle = view === "context" ? "Context analysis" : view === "raw_context" ? "Raw context" : view === "wire" ? "Wire request" : "Usage & cost";
	useEffect(() => { setRequestIndex(0); setAnalysis(null); setCopied(null); }, [turn.id]);
	const copyJson = async (kind: "context" | "wire", value: unknown) => {
		try {
			await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
			setCopied(kind);
			window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1_500);
		} catch (error) {
			console.warn(`Could not copy ${kind} JSON`, error);
		}
	};
	return <section className="turn-inspector" aria-labelledby="turn-inspector-title">
			<header><div><h2 id="turn-inspector-title">{panelTitle}</h2><p>Round {round} · right-click another bubble to switch</p></div><button type="button" onClick={onClose} title="Close panel" aria-label="Close panel"><X size={18} /></button></header>
			<div className="turn-inspector-scroll">
				{view === "context" ? <>
				<section className="inspector-section"><div className="inspector-heading"><div><Activity size={15} /><h3>Request context</h3></div>{turn.modelRequests && turn.modelRequests.length > 1 && <select value={requestIndex} onChange={(event) => { setRequestIndex(Number(event.target.value)); setAnalysis(null); }}>{turn.modelRequests.map((item, index) => <option key={item.id} value={index}>Call {index + 1} · {item.model}</option>)}</select>}</div>
					{request && composition ? <><RequestMeta request={request} /><div className="context-stats"><span><strong>{request.context.messages.length}</strong> messages</span><span><strong>{formatTokens(residentInputTokens(request.usage) ?? composition.total)}</strong>{request.usage ? "API input" : "estimated input"}</span><span><strong>{request.contextWindow ? `${Math.round((residentInputTokens(request.usage) ?? composition.total) / request.contextWindow * 100)}%` : "—"}</strong>window used</span></div>
						{analysis ? <><div className="rot-score"><div><span>Semantic relevance</span><strong>{analysis.relevance}%</strong></div><div><span>Context rot</span><strong className={analysis.rot >= 35 ? "is-high" : analysis.rot >= 15 ? "is-medium" : "is-low"}>{analysis.rot}%</strong><small>~{formatTokens(analysis.deadWeightTokens)} dead weight</small></div></div><ContextMessages analysis={analysis} /></> : <button type="button" className="analyze-context-button" onClick={() => setAnalysis(analyzeContextRot(request))}>Analyze stale and low-relevance blocks</button>}
						<RawJsonDetails label="Raw context" value={request.context} copied={copied === "context"} onCopy={() => void copyJson("context", request.context)} />
						{request.wirePayload !== undefined && <RawJsonDetails label="Provider wire payload" value={request.wirePayload} copied={copied === "wire"} onCopy={() => void copyJson("wire", request.wirePayload)} />}</> : <p className="inspector-empty">No context snapshot was recorded. Snapshots appear for new turns after the updated Electron runtime starts.</p>}
				</section>
				{request && composition && <section className="inspector-section"><div className="inspector-heading"><div><Layers3 size={15} /><h3>Context composition</h3></div><small className="estimate-badge">estimated split</small></div><CompositionPanel request={request} /></section>}
				</> : view === "usage" ? <>
				<section className="inspector-section"><div className="inspector-heading"><div><TrendingUp size={15} /><h3>Context growth</h3></div><MetricToggle value={growthMetric} options={[{ value: "context", label: "Context" }, { value: "churn", label: "Cache churn" }]} onChange={setGrowthMetric} /></div><ContextGrowthChart turns={assistantTurns} selectedId={turn.id} metric={growthMetric} /></section>
				<section className="inspector-section"><div className="inspector-heading"><div><BarChart3 size={15} /><h3>Usage by round</h3></div><MetricToggle value={metric} options={[{ value: "tokens", label: "Tokens" }, { value: "cost", label: "Cost" }]} onChange={setMetric} /></div><UsageChart turns={assistantTurns} selectedId={turn.id} metric={metric} /></section>
				</> : <RawPayloadPanel kind={view} request={request} requests={turn.modelRequests ?? []} requestIndex={requestIndex} copied={copied === (view === "raw_context" ? "context" : "wire")} onRequestIndexChange={(index) => { setRequestIndex(index); setCopied(null); }} onCopy={(value) => void copyJson(view === "raw_context" ? "context" : "wire", value)} />}
			</div>
	</section>;
}

function RawPayloadPanel({ kind, request, requests, requestIndex, copied, onRequestIndexChange, onCopy }: {
	kind: "raw_context" | "wire";
	request?: AgentModelRequestSnapshot;
	requests: AgentModelRequestSnapshot[];
	requestIndex: number;
	copied: boolean;
	onRequestIndexChange: (index: number) => void;
	onCopy: (value: unknown) => void;
}) {
	const value = kind === "raw_context" ? request?.context : request?.wirePayload;
	const label = kind === "raw_context" ? "Provider-neutral context" : "Final provider payload";
	return <section className="inspector-section raw-payload-panel"><div className="inspector-heading"><div>{kind === "raw_context" ? <Braces size={15} /> : <RadioTower size={15} />}<h3>{label}</h3></div>{requests.length > 1 && <select value={requestIndex} onChange={(event) => onRequestIndexChange(Number(event.target.value))}>{requests.map((item, index) => <option key={item.id} value={index}>Call {index + 1} · {item.model}</option>)}</select>}</div>
		{request ? <><RequestMeta request={request} />{value !== undefined ? <div className="raw-payload-viewer"><div><span>{label} <small>TXT</small></span><span className="raw-payload-actions"><JsonPreviewButton value={value} label={label} /><button type="button" title={copied ? "Copied" : `Copy ${label}`} aria-label={copied ? `${label} copied` : `Copy ${label}`} onClick={() => onCopy(value)}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></span></div><JsonText key={`${kind}-${request.id}`} value={value} label={`${label} text`} /></div> : <p className="inspector-empty">The provider wire payload was not captured for this call.</p>}</> : <p className="inspector-empty">No request snapshot was recorded for this turn. Restart the Electron runtime, then send a new message to begin capturing requests.</p>}
	</section>;
}

function RawJsonDetails({ label, value, copied, onCopy }: { label: string; value: unknown; copied: boolean; onCopy: () => void }) {
	return <details className="raw-request"><summary><span>{label} <small>TXT</small></span><span className="raw-request-actions"><JsonPreviewButton value={value} label={label} /><button type="button" title={copied ? "Copied" : `Copy ${label}`} aria-label={copied ? `${label} copied` : `Copy ${label}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onCopy(); }}>{copied ? <Check size={13} /> : <Copy size={13} />}</button><ChevronDown className="raw-request-chevron" size={13} /></span></summary><JsonText value={value} label={`${label} text`} /></details>;
}

function MetricToggle<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
	return <div className="metric-toggle">{options.map((option) => <button key={option.value} type="button" className={value === option.value ? "is-active" : ""} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

function RequestMeta({ request }: { request: AgentModelRequestSnapshot }) {
	return <><div className="request-meta"><span>{request.provider}</span><strong>{request.model}</strong><span>thinking: {request.thinking}</span></div>{request.dumpPath && <p className="request-dump-path" title={request.dumpPath}>Dump: {request.dumpPath}</p>}</>;
}

function ContextMessages({ analysis }: { analysis: ContextRotAnalysis }) {
	return <div className="context-message-list">{analysis.messages.map((message) => <div key={message.index} className={message.stale ? "is-low" : ""}><div><span>{message.role} · {message.kind === "tool_io" ? "tool I/O" : "conversation"} · ~{formatTokens(message.estimatedTokens)} · age {message.ageTurns}</span><strong>{message.relevance}%</strong></div><p>{message.preview}</p>{message.stale && <small>Likely dead weight · rot contribution {Math.round(message.rotContribution * 100)}%</small>}</div>)}</div>;
}

function ContextGrowthChart({ turns, selectedId, metric }: { turns: Turn[]; selectedId: string; metric: GrowthMetric }) {
	const points = turns.flatMap((turn, roundIndex) => (turn.modelRequests ?? []).map((request) => {
		const resident = residentInputTokens(request.usage) ?? analyzeContextComposition(request).total;
		return { id: request.id, turnId: turn.id, round: roundIndex + 1, call: request.sequence, model: request.model, thinking: request.thinking, estimated: !request.usage, value: metric === "context" ? resident : request.usage ? request.usage.input + request.usage.cacheWrite : 0, contextWindow: request.contextWindow };
	}));
	if (!points.length) return <p className="inspector-empty">No call-level context history recorded yet.</p>;
	const peak = Math.max(...points.map((point) => point.value));
	const latest = points[points.length - 1];
	const latestTurnRequests = turns[turns.length - 1]?.modelRequests;
	const latestUsage = latestTurnRequests?.[latestTurnRequests.length - 1]?.usage;
	const cacheHit = latestUsage && residentInputTokens(latestUsage) ? latestUsage.cacheRead / residentInputTokens(latestUsage)! * 100 : undefined;
	return <><LineChart points={points.map((point) => ({ ...point, label: `Round ${point.round}, call ${point.call}: ${formatTokens(point.value)}${point.estimated ? " estimated" : ""}` }))} selectedId={selectedId} /><div className="growth-summary"><span><small>Latest</small><strong>{formatTokens(latest.value)}</strong></span><span><small>Peak</small><strong>{formatTokens(peak)}</strong></span><span><small>Latest cache hit</small><strong>{cacheHit === undefined ? "—" : `${cacheHit.toFixed(1)}%`}</strong></span></div><p className="metric-note">{metric === "context" ? "Context is resident provider input: input + cache read + cache write. Dashed line marks 50% of the model window." : "Cache churn is uncached input plus newly written cache tokens."}</p></>;
}

function CompositionPanel({ request }: { request: AgentModelRequestSnapshot }) {
	const composition = analyzeContextComposition(request);
	const values = [{ key: "system", label: "System + tools", value: composition.system }, { key: "conversation", label: "Conversation", value: composition.conversation }, { key: "tool", label: "Tool I/O", value: composition.toolIo }];
	return <><div className="composition-bar" aria-label="Estimated context composition">{values.map((item) => <span key={item.key} className={`is-${item.key}`} style={{ width: `${composition.total ? item.value / composition.total * 100 : 0}%` }} title={`${item.label}: ~${formatTokens(item.value)}`} />)}</div><div className="composition-legend">{values.map((item) => <div key={item.key}><i className={`is-${item.key}`} /><span>{item.label}</span><strong>{composition.total ? `${Math.round(item.value / composition.total * 100)}%` : "0%"}</strong><small>~{formatTokens(item.value)}</small></div>)}</div><p className="metric-note">Total input usage is API-reported when available; the category allocation is estimated from captured content blocks.</p></>;
}

function UsageChart({ turns, selectedId, metric }: { turns: Turn[]; selectedId: string; metric: UsageMetric }) {
	const points = useMemo(() => turns.map((turn, index) => {
		const usage = requestUsage(turn) ?? turn.usage ?? turn.inheritedUsage;
		return { id: turn.id, turnId: turn.id, round: index + 1, value: usage ? metric === "tokens" ? usageTokens(usage) : usage.cost : 0, label: `Round ${index + 1}: ${formatMetric(usage ? metric === "tokens" ? usageTokens(usage) : usage.cost : 0, metric)}` };
	}), [turns, metric]);
	return <>{points.length ? <LineChart points={points} selectedId={selectedId} /> : <p className="inspector-empty">No assistant usage recorded.</p>}<div className="usage-turn-list">{points.map((point) => { const sourceTurn = turns[point.round - 1]; return <div key={point.id} className={point.turnId === selectedId ? "is-selected" : ""}><span>Round {point.round}</span><strong>{formatMetric(point.value, metric)}</strong><small>{requestLabel(sourceTurn)}</small></div>; })}</div></>;
}

function LineChart({ points, selectedId }: { points: Array<{ id: string; turnId: string; value: number; label: string; contextWindow?: number }>; selectedId: string }) {
	const width = 420;
	const height = 154;
	const pad = 18;
	const maxWindow = Math.max(0, ...points.map((point) => point.contextWindow ?? 0));
	const max = Math.max(1, maxWindow ? maxWindow * 0.55 : 0, ...points.map((point) => point.value));
	const x = (index: number) => points.length <= 1 ? width / 2 : pad + index * ((width - pad * 2) / (points.length - 1));
	const y = (value: number) => height - pad - (value / max) * (height - pad * 2);
	const path = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.value)}`).join(" ");
	const threshold = maxWindow ? y(maxWindow * 0.5) : undefined;
	return <div className="usage-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img"><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />{threshold !== undefined && <line className="context-threshold" x1={pad} y1={threshold} x2={width - pad} y2={threshold}><title>50% context window</title></line>}<path d={path} />{points.map((point, index) => <g key={point.id}><circle className={point.turnId === selectedId ? "is-selected" : ""} cx={x(index)} cy={y(point.value)} r={point.turnId === selectedId ? 5 : 3.5}><title>{point.label}</title></circle><text x={x(index)} y={height - 3} textAnchor="middle">{index + 1}</text></g>)}</svg></div>;
}

function requestUsage(turn: Turn): AgentUsage | undefined {
	const recorded = turn.modelRequests?.flatMap((request) => request.usage ? [request.usage] : []) ?? [];
	if (!recorded.length) return undefined;
	return recorded.reduce((sum, usage) => ({ input: sum.input + usage.input, output: sum.output + usage.output, cacheRead: sum.cacheRead + usage.cacheRead, cacheWrite: sum.cacheWrite + usage.cacheWrite, cost: sum.cost + usage.cost }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
}

function requestLabel(turn: Turn): string {
	const request = turn.modelRequests?.[0];
	return request ? `${request.model} · ${request.thinking}` : "model details unavailable";
}

function formatMetric(value: number, metric: UsageMetric): string {
	return metric === "tokens" ? `${Math.round(value).toLocaleString()} tok` : `$${value.toFixed(4)}`;
}

function formatTokens(value: number): string {
	if (value < 1_000) return `${Math.round(value)} tok`;
	if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}
