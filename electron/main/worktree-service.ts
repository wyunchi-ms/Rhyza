import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceDiffResponse } from "../../src/shared/ipc.js";

const execFileAsync = promisify(execFile);

export class WorktreeService {
	private readonly worktreeRoot: string;
	private readonly sessionPaths = new Map<string, { path: string; isolated: boolean }>();

	constructor(userDataPath: string) {
		this.worktreeRoot = path.join(userDataPath, "worktrees");
	}

	async resolveSessionWorkspace(workspacePath: string, frontendSessionId: string, writable: boolean): Promise<{ path: string; isolated: boolean }> {
		const existing = this.sessionPaths.get(frontendSessionId);
		if (existing) return existing;
		if (!writable) {
			const result = { path: workspacePath, isolated: false };
			this.sessionPaths.set(frontendSessionId, result);
			return result;
		}
		try {
			const { stdout } = await execFileAsync("git", ["-C", workspacePath, "rev-parse", "--show-toplevel"], { windowsHide: true });
			const repositoryRoot = stdout.trim();
			const workspaceRelative = path.relative(repositoryRoot, workspacePath);
			await mkdir(this.worktreeRoot, { recursive: true });
			const targetPath = path.join(this.worktreeRoot, safeSessionId(frontendSessionId));
			const { stdout: list } = await execFileAsync("git", ["-C", repositoryRoot, "worktree", "list", "--porcelain"], { windowsHide: true });
			if (!list.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).map((line) => path.normalize(line.slice(9)).toLocaleLowerCase()).some((listedPath) => listedPath === path.normalize(targetPath).toLocaleLowerCase())) {
				await execFileAsync("git", ["-C", repositoryRoot, "worktree", "add", "--detach", targetPath, "HEAD"], { windowsHide: true });
			}
			const result = { path: workspaceRelative ? path.join(targetPath, workspaceRelative) : targetPath, isolated: true };
			this.sessionPaths.set(frontendSessionId, result);
			return result;
		} catch {
			const result = { path: workspacePath, isolated: false };
			this.sessionPaths.set(frontendSessionId, result);
			return result;
		}
	}

	async diff(frontendSessionId: string): Promise<WorkspaceDiffResponse> {
		const workspace = this.sessionPaths.get(frontendSessionId);
		if (!workspace) throw new Error("No workspace is bound to this session yet.");
		try {
			const [{ stdout: status }, { stdout: diff }] = await Promise.all([
				execFileAsync("git", ["-C", workspace.path, "status", "--short"], { windowsHide: true, maxBuffer: 5_000_000 }),
				execFileAsync("git", ["-C", workspace.path, "diff", "--no-ext-diff", "--binary"], { windowsHide: true, maxBuffer: 20_000_000 }),
			]);
			return { path: workspace.path, status, diff, isolated: workspace.isolated };
		} catch (error) {
			throw new Error(`Unable to read workspace diff: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

function safeSessionId(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
}
