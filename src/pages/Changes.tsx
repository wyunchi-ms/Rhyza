import { Download } from "lucide-react";
import { useState } from "react";
import { KnowledgeChangeHistory } from "../components/KnowledgeChangeHistory";
import { getRhyzaBridge } from "../hooks/useRhyzaBridge";
import { useAppStore } from "../store";

const Changes = () => {
	const { activeSessionId } = useAppStore();
	const [codeDiff, setCodeDiff] = useState<string | null>(null);
	const [tab, setTab] = useState<"knowledge" | "code">("knowledge");

	const loadCodeDiff = async () => {
		setTab("code");
		const bridge = getRhyzaBridge();
		if (!bridge || !activeSessionId)
			return setCodeDiff("Open and run a session before viewing its worktree diff.");
		try {
			const result = await bridge.workspaceDiff({ frontendSessionId: activeSessionId });
			setCodeDiff(
				`${result.isolated ? "Isolated worktree" : "Workspace"}: ${result.path}\n\n${result.status}\n${result.diff}`,
			);
		} catch (error) {
			setCodeDiff(error instanceof Error ? error.message : String(error));
		}
	};

	const exportPatch = async () => {
		const bridge = getRhyzaBridge();
		if (bridge && activeSessionId)
			await bridge.workspaceExportPatch({ frontendSessionId: activeSessionId });
	};

	return (
		<div className="flex-1 flex bg-white overflow-hidden">
			<main className="page-shell">
				<div className="page-header flex-row items-start justify-between">
					<div>
						<h1 className="page-title">Changes</h1>
						<p className="page-subtitle">
							Audited knowledge transactions and session code changes.
						</p>
					</div>
					<div className="segmented">
						<button
							type="button"
							className={tab === "knowledge" ? "active" : ""}
							onClick={() => setTab("knowledge")}
						>
							Knowledge
						</button>
						<button
							type="button"
							className={tab === "code" ? "active" : ""}
							onClick={() => void loadCodeDiff()}
						>
							Code
						</button>
					</div>
				</div>
				{tab === "knowledge" ? (
					<KnowledgeChangeHistory />
				) : (
					<div className="flex-1 min-h-0 flex flex-col">
						<div className="flex justify-end mb-2">
							<button type="button" onClick={() => void exportPatch()} className="secondary-button">
								<Download size={14} /> Export patch
							</button>
						</div>
						<pre className="flex-1 overflow-auto bg-gray-950 text-gray-100 p-4 rounded-lg text-xs whitespace-pre-wrap">
							{codeDiff ?? "Loading..."}
						</pre>
					</div>
				)}
			</main>
		</div>
	);
};

export default Changes;
