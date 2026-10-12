import { Folder, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRhyzaBridge } from "../hooks/useRhyzaBridge";
import { useTranslation } from "../i18n";
import type { SourceIndexingConfig, SourceInfo } from "../shared/ipc";
import { errorToMessage } from "../shared/value";

export function SourceIndexSettings({
	source,
	onSaved,
	onClose,
}: {
	source: SourceInfo;
	onSaved: (source: SourceInfo) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const savingRef = useRef(false);
	const [config, setConfig] = useState<SourceIndexingConfig | null>(null);
	const [excludedDirectories, setExcludedDirectories] = useState<string[]>([]);
	const [patterns, setPatterns] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);

	useEffect(() => {
		const previousFocus =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const dialog = dialogRef.current;
		dialog?.showModal();
		return () => {
			dialog?.close();
			previousFocus?.focus();
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		const bridge = getRhyzaBridge();
		if (!bridge) {
			setLoading(false);
			setError(t("The desktop app is required to configure indexing."));
			return;
		}
		void bridge.sourceIndexingGet({ id: source.id }).then(
			(result) => {
				if (cancelled) return;
				setConfig(result);
				setExcludedDirectories(result.excludedDirectories);
				setPatterns(result.excludePatterns.join("\n"));
				setLoading(false);
			},
			(reason: unknown) => {
				if (cancelled) return;
				setError(errorToMessage(reason));
				setLoading(false);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [source.id, retry, t]);

	const save = async () => {
		if (!config || savingRef.current) return;
		const bridge = getRhyzaBridge();
		if (!bridge) {
			setError(t("The desktop app is required to configure indexing."));
			return;
		}
		savingRef.current = true;
		setSaving(true);
		setError(null);
		try {
			const updated = await bridge.sourceIndexingSave({
				id: source.id,
				excludedDirectories,
				excludePatterns: patterns
					.split(/\r?\n/)
					.filter((line) => line.trim() && !line.trimStart().startsWith("#")),
			});
			onSaved(updated);
			onClose();
		} catch (reason) {
			setError(errorToMessage(reason));
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	};

	return (
		<dialog
			ref={dialogRef}
			className="source-index-settings"
			aria-labelledby="source-index-settings-title"
			aria-describedby="source-index-settings-description"
			onCancel={(event) => {
				event.preventDefault();
				if (!saving) onClose();
			}}
		>
			<header className="source-index-settings-header">
				<div>
					<h2 id="source-index-settings-title">{t("Indexing settings")}</h2>
					<p id="source-index-settings-description">{source.name}</p>
				</div>
				<button
					type="button"
					className="icon-button"
					aria-label={t("Close")}
					disabled={saving}
					onClick={onClose}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</header>
			<div className="source-index-settings-body" aria-busy={loading || saving}>
				{loading ? (
					<p role="status">{t("Loading indexing settings…")}</p>
				) : (
					config && (
						<>
							<section aria-labelledby="source-excluded-directories-title">
								<h3 id="source-excluded-directories-title">{t("Exclude directories")}</h3>
								<p>
									{t("Select folders to leave out. Other folders use the default indexing rules.")}
								</p>
								{config.directories.length > 0 ? (
									<div className="source-excluded-directories">
										{config.directories.map((directory) => (
											<label
												key={directory.name}
												className={directory.automaticallyExcluded ? "is-automatic" : undefined}
											>
												<input
													type="checkbox"
													name="excludedDirectories"
													value={directory.name}
													checked={
														directory.automaticallyExcluded ||
														excludedDirectories.includes(directory.name)
													}
													disabled={saving || directory.automaticallyExcluded}
													onChange={(event) =>
														setExcludedDirectories((current) =>
															event.target.checked
																? [...current, directory.name]
																: current.filter((name) => name !== directory.name),
														)
													}
												/>
												<Folder size={16} aria-hidden="true" />
												<span>{directory.name}</span>
												{directory.automaticallyExcluded && (
													<small>{t("Automatically excluded")}</small>
												)}
											</label>
										))}
									</div>
								) : (
									<p>{t("No subdirectories. Use rules to exclude individual files.")}</p>
								)}
								<p>
									{t(
										"Default rules and ignore files stay in effect. Automatically excluded folders cannot be enabled here.",
									)}
								</p>
							</section>
							<div className="source-index-patterns">
								<label htmlFor="source-exclude-patterns">{t("Additional exclusion rules")}</label>
								<p id="source-exclude-patterns-hint">
									{t("One path or wildcard per line. These rules only exclude files.")}
								</p>
								<textarea
									id="source-exclude-patterns"
									className="field"
									rows={4}
									value={patterns}
									disabled={saving}
									onChange={(event) => setPatterns(event.target.value)}
									aria-describedby="source-exclude-patterns-hint"
									placeholder={"scratch/\n*.generated.json"}
								/>
							</div>
						</>
					)
				)}
				{error && (
					<div className="source-index-settings-error" role="alert">
						<p>{error}</p>
						{!config && (
							<button
								type="button"
								className="secondary-button"
								onClick={() => setRetry((value) => value + 1)}
							>
								{t("Retry")}
							</button>
						)}
					</div>
				)}
			</div>
			<footer className="source-index-settings-footer">
				<p>{t("Settings are saved for this source in Rhyza, without changing its files.")}</p>
				<div>
					<button type="button" className="secondary-button" disabled={saving} onClick={onClose}>
						{t("Cancel")}
					</button>
					<button
						type="button"
						className="command-button"
						disabled={loading || !config || saving}
						onClick={() => void save()}
					>
						{saving ? t("Saving and reindexing…") : t("Save and reindex")}
					</button>
				</div>
			</footer>
		</dialog>
	);
}
