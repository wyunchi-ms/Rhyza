import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SourceService } from "../electron/main/source-service.js";
import { AppStateStore } from "../electron/main/app-state-store.js";
import { WorktreeService } from "../electron/main/worktree-service.js";

const execFileAsync = promisify(execFile);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "knowbranch-mvp-smoke-"));

try {
	const repository = path.join(tempRoot, "repository");
	const docs = path.join(tempRoot, "docs");
	const userData = path.join(tempRoot, "user-data");
	await mkdir(repository, { recursive: true });
	await mkdir(docs, { recursive: true });
	await writeFile(path.join(repository, "README.md"), "KnowBranch repository baseline\n", "utf8");
	await writeFile(path.join(docs, "design.md"), "The Context Pack retrieves shared knowledge.\n", "utf8");
	await git(repository, "init");
	await git(repository, "config", "user.name", "KnowBranch Smoke");
	await git(repository, "config", "user.email", "smoke@knowbranch.local");
	await git(repository, "add", "README.md");
	await git(repository, "commit", "-m", "baseline");

	const sources = new SourceService(userData, async () => repository);
	const indexed = await sources.add([repository, docs]);
	assert(indexed.length === 2, "Expected two indexed sources.");
	assert(indexed.every((source) => source.status === "indexed"), "Every source must be indexed.");
	const hits = await sources.search({ query: "shared knowledge", limit: 10 });
	assert(hits.some((hit) => hit.path === "design.md"), "Full-text search did not find the docs source.");

	const stateStore = new AppStateStore(userData);
	await stateStore.save(repository, JSON.stringify({ state: { sessions: [{ id: "repo" }] }, version: 2 }));
	await stateStore.save(docs, JSON.stringify({ state: { sessions: [{ id: "docs" }] }, version: 2 }));
	assert(stateStore.load(repository)?.includes('"id":"repo"'), "Repository state was not isolated.");
	assert(stateStore.load(docs)?.includes('"id":"docs"'), "Docs state was not isolated.");

	const worktrees = new WorktreeService(userData);
	const first = await worktrees.resolveSessionWorkspace(repository, "session-one", true);
	const second = await worktrees.resolveSessionWorkspace(repository, "session-two", true);
	assert(first.isolated && second.isolated, "Writable Git sessions must be isolated.");
	assert(first.path !== second.path, "Writable sessions resolved to the same worktree.");
	await writeFile(path.join(first.path, "README.md"), "KnowBranch changed in session one\n", "utf8");
	const firstDiff = await worktrees.diff("session-one");
	const secondDiff = await worktrees.diff("session-two");
	assert(firstDiff.diff.includes("changed in session one"), "First session diff is missing its edit.");
	assert(!secondDiff.diff.includes("changed in session one"), "Second session observed the first session edit.");

	console.log(`MVP smoke passed: sources=${indexed.length}, hits=${hits.length}, isolated=${first.path !== second.path}`);
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

async function git(directory: string, ...args: string[]) {
	await execFileAsync("git", ["-C", directory, ...args], { windowsHide: true });
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
