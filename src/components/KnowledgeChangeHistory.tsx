import clsx from "clsx";
import { FileDiff, RotateCcw, Search, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import type { ChangeSet } from "../types";

export function KnowledgeChangeHistory({ objectId }: { objectId?: string }) {
	const { changesets, undoChangeSet, acceptChangeSet, rejectChangeSet } = useAppStore();
	const [selected, setSelected] = useState<ChangeSet | null>(null);
	const [filter, setFilter] = useState("");
	const [statusFilter, setStatusFilter] = useState<"all" | ChangeSet["status"]>("all");
	const visibleChanges = changesets.filter((change) => {
		if (objectId && !change.operations.some((operation) => operation.objectId === objectId)) return false;
		if (statusFilter !== "all" && change.status !== statusFilter) return false;
		const query = filter.trim().toLocaleLowerCase();
		return !query || `${change.title} ${change.summary} ${change.sessionId} ${change.operations.map((operation) => `${operation.kind} ${operation.label}`).join(" ")}`.toLocaleLowerCase().includes(query);
	});

	useEffect(() => {
		if (selected && !visibleChanges.some((change) => change.id === selected.id)) setSelected(null);
	}, [selected, visibleChanges]);

	return (
		<div className="knowledge-change-history">
			<div className="knowledge-change-list">
				<div className="mb-4 flex gap-2">
					<div className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input className="field field-with-icon" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter this history" /></div>
					<select className="field shrink-0" style={{ width: 160 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All statuses</option><option value="proposed">Proposed</option><option value="committed">Committed</option><option value="reverted">Reverted</option><option value="superseded">Rejected</option></select>
				</div>
				<div className="overflow-y-auto space-y-3">{visibleChanges.map((change) => {
					const created = change.operations.filter((operation) => operation.action === "create").length;
					const updated = change.operations.filter((operation) => operation.action === "update").length;
					const removed = change.operations.filter((operation) => operation.action === "soft_delete").length;
					return <section key={change.id} className={clsx("border border-gray-200 rounded-lg p-4", (change.status === "reverted" || change.status === "superseded") && "opacity-55")}><div className="flex justify-between gap-4"><div><h2 className="font-bold text-primary">{change.title}</h2><p className="text-sm text-secondary mt-1">{change.summary}</p><p className="mt-1 text-xs text-gray-400">Session {change.sessionId}{change.turnId ? ` / Turn ${change.turnId.slice(0, 8)}` : ""} / {change.actor}</p></div><div className="text-right shrink-0"><span className="status-badge status-progress">{change.status === "superseded" ? "rejected" : change.status}</span><p className="text-xs text-gray-400 mt-2">{new Date(change.timestamp).toLocaleString()}</p></div></div><div className="flex gap-2 mt-3"><span className="change-add">+{created}</span><span className="change-update">~{updated}</span><span className="change-delete">-{removed}</span>{change.status === "proposed" && <><button type="button" onClick={() => acceptChangeSet(change.id)} className="secondary-button ml-auto">Accept</button><button type="button" onClick={() => rejectChangeSet(change.id)} className="secondary-button text-red-600">Reject</button></>}<button type="button" onClick={() => setSelected(change)} className={clsx("secondary-button", change.status !== "proposed" && "ml-auto")}><FileDiff size={14} /> View diff</button>{change.status === "committed" && change.operations.length > 0 && <button type="button" onClick={() => undoChangeSet(change.id)} className="secondary-button"><RotateCcw size={14} /> Undo</button>}</div></section>;
				})}{visibleChanges.length === 0 && <div className="empty-state">No knowledge changes match this filter.</div>}</div>
			</div>
			{selected && <aside className="knowledge-change-diff"><div className="knowledge-change-diff-header"><h2 className="font-bold">Object diff</h2><button type="button" onClick={() => setSelected(null)} className="icon-button" title="Close diff" aria-label="Close diff"><X size={17} /></button></div><div className="p-4 space-y-4">{selected.operations.filter((operation) => !objectId || operation.objectId === objectId).map((operation) => <section key={`${operation.kind}-${operation.objectId}`}><div className="flex gap-2 items-center mb-2"><span className={`change-${operation.action === "create" ? "add" : operation.action === "update" ? "update" : "delete"}`}>{operation.action}</span><h3 className="font-semibold text-sm">{operation.kind}: {operation.label}</h3></div>{operation.before !== undefined && <DiffBlock label="Before" value={operation.before} tone="before" />}{operation.after !== undefined && <DiffBlock label="After" value={operation.after} tone="after" />}</section>)}</div></aside>}
		</div>
	);
}

export function KnowledgeChangeHistoryDialog({ kind, objectId, name, onClose }: { kind: "entity" | "diagram"; objectId: string; name: string; onClose: () => void }) {
	const closeButtonRef = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		closeButtonRef.current?.focus();
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			window.removeEventListener("keydown", closeOnEscape);
			previouslyFocused?.focus();
		};
	}, [onClose]);

	return createPortal(
		<div className="knowledge-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section className="knowledge-preview-dialog knowledge-change-history-dialog" role="dialog" aria-modal="true" aria-labelledby={`change-history-title-${objectId}`}>
				<header className="knowledge-preview-header">
					<div className="min-w-0"><p>{kind} change history</p><h2 id={`change-history-title-${objectId}`}>{name}</h2></div>
					<button ref={closeButtonRef} type="button" onClick={onClose} title="Close history" aria-label="Close history" className="icon-button"><X size={18} /></button>
				</header>
				<KnowledgeChangeHistory objectId={objectId} />
			</section>
		</div>,
		document.body,
	);
}

function DiffBlock({ label, value, tone }: { label: string; value: unknown; tone: "before" | "after" }) {
	return <div className={`diff-block ${tone}`}><span className="block text-[10px] font-bold uppercase mb-1">{label}</span><pre className="text-xs whitespace-pre-wrap overflow-auto max-h-64">{JSON.stringify(value, null, 2)}</pre></div>;
}
