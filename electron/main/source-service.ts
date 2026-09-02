import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { SourceInfo, SourceSearchHit, SourceSearchRequest } from "../../src/shared/ipc.js";
import { rankSourceEvidence, sourcePathAuthority } from "../../src/shared/source-ranking.js";

const execFileAsync = promisify(execFile);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "bin", "obj", ".next", ".cache"]);
const textExtensions = new Set([".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".html", ".java", ".js", ".json", ".jsx", ".kt", ".md", ".mjs", ".py", ".rs", ".sh", ".sql", ".swift", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml"]);

interface PersistedSource extends SourceInfo { files: string[] }

export interface SourceReadResult {
	sourceId: string;
	path: string;
	lineStart: number;
	lineEnd: number;
	content: string;
	revision?: string;
}

export class SourceService {
	private readonly catalogDirectory: string;
	private readonly sourcePromises = new Map<string, Promise<PersistedSource[]>>();

	constructor(dataRoot: string, private readonly getWorkspacePath: () => Promise<string>) {
		this.catalogDirectory = path.join(dataRoot, "sources");
	}

	async list(workspacePath?: string): Promise<SourceInfo[]> {
		return (await this.load(workspacePath)).sources.map(stripFiles);
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

	async search(request: SourceSearchRequest, workspacePath?: string): Promise<SourceSearchHit[]> {
		if (!request.query) return [];
		const terms = request.query.toLocaleLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter((term) => term.length >= 2).slice(0, 12);
		if (terms.length === 0) return [];
		const limit = request.limit ?? 30;
		const sources = (await this.load(workspacePath)).sources.filter(
			(source) => source.status === "indexed" && (!request.sourceId || source.id === request.sourceId),
		);
		const hits: SourceSearchHit[] = [];
		const candidateLimit = Math.max(200, limit * 20);
		for (const source of sources) {
			const rankedFiles = [...source.files].sort((left, right) => sourcePathAuthority(right) - sourcePathAuthority(left));
			for (const relativePath of rankedFiles) {
				if (hits.length >= candidateLimit) break;
				try {
					const content = await readFile(path.join(source.path, relativePath), "utf8");
					const lines = content.split(/\r?\n/);
					let fileHits = 0;
					for (let index = 0; index < lines.length; index += 1) {
						const searchable = `${relativePath} ${lines[index]}`.toLocaleLowerCase();
						if (!terms.some((term) => searchable.includes(term))) continue;
						hits.push({ sourceId: source.id, path: relativePath, line: index + 1, preview: lines[index].trim().slice(0, 240) });
						fileHits += 1;
						if (fileHits >= 3 || hits.length >= candidateLimit) break;
					}
				} catch {
					// Files can disappear between indexing and searching.
				}
			}
		}
		return rankSourceEvidence(hits, request.query, limit);
	}

	async read(sourceId: string, relativePath: string, lineStart = 1, lineEnd?: number, workspacePath?: string): Promise<SourceReadResult> {
		const source = (await this.load(workspacePath)).sources.find(
			(item) => item.id === sourceId && item.status === "indexed",
		);
		if (!source) throw new Error("Indexed source not found.");
		if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) {
			throw new Error("Source paths must be relative and cannot leave the source directory.");
		}
		const indexedPath = source.files.find((candidate) => sameRelativePath(candidate, relativePath));
		if (!indexedPath) throw new Error("File is not part of the indexed source.");
		const content = await readFile(path.join(source.path, indexedPath), "utf8");
		const lines = content.split(/\r?\n/);
		const start = Math.max(1, Math.floor(lineStart));
		const end = Math.min(lines.length, Math.max(start, Math.floor(lineEnd ?? start + 119)), start + 199);
		return {
			sourceId: source.id,
			path: indexedPath,
			lineStart: start,
			lineEnd: end,
			content: lines.slice(start - 1, end).join("\n").slice(0, 32_000),
			revision: source.revision,
		};
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

	private async load(workspacePathOverride?: string): Promise<{ catalogPath: string; sources: PersistedSource[] }> {
		const workspacePath = workspacePathOverride ?? await this.getWorkspacePath();
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

function sameRelativePath(left: string, right: string): boolean {
	const normalizedLeft = path.normalize(left);
	const normalizedRight = path.normalize(right);
	return process.platform === "win32"
		? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
		: normalizedLeft === normalizedRight;
}
