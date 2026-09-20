import clsx from "clsx";
import { Archive, FileCode, FolderGit2, Plus, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRhyzaBridge } from "../hooks/useRhyzaBridge";
import type { SourceSearchHit } from "../shared/ipc";
import { useAppStore } from "../store";

const Sources = () => {
	const { sources, entities, relations, diagrams, upsertSources, setSourceStatus, archiveSource } =
		useAppStore();
	const [busy, setBusy] = useState(false);
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SourceSearchHit[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [searching, setSearching] = useState(false);
	const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [archivingIds, setArchivingIds] = useState<string[]>([]);
	const searchRequest = useRef(0);
	const activeSources = sources.filter((source) => source.status !== "archived");
	const indexedCount = activeSources.filter((source) => source.status === "indexed").length;
	const scanningCount = activeSources.filter((source) => source.status === "scanning").length;
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
		void bridge
			.sourceList()
			.then(upsertSources)
			.catch((reason) => setError(String(reason)))
			.finally(() => setLoading(false));
	}, [upsertSources]);

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

	const archive = async (id: string) => {
		const bridge = getRhyzaBridge();
		if (!bridge) {
			setError("The Electron runtime is required to archive sources.");
			return;
		}
		setError(null);
		setArchivingIds((ids) => [...ids, id]);
		try {
			await bridge.sourceArchive({ id });
			archiveSource(id);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setArchivingIds((ids) => ids.filter((item) => item !== id));
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
					<h1 className="page-title">Sources</h1>
					<p className="page-subtitle">Indexed repositories and documentation directories.</p>
				</div>
				<button
					type="button"
					onClick={() => void addSources()}
					disabled={busy}
					className="command-button"
				>
					{busy ? <RefreshCw size={17} className="animate-spin" /> : <Plus size={17} />}
					{busy ? "Adding sources…" : "Add sources"}
				</button>
			</header>
			<form
				className="sources-search"
				role="search"
				aria-label="Search indexed sources"
				onSubmit={(event) => {
					event.preventDefault();
					void search();
				}}
			>
				<div className="sources-search-field">
					<Search size={17} aria-hidden="true" />
					<label htmlFor="sources-query" className="sr-only">
						Search indexed source text
					</label>
					<input
						id="sources-query"
						type="search"
						value={query}
						onChange={(event) => updateQuery(event.target.value)}
						placeholder="Search indexed source text"
						className="field field-with-icon"
					/>
					{query && (
						<button
							type="button"
							className="sources-search-clear"
							onClick={() => updateQuery("")}
							aria-label="Clear search"
							title="Clear search"
						>
							<X size={15} />
						</button>
					)}
				</div>
				<button type="submit" className="secondary-button" disabled={!query.trim() || searching}>
					{searching ? "Searching…" : "Search"}
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
							<h2 id="sources-results-title">Search results</h2>
							<span role="status">
								{searching
									? "Searching…"
									: `${hits.length === 50 ? "First " : ""}${hits.length} ${hits.length === 1 ? "match" : "matches"}`}
							</span>
						</div>
						{searchedQuery !== null && hits.length === 0 && (
							<div className="sources-no-results">
								<Search size={20} aria-hidden="true" />
								<h3>No matching source text</h3>
								<p>
									No results for “{searchedQuery}”. Try a different term or reindex your sources.
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
							Workspace sources <span className="library-count">{activeSources.length}</span>
						</h2>
						{activeSources.length > 0 && (
							<span>
								{indexedCount} indexed{scanningCount > 0 ? ` · ${scanningCount} scanning` : ""}
							</span>
						)}
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
											<span>{source.type === "repo" ? "Repository" : "Documentation"}</span>
											<span>
												{source.fileCount} text {source.fileCount === 1 ? "file" : "files"}
											</span>
											{source.revision && (
												<span title={source.revision}>{source.revision.slice(0, 10)}</span>
											)}
											{staleRefs > 0 && (
												<span>
													{staleRefs} stale {staleRefs === 1 ? "reference" : "references"}
												</span>
											)}
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
										{source.status}
									</span>
									<div className="source-actions">
										<button
											type="button"
											title="Reindex"
											aria-label={`Reindex ${source.name}`}
											disabled={source.status === "scanning" || archivingIds.includes(source.id)}
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
											title="Archive source"
											aria-label={`Archive source ${source.name}`}
											disabled={archivingIds.includes(source.id)}
											onClick={() => void archive(source.id)}
											className="icon-button"
										>
											<Archive size={17} />
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
							<h2>{loading ? "Loading sources…" : "No sources yet"}</h2>
							<p>
								{loading
									? "Reading the workspace index."
									: "Add a repository or documentation folder to build the workspace index."}
							</p>
						</div>
					)}
				</section>
			</div>
		</div>
	);
};

export default Sources;
