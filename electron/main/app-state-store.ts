import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const maxStateBytes = 50 * 1024 * 1024;

interface WorkspaceIndexEntry {
	stateFile: string;
	updatedAt: string;
}

interface WorkspaceIndex {
	version: 1;
	workspaces: Record<string, WorkspaceIndexEntry>;
}

const emptyIndex: WorkspaceIndex = { version: 1, workspaces: {} };

export class AppStateStore {
	private readonly indexPath: string;
	private readonly workspaceDirectory: string;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(private readonly dataRoot: string) {
		this.indexPath = path.join(dataRoot, "workspaces.json");
		this.workspaceDirectory = path.join(dataRoot, "workspaces");
	}

	load(workspacePath: string | null): string | null {
		if (!workspacePath) return null;
		const key = workspaceKey(workspacePath);
		const index = this.readIndexSync();
		const entry = Object.entries(index.workspaces).find(([candidate]) => sameWorkspace(candidate, key))?.[1];
		if (!entry) return null;
		try {
			return readFileSync(path.join(this.dataRoot, entry.stateFile), "utf8");
		} catch (error) {
			if (isMissingFileError(error)) return null;
			throw error;
		}
	}

	async save(workspacePath: string, value: string): Promise<void> {
		const key = workspaceKey(workspacePath);
		validateState(value, key);
		this.writeQueue = this.writeQueue
			.catch(() => undefined)
			.then(async () => {
				await mkdir(this.workspaceDirectory, { recursive: true });
				const stateFile = path.join("workspaces", `${workspaceId(key)}.json`);
				const statePath = path.join(this.dataRoot, stateFile);
				try {
					const previous = await readFile(statePath, "utf8");
					assertNotDestructiveEmptyState(previous, value);
					if (previous !== value) await copyFile(statePath, `${statePath}.backup`);
				} catch (error) {
					if (!isMissingFileError(error)) throw error;
				}
				await writeFile(statePath, value, "utf8");
				const index = await this.readIndex();
				for (const candidate of Object.keys(index.workspaces)) {
					if (candidate !== key && sameWorkspace(candidate, key)) delete index.workspaces[candidate];
				}
				index.workspaces[key] = { stateFile, updatedAt: new Date().toISOString() };
				await writeFile(this.indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
			});
		return this.writeQueue;
	}

	async migrateLegacyState(workspacePath: string | null, legacyStatePath: string): Promise<boolean> {
		if (!workspacePath) return false;
		const currentState = this.load(workspacePath);
		if (currentState !== null) return false;
		try {
			const value = await readFile(legacyStatePath, "utf8");
			await this.save(workspacePath, value);
			return true;
		} catch (error) {
			if (isMissingFileError(error)) return false;
			throw error;
		}
	}

	private readIndexSync(): WorkspaceIndex {
		try {
			return parseIndex(readFileSync(this.indexPath, "utf8"));
		} catch (error) {
			if (isMissingFileError(error)) return { ...emptyIndex, workspaces: {} };
			throw error;
		}
	}

	private async readIndex(): Promise<WorkspaceIndex> {
		try {
			return parseIndex(await readFile(this.indexPath, "utf8"));
		} catch (error) {
			if (isMissingFileError(error)) return { ...emptyIndex, workspaces: {} };
			throw error;
		}
	}
}

function parseIndex(raw: string): WorkspaceIndex {
	const parsed = JSON.parse(raw) as Partial<WorkspaceIndex>;
	return {
		version: 1,
		workspaces:
			typeof parsed.workspaces === "object" && parsed.workspaces !== null
				? parsed.workspaces
				: {},
	};
}

function workspaceKey(workspacePath: string): string {
	return path.normalize(path.resolve(workspacePath));
}

function sameWorkspace(left: string, right: string): boolean {
	return process.platform === "win32"
		? left.toLocaleLowerCase() === right.toLocaleLowerCase()
		: left === right;
}

function workspaceId(key: string): string {
	return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

function validateState(value: string, workspacePath: string): void {
	if (Buffer.byteLength(value, "utf8") > maxStateBytes) {
		throw new Error("Workspace state exceeds the 50 MB storage limit.");
	}
	const parsed = JSON.parse(value) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Workspace state must be a JSON object.");
	}
	const envelope = parsed as Record<string, unknown>;
	if (typeof envelope.workspacePath === "string" && !sameWorkspace(workspaceKey(envelope.workspacePath), workspacePath)) {
		throw new Error("Workspace state payload does not match its destination workspace.");
	}
	const state = isRecord(envelope.state) ? envelope.state : envelope;
	if (Array.isArray(state.diagrams) && state.diagrams.some((diagram) => !isPersistableMermaidDiagram(diagram))) {
		throw new Error("Workspace diagrams must contain valid Mermaid source.");
	}
}

function isPersistableMermaidDiagram(value: unknown): boolean {
	if (!isRecord(value) || typeof value.mermaidSource !== "string") return false;
	const firstLine = value.mermaidSource
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith("%%"));
	return Boolean(firstLine && /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|mindmap|timeline|gitGraph|C4\w*)\b/i.test(firstLine));
}

function assertNotDestructiveEmptyState(previous: string, next: string): void {
	const previousCounts = stateContentCounts(previous);
	const nextCounts = stateContentCounts(next);
	if (previousCounts.total > 0 && nextCounts.total === 0) {
		throw new Error(
			"Refusing to replace non-empty workspace data with an empty application state.",
		);
	}
}

function stateContentCounts(value: string): { total: number } {
	const parsed = JSON.parse(value) as Record<string, unknown>;
	const state = isRecord(parsed.state) ? parsed.state : parsed;
	const collectionNames = [
		"sessions",
		"turns",
		"entities",
		"relations",
		"diagrams",
		"sources",
		"changesets",
	];
	return {
		total: collectionNames.reduce(
			(total, name) => total + (Array.isArray(state[name]) ? state[name].length : 0),
			0,
		),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}
