import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { WorktreeService } from "../electron/main/worktree-service.js";

const execFileAsync = promisify(execFile);

async function git(directory: string, ...args: string[]) {
	return execFileAsync("git", ["-C", directory, ...args], { windowsHide: true });
}

test("non-Git workspaces stay directly writable without creating Worktrees", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-non-git-workspace-"));
	const workspace = path.join(directory, "notes");
	const otherWorkspace = path.join(directory, "other");
	const data = path.join(directory, "data");
	try {
		await Promise.all([mkdir(workspace), mkdir(otherWorkspace)]);
		const service = new WorktreeService(data);
		assert.deepEqual(await service.resolveSessionWorkspace(workspace, "chat", false), {
			path: workspace,
			isolated: false,
			writable: false,
		});
		const writable = await service.resolveSessionWorkspace(workspace, "chat", true);
		assert.deepEqual(writable, { path: workspace, isolated: false, writable: true });
		assert.equal(await service.resolveSessionWorkspace(workspace, "chat", true), writable);
		assert.deepEqual(await service.resolveSessionWorkspace(otherWorkspace, "chat", true), {
			path: otherWorkspace,
			isolated: false,
			writable: true,
		});
		assert.deepEqual(await service.resolveSessionWorkspace(otherWorkspace, "chat", false), {
			path: otherWorkspace,
			isolated: false,
			writable: false,
		});
		await assert.rejects(access(path.join(data, "worktrees")), { code: "ENOENT" });
		await assert.rejects(access(path.join(workspace, ".git")), { code: "ENOENT" });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("Git subdirectory workspaces still get isolated writable Worktrees", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-git-workspace-"));
	const repository = path.join(directory, "repository");
	const workspace = path.join(repository, "notes");
	try {
		await mkdir(workspace, { recursive: true });
		await git(repository, "init", "--quiet");
		await git(repository, "config", "core.autocrlf", "false");
		await writeFile(path.join(workspace, "TODO.md"), "- [ ] Task\n");
		await git(repository, "add", ".");
		await git(
			repository,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--quiet",
			"-m",
			"Fixture",
		);
		const service = new WorktreeService(path.join(directory, "data"));
		assert.deepEqual(await service.resolveSessionWorkspace(workspace, "chat", false), {
			path: workspace,
			isolated: false,
			writable: false,
		});
		const first = await service.resolveSessionWorkspace(workspace, "chat", true);
		const second = await service.resolveSessionWorkspace(workspace, "other-chat", true);
		assert.equal(first.isolated, true);
		assert.equal(first.writable, true);
		assert.notEqual(first.path, workspace);
		assert.notEqual(first.path, second.path);
		assert.equal(path.basename(first.path), "notes");
		await writeFile(path.join(first.path, "TODO.md"), "- [x] Task\n");
		assert.equal(await readFile(path.join(workspace, "TODO.md"), "utf8"), "- [ ] Task\n");
		assert.equal(await readFile(path.join(second.path, "TODO.md"), "utf8"), "- [ ] Task\n");
		assert.equal((await service.diff("chat")).isolated, true);
		assert.match((await service.diff("chat")).diff, /\+\- \[x\] Task/);
	} finally {
		await rm(directory, { recursive: true, force: true, maxRetries: 5 });
	}
});

test("Git Worktree creation failures fall back read-only and report the error", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-git-failure-"));
	const workspace = path.join(directory, "repository");
	const warnings: string[] = [];
	t.mock.method(console, "warn", (message: string) => warnings.push(message));
	try {
		await mkdir(workspace);
		await git(workspace, "init", "--quiet");
		const service = new WorktreeService(path.join(directory, "data"));
		assert.deepEqual(await service.resolveSessionWorkspace(workspace, "chat", true), {
			path: workspace,
			isolated: false,
			writable: false,
		});
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /isolation failed.*writes are disabled/i);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("broken Git metadata and missing directories are not mistaken for writable non-Git folders", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-git-detection-"));
	const workspace = path.join(directory, "broken");
	const warnings: string[] = [];
	t.mock.method(console, "warn", (message: string) => warnings.push(message));
	try {
		await mkdir(path.join(workspace, ".git"), { recursive: true });
		const service = new WorktreeService(path.join(directory, "data"));
		assert.equal(
			(await service.resolveSessionWorkspace(workspace, "broken", true)).writable,
			false,
		);
		assert.equal(
			(await service.resolveSessionWorkspace(path.join(directory, "missing"), "missing", true))
				.writable,
			false,
		);
		assert.equal(warnings.length, 2);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
