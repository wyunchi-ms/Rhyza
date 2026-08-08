import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { SourceInfo, SourceSearchHit, SourceSearchRequest } from "../../src/shared/ipc.js";

const execFileAsync = promisify(execFile);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "bin", "obj", ".next", ".cache"]);
const textExtensions = new Set([".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".html", ".java", ".js", ".json", ".jsx", ".kt", ".md", ".mjs", ".py", ".rs", ".sh", ".sql", ".swift", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml"]);

interface PersistedSource extends SourceInfo { files: string[] }

export class SourceService {
	private readonly catalogDirectory: string;
	private readonly sourcePromises = new Map<string, Promise<PersistedSource[]>>();

	constructor(dataRoot: string, private readonly getWorkspacePath: () => Promise<string>) {
		this.catalogDirectory = path.join(dataRoot, "sources");
	}

	async list(): Promise<SourceInfo[]> {
		return (await this.load()).sources.map(stripFiles);
	}

	async add(sourcePaths: string[]): Promise<SourceInfo[]> {
		const { catalogPath, sources } = await this.load();
		const added: SourceInfo[] = [];
		for (const sourcePath of sourcePaths) {
			const resolved = path.resolve(sourcePath);
			const existing = sources.find((source) => path.normalize(source.path) === path.normalize(resolved));
			if (existing) {
				existing.status = "scanning";
				Object.assign(existing, await this.indexSource(existing));
				added.push(stripFiles(existing));
				continue;
			}
			const source: PersistedSource = {
				id: `source_${crypto.randomUUID()}`,
				name: path.basename(resolved),
				path: resolved,
				fileCount: 0,
				status: "scanning",
				type: await isGitRepository(resolved) ? "repo" : "docs",
				files: [],
			};
			sources.push(source);
			Object.assign(source, await this.indexSource(source));
			added.push(stripFiles(source));
		}
		await this.save(catalogPath, sources);
		return added;
	}

	async refresh(id: string): Promise<SourceInfo> {
		const { catalogPath, sources } = await this.load();
		const source = sources.find((item) => item.id === id);
		if (!source) throw new Error("Source not found.");
		source.status = "scanning";
		Object.assign(source, await this.indexSource(source));
		await this.save(catalogPath, sources);
		return stripFiles(source);
	}

	async archive(id: string): Promise<SourceInfo> {
		const { catalogPath, sources } = await this.load();
		const source = sources.find((item) => item.id === id);
		if (!source) throw new Error("Source not found.");
		source.status = "archived";
		await this.save(catalogPath, sources);
		return stripFiles(source);
	}

	async search(request: SourceSearchRequest): Promise<SourceSearchHit[]> {
		if (!request.query) return [];
		const terms = request.query.toLocaleLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter((term) => term.length >= 2).slice(0, 12);
		if (terms.length === 0) return [];
		const limit = request.limit ?? 30;
		const sources = (await this.load()).sources.filter(
			(source) => source.status === "indexed" && (!request.sourceId || source.id === request.sourceId),
		);
		const hits: SourceSearchHit[] = [];
		for (const source of sources) {
			for (const relativePath of source.files) {
				if (hits.length >= limit) return hits;
				try {
					const content = await readFile(path.join(source.path, relativePath), "utf8");
					const lines = content.split(/\r?\n/);
					for (let index = 0; index < lines.length; index += 1) {
						const searchable = `${relativePath} ${lines[index]}`.toLocaleLowerCase();
						if (!terms.some((term) => searchable.includes(term))) continue;
						hits.push({ sourceId: source.id, path: relativePath, line: index + 1, preview: lines[index].trim().slice(0, 240) });
						if (hits.length >= limit) return hits;
					}
				} catch {
					// Files can disappear between indexing and searching.
				}
			}
		}
		return hits;
	}

	private async indexSource(source: PersistedSource): Promise<Partial<PersistedSource>> {
		try {
			const files = await collectTextFiles(source.path);
			return {
				files,
				fileCount: files.length,
				status: "indexed",
				indexedAt: new Date().toISOString(),
				revision: source.type === "repo" ? await gitRevision(source.path) : undefined,
				error: undefined,
			};
		} catch (error) {
			return { status: "error", error: error instanceof Error ? error.message : String(error) };
		}
	}

	private async load(): Promise<{ catalogPath: string; sources: PersistedSource[] }> {
		const workspacePath = await this.getWorkspacePath();
		const catalogPath = path.join(this.catalogDirectory, `${workspaceId(workspacePath)}.json`);
		let sourcesPromise = this.sourcePromises.get(catalogPath);
		if (!sourcesPromise) {
			sourcesPromise = (async () => {
			try {
				return JSON.parse(await readFile(catalogPath, "utf8")) as PersistedSource[];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
				throw error;
			}
			})();
			this.sourcePromises.set(catalogPath, sourcesPromise);
		}
		return { catalogPath, sources: await sourcesPromise };
	}

	private async save(catalogPath: string, sources: PersistedSource[]): Promise<void> {
		await mkdir(path.dirname(catalogPath), { recursive: true });
		const tempPath = `${catalogPath}.${process.pid}.tmp`;
		await writeFile(tempPath, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
		await rename(tempPath, catalogPath);
	}
}

function workspaceId(workspacePath: string): string {
	const normalized = path.normalize(path.resolve(workspacePath));
	const key = process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
	return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

async function collectTextFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	const pending = [root];
	while (pending.length && files.length < 50_000) {
		const current = pending.pop()!;
		for (const entry of await readdir(current, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) continue;
			const absolute = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (!ignoredDirectories.has(entry.name)) pending.push(absolute);
			} else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLocaleLowerCase())) {
				const details = await stat(absolute);
				if (details.size <= 2_000_000) files.push(path.relative(root, absolute));
			}
		}
	}
	return files;
}

async function isGitRepository(directory: string): Promise<boolean> {
	try {
		await execFileAsync("git", ["-C", directory, "rev-parse", "--is-inside-work-tree"], { windowsHide: true });
		return true;
	} catch {
		return false;
	}
}

async function gitRevision(directory: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["-C", directory, "rev-parse", "HEAD"], { windowsHide: true });
		return stdout.trim();
	} catch {
		return undefined;
	}
}

function stripFiles(source: PersistedSource): SourceInfo {
	const { files: _files, ...info } = source;
	return info;
}
