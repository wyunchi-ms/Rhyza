import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	validateSourceIndexingOptions,
	type SourceInfo,
	type SourceSearchHit,
	type SourceSearchRequest,
	type SourceIndexingOptions,
	type SourceIndexingConfig,
	type SourceIndexingSaveRequest,
} from "../../src/shared/ipc.js";
import { rankSourceEvidence, sourcePathAuthority } from "../../src/shared/source-ranking.js";
import { SourceFilePolicy } from "./source-file-policy.js";

const execFileAsync = promisify(execFile);
const textExtensions = new Set([
	".c",
	".cc",
	".cpp",
	".cs",
	".css",
	".go",
	".h",
	".html",
	".java",
	".js",
	".json",
	".jsx",
	".kt",
	".md",
	".mjs",
	".py",
	".rs",
	".sh",
	".sql",
	".swift",
	".toml",
	".ts",
	".tsx",
	".txt",
	".xml",
	".yaml",
	".yml",
]);

interface PersistedSource extends SourceInfo {
	files: string[];
	indexing?: SourceIndexingOptions;
}

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

	constructor(
		dataRoot: string,
		private readonly getWorkspacePath: () => Promise<string>,
	) {
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
			const existing = sources.find(
				(source) => path.normalize(source.path) === path.normalize(resolved),
			);
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
				type: (await isGitRepository(resolved)) ? "repo" : "docs",
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

	async remove(id: string): Promise<void> {
		const { catalogPath, sources } = await this.load();
		const source = sources.find((item) => item.id === id);
		if (!source) throw new Error("Source not found.");
		await this.save(
			catalogPath,
			sources.filter((item) => item.id !== id),
		);
		const index = sources.indexOf(source);
		if (index >= 0) sources.splice(index, 1);
	}

	async getIndexingConfig(id: string): Promise<SourceIndexingConfig> {
		const source = (await this.load()).sources.find(
			(item) => item.id === id && item.status !== "archived",
		);
		if (!source) throw new Error("Source not found.");
		const options = source.indexing ?? { excludedDirectories: [], excludePatterns: [] };
		const entries = await readdir(source.path, { withFileTypes: true });
		const names = new Set([
			...entries
				.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
				.map((entry) => entry.name),
			...options.excludedDirectories,
		]);
		const baseline = new SourceFilePolicy(source.path);
		const directories = await Promise.all(
			[...names]
				.sort((left, right) => left.localeCompare(right))
				.map(async (name) => ({
					name,
					automaticallyExcluded: !(await baseline.allows(name, true)),
				})),
		);
		return { id, ...options, directories };
	}

	async saveIndexingConfig(request: SourceIndexingSaveRequest): Promise<SourceInfo> {
		const { catalogPath, sources } = await this.load();
		const source = sources.find((item) => item.id === request.id && item.status !== "archived");
		if (!source) throw new Error("Source not found.");
		const indexing = validateSourceIndexingOptions(request);
		const next = { ...source, indexing };
		const indexed = await this.indexSource(next);
		if (indexed.status !== "indexed") throw new Error(indexed.error ?? "Source reindexing failed.");
		Object.assign(next, indexed);
		await this.save(
			catalogPath,
			sources.map((item) => (item.id === source.id ? next : item)),
		);
		Object.assign(source, next);
		return stripFiles(source);
	}

	async search(request: SourceSearchRequest, workspacePath?: string): Promise<SourceSearchHit[]> {
		if (!request.query) return [];
		const terms = request.query
			.toLocaleLowerCase()
			.split(/[^\p{L}\p{N}_.-]+/u)
			.filter((term) => term.length >= 2)
			.slice(0, 12);
		if (terms.length === 0) return [];
		const limit = request.limit ?? 30;
		const sources = (await this.load(workspacePath)).sources.filter(
			(source) =>
				source.status === "indexed" && (!request.sourceId || source.id === request.sourceId),
		);
		const hits: SourceSearchHit[] = [];
		const candidateLimit = Math.max(200, limit * 20);
		for (const source of sources) {
			const rankedFiles = [...source.files].sort(
				(left, right) => sourcePathAuthority(right) - sourcePathAuthority(left),
			);
			for (const relativePath of rankedFiles) {
				if (hits.length >= candidateLimit) break;
				try {
					const content = await readFile(path.join(source.path, relativePath), "utf8");
					const lines = content.split(/\r?\n/);
					let fileHits = 0;
					for (let index = 0; index < lines.length; index += 1) {
						const searchable = `${relativePath} ${lines[index]}`.toLocaleLowerCase();
						if (!terms.some((term) => searchable.includes(term))) continue;
						hits.push({
							sourceId: source.id,
							path: relativePath,
							line: index + 1,
							preview: lines[index].trim().slice(0, 240),
						});
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

	async read(
		sourceId: string,
		relativePath: string,
		lineStart = 1,
		lineEnd?: number,
		workspacePath?: string,
	): Promise<SourceReadResult> {
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
		const end = Math.min(
			lines.length,
			Math.max(start, Math.floor(lineEnd ?? start + 119)),
			start + 199,
		);
		return {
			sourceId: source.id,
			path: indexedPath,
			lineStart: start,
			lineEnd: end,
			content: lines
				.slice(start - 1, end)
				.join("\n")
				.slice(0, 32_000),
			revision: source.revision,
		};
	}

	private async indexSource(source: PersistedSource): Promise<Partial<PersistedSource>> {
		try {
			const files = await collectTextFiles(source.path, source.indexing);
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

	private async load(
		workspacePathOverride?: string,
	): Promise<{ catalogPath: string; sources: PersistedSource[] }> {
		const workspacePath = workspacePathOverride ?? (await this.getWorkspacePath());
		const catalogPath = path.join(this.catalogDirectory, `${workspaceId(workspacePath)}.json`);
		let sourcesPromise = this.sourcePromises.get(catalogPath);
		if (!sourcesPromise) {
			sourcesPromise = (async () => {
				let sources: PersistedSource[];
				try {
					sources = JSON.parse(await readFile(catalogPath, "utf8")) as PersistedSource[];
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
					throw error;
				}
				let changed = false;
				for (const source of sources) {
					if (source.indexing) source.indexing = validateSourceIndexingOptions(source.indexing);
					if (source.status !== "indexed") continue;
					const policy = new SourceFilePolicy(source.path, source.indexing);
					const files: string[] = [];
					for (const file of source.files) {
						if (await policy.allows(file)) files.push(file);
					}
					if (files.length !== source.files.length) {
						source.files = files;
						source.fileCount = files.length;
						changed = true;
					}
				}
				if (changed) await this.save(catalogPath, sources);
				return sources;
			})();
			this.sourcePromises.set(catalogPath, sourcesPromise);
		}
		try {
			return { catalogPath, sources: await sourcesPromise };
		} catch (error) {
			if (this.sourcePromises.get(catalogPath) === sourcesPromise) {
				this.sourcePromises.delete(catalogPath);
			}
			throw error;
		}
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

async function collectTextFiles(root: string, options?: SourceIndexingOptions): Promise<string[]> {
	const files: string[] = [];
	const pending = [root];
	const policy = new SourceFilePolicy(root, options);
	while (pending.length && files.length < 50_000) {
		const current = pending.pop()!;
		for (const entry of await readdir(current, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) continue;
			const absolute = path.join(current, entry.name);
			const relative = path.relative(root, absolute);
			if (entry.isDirectory()) {
				if (await policy.allows(relative, true)) pending.push(absolute);
			} else if (
				entry.isFile() &&
				textExtensions.has(path.extname(entry.name).toLocaleLowerCase())
			) {
				if (!(await policy.allows(relative))) continue;
				const details = await stat(absolute);
				if (details.size <= 2_000_000) files.push(relative);
			}
		}
	}
	return files;
}

async function isGitRepository(directory: string): Promise<boolean> {
	try {
		await execFileAsync("git", ["-C", directory, "rev-parse", "--is-inside-work-tree"], {
			windowsHide: true,
		});
		return true;
	} catch {
		return false;
	}
}

async function gitRevision(directory: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["-C", directory, "rev-parse", "HEAD"], {
			windowsHide: true,
		});
		return stdout.trim();
	} catch {
		return undefined;
	}
}

function stripFiles(source: PersistedSource): SourceInfo {
	const { files: _files, indexing: _indexing, ...info } = source;
	return info;
}

function sameRelativePath(left: string, right: string): boolean {
	const normalizedLeft = path.normalize(left);
	const normalizedRight = path.normalize(right);
	return process.platform === "win32"
		? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
		: normalizedLeft === normalizedRight;
}
