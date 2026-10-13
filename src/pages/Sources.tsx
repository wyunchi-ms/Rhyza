import clsx from "clsx";
import { FileCode, FolderGit2, Plus, RefreshCw, Search, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRhyzaBridge } from "../hooks/useRhyzaBridge";
import type { SourceInfo, SourceSearchHit, WorkspaceInfo } from "../shared/ipc";
import { WorkspacePicker } from "../components/WorkspacePicker";
import { SourceIndexSettings } from "../components/SourceIndexSettings";
import { SourceRemovalDialog } from "../components/SourceRemovalDialog";
import { loadWorkspaceState, setWorkspacePersistencePath, useAppStore } from "../store";
import { errorToMessage } from "../shared/value";
import { useTranslation } from "../i18n";

const sourceStatusLabels: Record<string, string> = {
	indexed: "已索引",
	scanning: "索引中",
	error: "错误",
	archived: "已归档",
	pending: "待处理",
	stale: "已过期",
};

const Sources = () => {
	const { t } = useTranslation();
	const {
		sources,
		entities,
		relations,
		diagrams,
		upsertSources,
		syncSources,
		setSourceStatus,
		removeSource,
	} = useAppStore();
	const [busy, setBusy] = useState(false);
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SourceSearchHit[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [searching, setSearching] = useState(false);
	const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [removingSource, setRemovingSource] = useState<SourceInfo | null>(null);
	const [workspacePath, setWorkspacePath] = useState<string | null>(null);
	const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
	const [workspaceError, setWorkspaceError] = useState<string | null>(null);
	const [configuringSource, setConfiguringSource] = useState<SourceInfo | null>(null);
	const searchRequest = useRef(0);
	const activeSources = sources.filter((source) => source.status !== "archived");
	const sourceRefs = [
		...entities.flatMap((entity) => entity.sourceRefs),
		...relations.flatMap((relation) => relation.sourceRefs),
		...diagrams.flatMap((diagram) => diagram.sourceRefs ?? []),
	];

	useEffect(() => {
		const bridge = getRhyzaBridge();
		if (!bridge) {
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		void bridge
			.sourceList()
			.then((items) => {
				if (!cancelled) syncSources(items);
			})
			.catch((reason) => {
				if (!cancelled) setError(String(reason));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [syncSources, workspacePath]);

	useEffect(() => {
		const bridge = getRhyzaBridge();
		if (!bridge) return;
		let cancelled = false;
		void bridge.getWorkspace().then(
			(workspace) => {
				if (!cancelled) setWorkspacePath(workspace.path);
			},
			(reason: unknown) => {
				if (!cancelled) setWorkspaceError(errorToMessage(reason));
			},
		);
		return () => {
			cancelled = true;
		};
	}, []);

	const changeWorkspace = async (workspace: WorkspaceInfo) => {
		const bridge = getRhyzaBridge();
		if (!bridge || !workspace.path) throw new Error("The Electron workspace is unavailable.");
		const serialized = await bridge.appStateLoad();
		setWorkspacePersistencePath(workspace.path);
		loadWorkspaceState(serialized);
		setWorkspacePath(workspace.path);
		setWorkspaceError(null);
		setError(null);
		updateQuery("");
	};

	const addSources = async () => {
		const bridge = getRhyzaBridge();
		if (!bridge) {
			setError("The Electron runtime is required to add sources.");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			upsertSources(await bridge.sourceAdd());
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	};

	const refresh = async (id: string) => {
		const bridge = getRhyzaBridge();
		if (!bridge) {
			setError("The Electron runtime is required to reindex sources.");
			return;
		}
		setSourceStatus(id, { status: "scanning", error: undefined });
		try {
			upsertSources([await bridge.sourceRefresh({ id })]);
		} catch (reason) {
			setSourceStatus(id, { status: "error", error: String(reason) });
		}
	};

	const search = async () => {
		const searchQuery = query.trim();
		if (!searchQuery || searching) return;
		const bridge = getRhyzaBridge();
		if (!bridge) {
			setSearchError("The Electron runtime is required to search sources.");
			return;
		}
		const request = ++searchRequest.current;
		setSearching(true);
		setSearchError(null);
		setSearchedQuery(null);
		setHits([]);
		try {
			const results = await bridge.sourceSearch({ query: searchQuery, limit: 50 });
			if (request !== searchRequest.current) return;
			setHits(results);
			setSearchedQuery(searchQuery);
		} catch (reason) {
			if (request === searchRequest.current)
				setSearchError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			if (request === searchRequest.current) setSearching(false);
		}
	};

	const updateQuery = (value: string) => {
		searchRequest.current += 1;
		setQuery(value);
		setHits([]);
		setSearchedQuery(null);
		setSearchError(null);
		setSearching(false);
	};

	return (
		<div className="page-shell library-page sources-page">
			<header className="page-header library-page-header">
				<div>
					<h1 className="page-title">{t("Workspace")}</h1>
					<p className="page-subtitle">{t("Manage the working directory and indexed sources.")}</p>
				</div>
			</header>
			<section className="sources-workspace-card" aria-labelledby="sources-workspace-heading">
				<div className="sources-workspace-copy">
					<h2 id="sources-workspace-heading">{t("Current workspace")}</h2>
					<p className="sources-workspace-path" title={workspacePath ?? undefined}>
						{workspacePath ?? t("No workspace selected.")}
					</p>
					{workspaceError && (
						<p className="sources-workspace-error" role="alert">
							{workspaceError}
						</p>
					)}
				</div>
				<button
					type="button"
					className="secondary-button"
					disabled={!getRhyzaBridge()?.isElectron}
					onClick={() => setWorkspacePickerOpen(true)}
				>
					{workspacePath ? t("Change workspace") : t("Choose workspace")}
				</button>
			</section>
			{workspacePickerOpen && (
				<WorkspacePicker
					currentPath={workspacePath}
					onSelect={changeWorkspace}
					onClose={() => setWorkspacePickerOpen(false)}
				/>
			)}
			{configuringSource && (
				<SourceIndexSettings
					source={configuringSource}
					onSaved={(source) => {
						upsertSources([source]);
						updateQuery("");
					}}
					onClose={() => setConfiguringSource(null)}
				/>
			)}
			{removingSource && (
				<SourceRemovalDialog
					source={removingSource}
					onRemoved={(id) => {
						removeSource(id);
						updateQuery("");
						setError(null);
					}}
					onClose={() => setRemovingSource(null)}
				/>
			)}
			<form
				className="sources-search"
				role="search"
				aria-label={t("Search indexed sources")}
				onSubmit={(event) => {
					event.preventDefault();
					void search();
				}}
			>
				<div className="sources-search-field">
					<Search size={17} aria-hidden="true" />
					<label htmlFor="sources-query" className="sr-only">
						{t("Search indexed source text")}
					</label>
					<input
						id="sources-query"
						type="search"
						value={query}
						onChange={(event) => updateQuery(event.target.value)}
						placeholder={t("Search indexed source text")}
						className="field field-with-icon"
					/>
					{query && (
						<button
							type="button"
							className="sources-search-clear"
							onClick={() => updateQuery("")}
							aria-label={t("Clear search")}
							title={t("Clear search")}
						>
							<X size={15} />
						</button>
					)}
				</div>
				<button type="submit" className="secondary-button" disabled={!query.trim() || searching}>
					{searching ? t("Searching…") : t("Search")}
				</button>
			</form>
			{error && (
				<p className="library-feedback is-error" role="alert">
					{error}
				</p>
			)}
			{searchError && (
				<p className="library-feedback is-error" role="alert">
					{searchError}
				</p>
			)}
			<div className="sources-content">
				{(searching || searchedQuery !== null) && (
					<section
						className="sources-results"
						aria-labelledby="sources-results-title"
						aria-busy={searching}
					>
						<div className="library-section-heading">
							<h2 id="sources-results-title">{t("Search results")}</h2>
							<span role="status">
								{searching
									? "正在搜索…"
									: `${hits.length === 50 ? "前 " : "共 "}${hits.length} 条匹配结果`}
							</span>
						</div>
						{searchedQuery !== null && hits.length === 0 && (
							<div className="sources-no-results">
								<Search size={20} aria-hidden="true" />
								<h3>{t("No matching source text")}</h3>
								<p>
									{t("No results for “")}
									{searchedQuery}
									{t(". Try a different term or reindex your sources.")}
								</p>
							</div>
						)}
						{hits.map((hit) => (
							<article
								key={`${hit.sourceId}-${hit.path}-${hit.line}`}
								className="sources-search-hit"
							>
								<h3>
									{hit.path}:{hit.line}
								</h3>
								<p>{hit.preview}</p>
							</article>
						))}
					</section>
				)}
				<section
					className="sources-catalog"
					aria-labelledby="sources-catalog-title"
					aria-busy={loading}
				>
					<div className="library-section-heading">
						<h2 id="sources-catalog-title">
							{t("Sources")} <span className="library-count">{activeSources.length}</span>
						</h2>
						<button
							type="button"
							onClick={() => void addSources()}
							disabled={busy || loading}
							className="command-button sources-add-button"
							aria-label={busy ? t("Adding sources…") : t("Add sources")}
							title={busy ? t("Adding sources…") : t("Add sources")}
							aria-busy={busy}
						>
							{busy ? (
								<RefreshCw size={17} className="animate-spin" aria-hidden="true" />
							) : (
								<Plus size={17} aria-hidden="true" />
							)}
						</button>
					</div>
					<div className="sources-list">
						{activeSources.map((source) => {
							const staleRefs = sourceRefs.filter(
								(ref) => ref.sourceId === source.id && ref.stale,
							).length;
							return (
								<article key={source.id} className="source-row">
									<div className="source-type-icon" aria-hidden="true">
										{source.type === "repo" ? <FolderGit2 size={21} /> : <FileCode size={21} />}
									</div>
									<div className="source-details">
										<h3 title={source.name}>{source.name}</h3>
										<p className="source-path" title={source.path}>
											{source.path}
										</p>
										<p className="source-metadata">
											<span>{source.type === "repo" ? t("Repository") : t("Documentation")}</span>
											<span>
												{source.fileCount} text {source.fileCount === 1 ? "file" : "files"}
											</span>
											{source.revision && (
												<span title={source.revision}>{source.revision.slice(0, 10)}</span>
											)}
											{staleRefs > 0 && <span>{staleRefs} 个来源引用已过期</span>}
										</p>
										{source.error && (
											<p className="source-error" role="alert">
												{source.error}
											</p>
										)}
									</div>
									<span
										className={clsx(
											"status-badge source-status",
											source.status === "indexed"
												? "status-success"
												: source.status === "error"
													? "status-error"
													: "status-progress",
										)}
									>
										{sourceStatusLabels[source.status] ?? source.status}
									</span>
									<div className="source-actions">
										<button
											type="button"
											title={t("Indexing settings")}
											aria-label={`${t("Indexing settings")}: ${source.name}`}
											disabled={
												!getRhyzaBridge()?.isElectron ||
												source.status === "scanning" ||
												removingSource?.id === source.id
											}
											onClick={() => setConfiguringSource(source)}
											className="icon-button source-index-settings-open"
										>
											<Settings2 size={17} />
										</button>
										<button
											type="button"
											title="重新索引"
											aria-label={`重新索引：${source.name}`}
											disabled={source.status === "scanning" || removingSource?.id === source.id}
											onClick={() => void refresh(source.id)}
											className="icon-button"
										>
											<RefreshCw
												size={17}
												className={clsx(source.status === "scanning" && "animate-spin")}
											/>
										</button>
										<button
											type="button"
											title={t("Delete source")}
											aria-label={`${t("Delete source")}: ${source.name}`}
											disabled={
												!getRhyzaBridge()?.isElectron ||
												loading ||
												busy ||
												source.status === "scanning"
											}
											onClick={() => setRemovingSource(source)}
											className="icon-button source-remove-button"
										>
											<Trash2 size={17} />
										</button>
									</div>
								</article>
							);
						})}
					</div>
					{activeSources.length === 0 && (
						<div className="empty-state sources-empty-state">
							<span className="library-empty-icon" aria-hidden="true">
								<FolderGit2 size={24} />
							</span>
							<h2>{loading ? t("Loading sources…") : t("No sources yet")}</h2>
							<p>
								{loading
									? t("Reading the workspace index.")
									: t("Add a repository or documentation folder to build the workspace index.")}
							</p>
						</div>
					)}
				</section>
			</div>
		</div>
	);
};

export default Sources;
