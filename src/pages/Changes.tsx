import { Download, FileDiff, History, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { KnowledgeChangeHistory } from "../components/KnowledgeChangeHistory";
import { getRhyzaBridge } from "../hooks/useRhyzaBridge";
import { useAppStore } from "../store";

const Changes = () => {
	const { activeSessionId, changesets } = useAppStore();
	const [codeDiff, setCodeDiff] = useState<string | null>(null);
	const [tab, setTab] = useState<"knowledge" | "code">("knowledge");
	const [diffLoading, setDiffLoading] = useState(false);
	const [diffError, setDiffError] = useState<string | null>(null);
	const [workspace, setWorkspace] = useState<{ path: string; isolated: boolean } | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const [exporting, setExporting] = useState(false);
	const [exportFeedback, setExportFeedback] = useState<{ message: string; error: boolean } | null>(
		null,
	);
	const proposedCount = changesets.filter((change) => change.status === "proposed").length;

	useEffect(() => {
		if (tab !== "code") return;
		let canceled = false;
		const bridge = getRhyzaBridge();
		setCodeDiff(null);
		setWorkspace(null);
		setDiffError(null);
		setExportFeedback(null);
		if (!bridge || !activeSessionId) {
			setDiffLoading(false);
			return;
		}
		setDiffLoading(true);
		void bridge
			.workspaceDiff({ frontendSessionId: activeSessionId })
			.then((result) => {
				if (canceled) return;
				setWorkspace({ path: result.path, isolated: result.isolated });
				const content = `${result.status}\n${result.diff}`;
				setCodeDiff(content.trim() ? content : "");
			})
			.catch((error) => {
				if (!canceled) setDiffError(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				if (!canceled) setDiffLoading(false);
			});
		return () => {
			canceled = true;
		};
	}, [activeSessionId, tab, refreshKey]);

	const exportPatch = async () => {
		const bridge = getRhyzaBridge();
		if (!bridge || !activeSessionId || exporting) return;
		setExporting(true);
		setExportFeedback(null);
		try {
			const result = await bridge.workspaceExportPatch({ frontendSessionId: activeSessionId });
			if (
				useAppStore.getState().activeSessionId === activeSessionId &&
				!result.canceled &&
				result.path
			)
				setExportFeedback({ message: `Patch exported to ${result.path}`, error: false });
		} catch (error) {
			if (useAppStore.getState().activeSessionId === activeSessionId)
				setExportFeedback({
					message: error instanceof Error ? error.message : String(error),
					error: true,
				});
		} finally {
			setExporting(false);
		}
	};

	return (
		<div className="changes-page library-page flex-1 flex overflow-hidden">
			<main className="page-shell">
				<header className="page-header library-page-header">
					<div>
						<h1 className="page-title">Changes</h1>
						<p className="page-subtitle">
							Audited knowledge transactions and session code changes.
						</p>
					</div>
					<div
						className="segmented changes-tabs"
						role="tablist"
						aria-label="Change type"
						onKeyDown={(event) => {
							if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
							event.preventDefault();
							const nextTab =
								event.key === "Home"
									? "knowledge"
									: event.key === "End"
										? "code"
										: tab === "knowledge"
											? "code"
											: "knowledge";
							setTab(nextTab);
							event.currentTarget
								.querySelector<HTMLButtonElement>(`#changes-${nextTab}-tab`)
								?.focus();
						}}
					>
						<button
							type="button"
							id="changes-knowledge-tab"
							role="tab"
							aria-selected={tab === "knowledge"}
							aria-controls="changes-knowledge-panel"
							tabIndex={tab === "knowledge" ? 0 : -1}
							className={tab === "knowledge" ? "active" : ""}
							onClick={() => setTab("knowledge")}
						>
							Knowledge <span className="library-count">{changesets.length}</span>
						</button>
						<button
							type="button"
							id="changes-code-tab"
							role="tab"
							aria-selected={tab === "code"}
							aria-controls="changes-code-panel"
							tabIndex={tab === "code" ? 0 : -1}
							className={tab === "code" ? "active" : ""}
							onClick={() => setTab("code")}
						>
							Code
						</button>
					</div>
				</header>
				{tab === "knowledge" ? (
					<section
						className="changes-knowledge-panel"
						id="changes-knowledge-panel"
						role="tabpanel"
						aria-labelledby="changes-knowledge-tab"
					>
						<div className="library-section-heading">
							<h2>Knowledge history</h2>
							<span>
								{changesets.length} recorded
								{proposedCount > 0 ? ` · ${proposedCount} awaiting review` : ""}
							</span>
						</div>
						{changesets.length > 0 ? (
							<KnowledgeChangeHistory />
						) : (
							<div className="empty-state changes-history-empty">
								<span className="library-empty-icon" aria-hidden="true">
									<History size={24} />
								</span>
								<h2>No knowledge changes yet</h2>
								<p>Knowledge updates from your sessions will appear here for review.</p>
							</div>
						)}
					</section>
				) : (
					<section
						className="changes-code-panel"
						id="changes-code-panel"
						role="tabpanel"
						aria-labelledby="changes-code-tab"
						aria-busy={diffLoading}
					>
						<div className="changes-code-toolbar">
							<div className="changes-workspace">
								<h2>{workspace?.isolated ? "Isolated worktree" : "Session workspace"}</h2>
								{workspace && <p title={workspace.path}>{workspace.path}</p>}
							</div>
							<div className="changes-code-actions">
								<button
									type="button"
									className="icon-button"
									title="Refresh code diff"
									aria-label="Refresh code diff"
									onClick={() => setRefreshKey((key) => key + 1)}
									disabled={!activeSessionId || !getRhyzaBridge() || diffLoading}
								>
									<RefreshCw size={15} className={diffLoading ? "animate-spin" : ""} />
								</button>
								<button
									type="button"
									onClick={() => void exportPatch()}
									className="secondary-button"
									disabled={!workspace || diffLoading || exporting}
								>
									<Download size={14} /> {exporting ? "Exporting…" : "Export patch"}
								</button>
							</div>
						</div>
						{exportFeedback && (
							<p
								className={`library-feedback${exportFeedback.error ? " is-error" : ""}`}
								role={exportFeedback.error ? "alert" : "status"}
							>
								{exportFeedback.message}
							</p>
						)}
						{diffError ? (
							<p className="library-feedback is-error" role="alert">
								{diffError}
							</p>
						) : diffLoading ? (
							<div className="empty-state changes-code-empty" role="status">
								<RefreshCw size={23} className="animate-spin" aria-hidden="true" />
								<h2>Loading code changes…</h2>
							</div>
						) : codeDiff ? (
							<pre className="changes-code-diff" tabIndex={0} aria-label="Session code diff">
								{codeDiff}
							</pre>
						) : (
							<div className="empty-state changes-code-empty">
								<span className="library-empty-icon" aria-hidden="true">
									<FileDiff size={24} />
								</span>
								<h2>{workspace ? "No code changes" : "No session diff"}</h2>
								<p>
									{workspace
										? "There are no uncommitted changes in this workspace."
										: "Open and run a session before viewing its worktree diff."}
								</p>
							</div>
						)}
					</section>
				)}
			</main>
		</div>
	);
};

export default Changes;
