import clsx from "clsx";
import { Download, FileDiff, RotateCcw, Search, X } from "lucide-react";
import { useState } from "react";
import { getKnowbranchBridge } from "../hooks/useKnowbranchBridge";
import { useAppStore } from "../store";
import type { ChangeSet } from "../types";

const Changes = () => {
	const { changesets, undoChangeSet, acceptChangeSet, rejectChangeSet, activeSessionId } = useAppStore();
	const [selected, setSelected] = useState<ChangeSet | null>(null);
	const [codeDiff, setCodeDiff] = useState<string | null>(null);
	const [tab, setTab] = useState<"knowledge" | "code">("knowledge");
	const [filter, setFilter] = useState("");
	const [statusFilter, setStatusFilter] = useState<"all" | ChangeSet["status"]>("all");
	const visibleChanges = changesets.filter((change) => {
		if (statusFilter !== "all" && change.status !== statusFilter) return false;
		const query = filter.trim().toLocaleLowerCase();
		return !query || `${change.title} ${change.summary} ${change.sessionId} ${change.operations.map((operation) => `${operation.kind} ${operation.label}`).join(" ")}`.toLocaleLowerCase().includes(query);
	});

	const loadCodeDiff = async () => {
		setTab("code");
		const bridge = getKnowbranchBridge();
		if (!bridge || !activeSessionId) return setCodeDiff("Open and run a session before viewing its worktree diff.");
		try {
			const result = await bridge.workspaceDiff({ frontendSessionId: activeSessionId });
			setCodeDiff(`${result.isolated ? "Isolated worktree" : "Workspace"}: ${result.path}\n\n${result.status}\n${result.diff}`);
		} catch (error) { setCodeDiff(error instanceof Error ? error.message : String(error)); }
	};

	const exportPatch = async () => {
		const bridge = getKnowbranchBridge();
		if (bridge && activeSessionId) await bridge.workspaceExportPatch({ frontendSessionId: activeSessionId });
	};

	return (
		<div className="flex-1 flex bg-white overflow-hidden">
			<main className="page-shell">
				<div className="page-header flex-row items-start justify-between"><div><h1 className="page-title">Changes</h1><p className="page-subtitle">Audited knowledge transactions and session code changes.</p></div><div className="segmented"><button type="button" className={tab === "knowledge" ? "active" : ""} onClick={() => setTab("knowledge")}>Knowledge</button><button type="button" className={tab === "code" ? "active" : ""} onClick={() => void loadCodeDiff()}>Code</button></div></div>
				{tab === "knowledge" ? <div className="flex min-h-0 flex-1 flex-col"><div className="mb-4 flex gap-2"><div className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input className="field field-with-icon" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by Session, Entity, Diagram, or summary" /></div><select className="field shrink-0" style={{ width: 160 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All statuses</option><option value="proposed">Proposed</option><option value="committed">Committed</option><option value="reverted">Reverted</option><option value="superseded">Rejected</option></select></div><div className="overflow-y-auto space-y-3">{visibleChanges.map((change) => {
					const created = change.operations.filter((operation) => operation.action === "create").length;
					const updated = change.operations.filter((operation) => operation.action === "update").length;
					const removed = change.operations.filter((operation) => operation.action === "soft_delete").length;
					return <section key={change.id} className={clsx("border border-gray-200 rounded-lg p-4", (change.status === "reverted" || change.status === "superseded") && "opacity-55")}><div className="flex justify-between gap-4"><div><h2 className="font-bold text-primary">{change.title}</h2><p className="text-sm text-secondary mt-1">{change.summary}</p><p className="mt-1 text-xs text-gray-400">Session {change.sessionId}{change.turnId ? ` / Turn ${change.turnId.slice(0, 8)}` : ""} / {change.actor}</p></div><div className="text-right shrink-0"><span className="status-badge status-progress">{change.status === "superseded" ? "rejected" : change.status}</span><p className="text-xs text-gray-400 mt-2">{new Date(change.timestamp).toLocaleString()}</p></div></div><div className="flex gap-2 mt-3"><span className="change-add">+{created}</span><span className="change-update">~{updated}</span><span className="change-delete">-{removed}</span>{change.status === "proposed" && <><button type="button" onClick={() => acceptChangeSet(change.id)} className="secondary-button ml-auto">Accept</button><button type="button" onClick={() => rejectChangeSet(change.id)} className="secondary-button text-red-600">Reject</button></>}<button type="button" onClick={() => setSelected(change)} className={clsx("secondary-button", change.status !== "proposed" && "ml-auto")}><FileDiff size={14} /> View diff</button>{change.status === "committed" && change.operations.length > 0 && <button type="button" onClick={() => undoChangeSet(change.id)} className="secondary-button"><RotateCcw size={14} /> Undo</button>}</div></section>;
				})}{visibleChanges.length === 0 && <div className="empty-state">No knowledge changes match this filter.</div>}</div></div> : <div className="flex-1 min-h-0 flex flex-col"><div className="flex justify-end mb-2"><button type="button" onClick={() => void exportPatch()} className="secondary-button"><Download size={14} /> Export patch</button></div><pre className="flex-1 overflow-auto bg-gray-950 text-gray-100 p-4 rounded-lg text-xs whitespace-pre-wrap">{codeDiff ?? "Loading..."}</pre></div>}
			</main>
			{selected && <aside className="w-[440px] border-l border-gray-200 overflow-y-auto bg-white"><div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex justify-between"><h2 className="font-bold">Object diff</h2><button type="button" onClick={() => setSelected(null)} className="icon-button"><X size={17} /></button></div><div className="p-4 space-y-4">{selected.operations.map((operation) => <section key={`${operation.kind}-${operation.objectId}`}><div className="flex gap-2 items-center mb-2"><span className={`change-${operation.action === "create" ? "add" : operation.action === "update" ? "update" : "delete"}`}>{operation.action}</span><h3 className="font-semibold text-sm">{operation.kind}: {operation.label}</h3></div>{operation.before !== undefined && <DiffBlock label="Before" value={operation.before} tone="before" />}{operation.after !== undefined && <DiffBlock label="After" value={operation.after} tone="after" />}</section>)}</div></aside>}
		</div>
	);
};

function DiffBlock({ label, value, tone }: { label: string; value: unknown; tone: "before" | "after" }) {
	return <div className={`diff-block ${tone}`}><span className="block text-[10px] font-bold uppercase mb-1">{label}</span><pre className="text-xs whitespace-pre-wrap overflow-auto max-h-64">{JSON.stringify(value, null, 2)}</pre></div>;
}

export default Changes;
