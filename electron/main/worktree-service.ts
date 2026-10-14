import { execFile } from "node:child_process";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceDiffResponse } from "../../src/shared/ipc.js";
import { errorToMessage, isRecord } from "../../src/shared/value.js";

const execFileAsync = promisify(execFile);

export interface SessionWorkspace {
	path: string;
	isolated: boolean;
	writable: boolean;
}

export class WorktreeService {
	private readonly worktreeRoot: string;
	private readonly sessionPaths = new Map<
		string,
		{ sourcePath: string; requestedWritable: boolean; workspace: SessionWorkspace }
	>();

	constructor(userDataPath: string) {
		this.worktreeRoot = path.join(userDataPath, "worktrees");
	}

	async resolveSessionWorkspace(
		workspacePath: string,
		frontendSessionId: string,
		writable: boolean,
	): Promise<SessionWorkspace> {
		const existing = this.sessionPaths.get(frontendSessionId);
		if (existing?.sourcePath === workspacePath && existing.requestedWritable === writable) {
			return existing.workspace;
		}
		const remember = (workspace: SessionWorkspace) => {
			this.sessionPaths.set(frontendSessionId, {
				sourcePath: workspacePath,
				requestedWritable: writable,
				workspace,
			});
			return workspace;
		};
		if (!writable) {
			return remember({ path: workspacePath, isolated: false, writable: false });
		}
		try {
			let repositoryRoot: string;
			try {
				const { stdout } = await execFileAsync(
					"git",
					["-C", workspacePath, "rev-parse", "--show-toplevel"],
					{ windowsHide: true, env: { ...process.env, LC_ALL: "C" } },
				);
				repositoryRoot = stdout.trim();
			} catch (error) {
				if (
					isRecord(error) &&
					error.code === 128 &&
					typeof error.stderr === "string" &&
					error.stderr.includes("not a git repository") &&
					!(await hasGitMetadata(workspacePath))
				) {
					return remember({ path: workspacePath, isolated: false, writable: true });
				}
				throw error;
			}
			const workspaceRelative = path.relative(repositoryRoot, workspacePath);
			await mkdir(this.worktreeRoot, { recursive: true });
			const targetPath = path.join(this.worktreeRoot, safeSessionId(frontendSessionId));
			const { stdout: list } = await execFileAsync(
				"git",
				["-C", repositoryRoot, "worktree", "list", "--porcelain"],
				{ windowsHide: true },
			);
			if (
				!list
					.split(/\r?\n/)
					.filter((line) => line.startsWith("worktree "))
					.map((line) => path.normalize(line.slice(9)).toLocaleLowerCase())
					.some((listedPath) => listedPath === path.normalize(targetPath).toLocaleLowerCase())
			) {
				await execFileAsync(
					"git",
					["-C", repositoryRoot, "worktree", "add", "--detach", targetPath, "HEAD"],
					{ windowsHide: true },
				);
			}
			return remember({
				path: workspaceRelative ? path.join(targetPath, workspaceRelative) : targetPath,
				isolated: true,
				writable: true,
			});
		} catch (error) {
			console.warn(
				`Workspace isolation failed; agent writes are disabled: ${errorToMessage(error)}`,
			);
			return remember({ path: workspacePath, isolated: false, writable: false });
		}
	}

	async diff(frontendSessionId: string): Promise<WorkspaceDiffResponse> {
		const workspace = this.sessionPaths.get(frontendSessionId)?.workspace;
		if (!workspace) throw new Error("No workspace is bound to this session yet.");
		try {
			const [{ stdout: status }, { stdout: diff }] = await Promise.all([
				execFileAsync("git", ["-C", workspace.path, "status", "--short"], {
					windowsHide: true,
					maxBuffer: 5_000_000,
				}),
				execFileAsync("git", ["-C", workspace.path, "diff", "--no-ext-diff", "--binary"], {
					windowsHide: true,
					maxBuffer: 20_000_000,
				}),
			]);
			return { path: workspace.path, status, diff, isolated: workspace.isolated };
		} catch (error) {
			throw new Error(
				`Unable to read workspace diff: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

async function hasGitMetadata(workspacePath: string): Promise<boolean> {
	let directory = path.resolve(workspacePath);
	while (true) {
		try {
			await lstat(path.join(directory, ".git"));
			return true;
		} catch (error) {
			if (!isRecord(error) || error.code !== "ENOENT") throw error;
		}
		const parent = path.dirname(directory);
		if (parent === directory) return false;
		directory = parent;
	}
}

function safeSessionId(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
}
