import { readFileSync } from "node:fs";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceHistoryEntry } from "../../src/shared/ipc.js";
import { isRecord } from "../../src/shared/value.js";

interface PersistedSettings {
	workspacePath: string | null;
	workspaceHistory?: WorkspaceHistoryEntry[];
}

const defaultSettings: PersistedSettings = { workspacePath: null };
const legacyProductSlug = ["know", "branch"].join("");

export class SettingsStore {
	private readonly settingsPath: string;
	private readonly legacySettingsPath?: string;
	private readonly workspaceIndexPath: string;
	private settingsQueue: Promise<unknown> = Promise.resolve();

	constructor(dataRoot: string, legacyUserDataPath?: string) {
		this.settingsPath = path.join(dataRoot, "settings.json");
		this.workspaceIndexPath = path.join(dataRoot, "workspaces.json");
		this.legacySettingsPath = legacyUserDataPath
			? path.join(legacyUserDataPath, `${legacyProductSlug}-settings.json`)
			: undefined;
	}

	async getWorkspacePath(): Promise<string | null> {
		return this.withSettings(async (settings) => settings.workspacePath);
	}

	async getWorkspaceHistory(): Promise<WorkspaceHistoryEntry[]> {
		return this.withSettings(async (settings) => settings.workspaceHistory ?? []);
	}

	getWorkspacePathSync(): string | null {
		for (const settingsPath of [this.settingsPath, this.legacySettingsPath]) {
			if (!settingsPath) continue;
			try {
				return parseSettings(readFileSync(settingsPath, "utf8")).workspacePath;
			} catch (error) {
				if (!isMissingFileError(error)) throw error;
			}
		}
		return null;
	}

	async setWorkspacePath(workspacePath: string | null): Promise<void> {
		await this.withSettings(async (settings) => {
			const canonicalPath = workspacePath ? await requireWorkspaceDirectory(workspacePath) : null;
			await this.writeWorkspace(settings, canonicalPath);
		});
	}

	async switchWorkspace(workspacePath: string): Promise<void> {
		await this.withSettings(async (settings) => {
			if (!settings.workspaceHistory?.some((entry) => sameWorkspace(entry.path, workspacePath))) {
				throw new Error("This workspace is not in your history. Add it using the folder picker.");
			}
			const canonicalPath = await requireWorkspaceDirectory(workspacePath);
			await this.writeWorkspace(settings, canonicalPath);
		});
	}

	async requireWorkspacePath(): Promise<string> {
		const workspacePath = await this.getWorkspacePath();
		if (!workspacePath) {
			throw new Error("Choose a workspace folder before chatting.");
		}
		return requireWorkspaceDirectory(workspacePath);
	}

	private withSettings<T>(operation: (settings: PersistedSettings) => Promise<T>): Promise<T> {
		const result = this.settingsQueue.then(async () => operation(await this.readSettings()));
		// Keep later operations runnable; the original promise still rejects to its caller.
		this.settingsQueue = result.catch(() => undefined);
		return result;
	}

	private async writeWorkspace(
		settings: PersistedSettings,
		workspacePath: string | null,
	): Promise<void> {
		const history = settings.workspaceHistory ?? [];
		await this.writeSettings({
			...settings,
			workspacePath,
			workspaceHistory: workspacePath
				? [
						{ path: workspacePath, lastUsedAt: new Date().toISOString() },
						...history.filter((entry) => !sameWorkspace(entry.path, workspacePath)),
					]
				: history,
		});
	}

	private async readSettings(): Promise<PersistedSettings> {
		let settings = { ...defaultSettings };
		let needsMigration = false;
		for (const [index, settingsPath] of [this.settingsPath, this.legacySettingsPath].entries()) {
			if (!settingsPath) continue;
			try {
				settings = parseSettings(await readFile(settingsPath, "utf8"));
				needsMigration = index > 0;
				break;
			} catch (error) {
				if (!isMissingFileError(error)) throw error;
			}
		}
		if (!settings.workspaceHistory) {
			const history = await this.readPreviousWorkspaces();
			const currentPath = settings.workspacePath;
			settings.workspaceHistory = currentPath
				? [
						{ path: currentPath, lastUsedAt: new Date().toISOString() },
						...history.filter((entry) => !sameWorkspace(entry.path, currentPath)),
					]
				: history;
			needsMigration = true;
		}
		if (needsMigration) await this.writeSettings(settings);
		return settings;
	}

