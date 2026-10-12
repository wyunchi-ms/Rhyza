import { Check, Folder, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRhyzaBridge } from "../hooks/useRhyzaBridge";
import { useTranslation } from "../i18n";
import type { WorkspaceHistoryEntry, WorkspaceInfo } from "../shared/ipc";
import { errorToMessage } from "../shared/value";

export function WorkspacePicker({
	currentPath,
	onSelect,
	onClose,
}: {
	currentPath: string | null;
	onSelect: (workspace: WorkspaceInfo) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const requestInFlight = useRef(false);
	const [history, setHistory] = useState<WorkspaceHistoryEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reload, setReload] = useState(0);

	useEffect(() => {
		const dialog = dialogRef.current;
		const previousFocus =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		dialog?.showModal();
		return () => {
			dialog?.close();
			previousFocus?.focus();
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const bridge = getRhyzaBridge();
		setLoading(true);
		setError(null);
		if (!bridge?.isElectron) {
			setError(t("Selecting a workspace requires the Electron desktop app."));
			setLoading(false);
			return;
		}
		void bridge.workspaceHistory().then(
			(entries) => {
				if (!cancelled) {
					setHistory(entries);
					setLoading(false);
				}
			},
			(reason: unknown) => {
				if (!cancelled) {
					setError(errorToMessage(reason));
					setLoading(false);
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [reload, t]);

	const choose = async (workspacePath?: string) => {
		if (requestInFlight.current) return;
		const bridge = getRhyzaBridge();
		if (!bridge?.isElectron) {
			setError(t("Selecting a workspace requires the Electron desktop app."));
			return;
		}
		requestInFlight.current = true;
		setBusy(true);
		setError(null);
		try {
			const workspace = workspacePath
				? await bridge.switchWorkspace({ path: workspacePath })
				: await bridge.selectWorkspace();
			if (!workspace.path || workspace.path === currentPath) return;
			onSelect(workspace);
			onClose();
		} catch (reason) {
			setError(errorToMessage(reason));
		} finally {
			requestInFlight.current = false;
			setBusy(false);
		}
	};

	return (
		<dialog
			ref={dialogRef}
			className="workspace-picker"
			aria-labelledby="workspace-picker-title"
			aria-describedby="workspace-picker-description"
			onCancel={(event) => {
				event.preventDefault();
				if (!busy) onClose();
			}}
			onClick={(event) => {
				if (busy || event.target !== event.currentTarget) return;
				const bounds = event.currentTarget.getBoundingClientRect();
				if (
					event.clientX < bounds.left ||
					event.clientX > bounds.right ||
					event.clientY < bounds.top ||
					event.clientY > bounds.bottom
				)
					onClose();
			}}
		>
			<header className="workspace-picker-header">
				<div>
					<h2 id="workspace-picker-title">{t("Choose workspace")}</h2>
					<p id="workspace-picker-description">
						{t("Switch to a workspace you have used before.")}
					</p>
				</div>
				<button
					type="button"
					className="icon-button"
					aria-label={t("Close")}
					disabled={busy}
					onClick={onClose}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</header>
			<section
				className="workspace-picker-history"
				aria-labelledby="workspace-history-title"
				aria-busy={loading || busy}
			>
				<h3 id="workspace-history-title">{t("Recent workspaces")}</h3>
				{loading ? (
					<p role="status">{t("Loading workspaces…")}</p>
				) : history.length > 0 ? (
					<ul className="workspace-picker-list">
						{history.map((entry) => {
							const current = entry.path === currentPath;
							const segments = entry.path.split(/[\\/]/).filter(Boolean);
							const name = segments[segments.length - 1] ?? entry.path;
							return (
								<li key={entry.path}>
									<button
										type="button"
										className={
											current ? "workspace-picker-entry is-current" : "workspace-picker-entry"
										}
										disabled={busy || current}
										aria-current={current ? "true" : undefined}
										onClick={() => void choose(entry.path)}
										title={entry.path}
									>
										<Folder size={20} aria-hidden="true" />
										<span className="workspace-picker-entry-copy">
											<strong>{name}</strong>
											<span>{entry.path}</span>
										</span>
										{current && (
											<span className="workspace-picker-current">
												<Check size={14} aria-hidden="true" />
												{t("Current workspace")}
											</span>
										)}
									</button>
								</li>
							);
						})}
					</ul>
				) : !error ? (
					<p>{t("No recent workspaces yet. Add a folder to get started.")}</p>
				) : null}
			</section>
			{error && (
				<div className="workspace-picker-error" role="alert">
					<p>{error}</p>
					{history.length === 0 && (
						<button
							type="button"
							className="secondary-button"
							disabled={busy}
							onClick={() => setReload((value) => value + 1)}
						>
							{t("Retry")}
						</button>
					)}
				</div>
			)}
			<footer className="workspace-picker-footer">
				<p>{t("Choose an existing folder or create a new one.")}</p>
				<button
					type="button"
					className="command-button"
					disabled={busy}
					onClick={() => void choose()}
				>
					<Plus size={17} aria-hidden="true" />
					{busy ? t("Choosing workspace…") : t("Add workspace")}
				</button>
			</footer>
		</dialog>
	);
}
