import clsx from "clsx";
import { Archive, FileCode, FolderGit2, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { getKnowbranchBridge } from "../hooks/useKnowbranchBridge";
import type { SourceSearchHit } from "../shared/ipc";
import { useAppStore } from "../store";

const Sources = () => {
	const { sources, entities, relations, diagrams, upsertSources, setSourceStatus, archiveSource } = useAppStore();
	const [busy, setBusy] = useState(false);
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SourceSearchHit[]>([]);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		void bridge.sourceList().then(upsertSources).catch((reason) => setError(String(reason)));
	}, [upsertSources]);

	const addSources = async () => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		setBusy(true);
		setError(null);
		try { upsertSources(await bridge.sourceAdd()); }
		catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
		finally { setBusy(false); }
	};

	const refresh = async (id: string) => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		setSourceStatus(id, { status: "scanning", error: undefined });
		try { upsertSources([await bridge.sourceRefresh({ id })]); }
		catch (reason) { setSourceStatus(id, { status: "error", error: String(reason) }); }
	};

	const archive = async (id: string) => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		await bridge.sourceArchive({ id });
		archiveSource(id);
	};

	const search = async () => {
		const bridge = getKnowbranchBridge();
		if (!bridge || !query.trim()) return;
		setHits(await bridge.sourceSearch({ query, limit: 50 }));
	};

	return (
		<div className="page-shell">
			<div className="page-header flex-row items-start justify-between">
				<div><h1 className="page-title">Sources</h1><p className="page-subtitle">Indexed repositories and documentation directories.</p></div>
				<button type="button" onClick={() => void addSources()} disabled={busy} className="command-button"><Plus size={17} /> Add sources</button>
			</div>
			<div className="flex gap-2 mb-6">
				<div className="relative flex-1"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="Search indexed source text" className="field field-with-icon" /></div>
				<button type="button" onClick={() => void search()} className="secondary-button">Search</button>
			</div>
			{error && <p className="mb-4 text-sm text-red-600">{error}</p>}
			<div className="flex-1 overflow-y-auto space-y-3">
				{sources.filter((source) => source.status !== "archived").map((source) => {
					const staleRefs = [...entities.flatMap((entity) => entity.sourceRefs), ...relations.flatMap((relation) => relation.sourceRefs), ...diagrams.flatMap((diagram) => diagram.sourceRefs ?? [])].filter((ref) => ref.sourceId === source.id && ref.stale).length;
					return (
					<section key={source.id} className="list-row flex items-center gap-4">
						<div className={clsx("w-10 h-10 rounded-md flex items-center justify-center", source.type === "repo" ? "bg-blue-50 text-accent" : "bg-amber-50 text-amber-700")}>{source.type === "repo" ? <FolderGit2 size={21} /> : <FileCode size={21} />}</div>
						<div className="min-w-0 flex-1"><h2 className="font-bold text-primary truncate">{source.name}</h2><p className="text-xs text-secondary truncate">{source.path}</p><p className="text-xs text-gray-400 mt-1">{source.fileCount} text files{source.revision ? ` / ${source.revision.slice(0, 10)}` : ""}{staleRefs ? ` / ${staleRefs} stale references` : ""}{source.error ? ` / ${source.error}` : ""}</p></div>
						<span className={clsx("status-badge", source.status === "indexed" ? "status-success" : source.status === "error" ? "status-error" : "status-progress")}>{source.status}</span>
						<button type="button" title="Reindex" aria-label="Reindex" disabled={source.status === "scanning"} onClick={() => void refresh(source.id)} className="icon-button"><RefreshCw size={17} className={clsx(source.status === "scanning" && "animate-spin")} /></button>
						<button type="button" title="Archive source" aria-label="Archive source" onClick={() => void archive(source.id)} className="icon-button"><Archive size={17} /></button>
					</section>
				);})}
				{sources.length === 0 && <div className="empty-state">Add a repository or documentation folder to build the workspace index.</div>}
				{hits.length > 0 && <section className="pt-4"><h2 className="font-bold text-primary mb-3">Search results</h2>{hits.map((hit) => <div key={`${hit.sourceId}-${hit.path}-${hit.line}`} className="border-t border-gray-100 py-3"><p className="text-xs font-semibold text-accent">{hit.path}:{hit.line}</p><p className="text-sm text-secondary mt-1 font-mono">{hit.preview}</p></div>)}</section>}
			</div>
		</div>
	);
};

export default Sources;