	private async readPreviousWorkspaces(): Promise<WorkspaceHistoryEntry[]> {
		let raw: string;
		try {
			raw = await readFile(this.workspaceIndexPath, "utf8");
		} catch (error) {
			if (isMissingFileError(error)) return [];
			throw error;
		}
		const index: unknown = JSON.parse(raw);
		if (!isRecord(index) || !isRecord(index.workspaces)) {
			throw new Error("Invalid workspace index.");
		}
		return deduplicateHistory(
			Object.entries(index.workspaces)
				.map(([workspacePath, entry]) => {
					if (
						!workspacePath.trim() ||
						!isRecord(entry) ||
						typeof entry.updatedAt !== "string" ||
						!Number.isFinite(Date.parse(entry.updatedAt))
					) {
						throw new Error("Invalid workspace index entry.");
					}
					return { path: workspacePath, lastUsedAt: entry.updatedAt };
				})
				.sort((left, right) => (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "")),
		);
	}

	private async writeSettings(settings: PersistedSettings): Promise<void> {
		await mkdir(path.dirname(this.settingsPath), { recursive: true });
		const temporaryPath = `${this.settingsPath}.tmp`;
		await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
		await rename(temporaryPath, this.settingsPath);
	}
}

function parseSettings(raw: string): PersistedSettings {
	const parsed: unknown = JSON.parse(raw);
	if (!isRecord(parsed)) throw new Error("Invalid workspace settings.");
	if (parsed.workspaceHistory !== undefined && !Array.isArray(parsed.workspaceHistory)) {
		throw new Error("Invalid workspace history.");
	}
	const history = parsed.workspaceHistory?.map((entry: unknown) => {
		if (
			!isRecord(entry) ||
			typeof entry.path !== "string" ||
			!entry.path.trim() ||
			(entry.lastUsedAt !== null &&
				(typeof entry.lastUsedAt !== "string" || !Number.isFinite(Date.parse(entry.lastUsedAt))))
		) {
			throw new Error("Invalid workspace history entry.");
		}
		return { path: entry.path, lastUsedAt: entry.lastUsedAt };
	});
	return {
		workspacePath: typeof parsed.workspacePath === "string" ? parsed.workspacePath : null,
		workspaceHistory: history ? deduplicateHistory(history) : undefined,
	};
}

function sameWorkspace(left: string, right: string): boolean {
	const normalize = (value: string) => {
		const normalized = path.resolve(value);
		return process.platform === "win32" ? normalized.toLowerCase() : normalized;
	};
	return normalize(left) === normalize(right);
}

function deduplicateHistory(history: WorkspaceHistoryEntry[]): WorkspaceHistoryEntry[] {
	return history.filter(
		(entry, index) =>
			history.findIndex((candidate) => sameWorkspace(candidate.path, entry.path)) === index,
	);
}

async function requireWorkspaceDirectory(workspacePath: string): Promise<string> {
	const canonicalPath = await canonicalizeWorkspacePath(workspacePath);
	if (!(await stat(canonicalPath)).isDirectory()) {
		throw new Error("The workspace path must be a directory.");
	}
	return canonicalPath;
}

export async function canonicalizeWorkspacePath(workspacePath: string): Promise<string> {
	return realpath(path.resolve(workspacePath));
}

export async function assertPathInsideWorkspace(
	workspacePath: string,
	candidatePath: string,
): Promise<string> {
	const workspaceRoot = await canonicalizeWorkspacePath(workspacePath);
	const candidate = await canonicalizeWorkspacePath(candidatePath);
	const relative = path.relative(workspaceRoot, candidate);
	if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
		return candidate;
	}
	throw new Error("Path is outside the selected workspace.");
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}
