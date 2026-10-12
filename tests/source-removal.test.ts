import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SourceService } from "../electron/main/source-service.js";
import { loadWorkspaceState, useAppStore } from "../src/store/index.js";

function withRendererStorage(t: test.TestContext) {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const originalState = useAppStore.getState();
	const storage = new Map<string, string>();
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key),
			},
		},
	});
	t.after(() => {
		useAppStore.setState(originalState, true);
		if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
		else Reflect.deleteProperty(globalThis, "window");
	});
	return storage;
}

async function fixture(t: test.TestContext) {
	const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-source-removal-"));
	t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
	const source = path.join(root, "documents");
	const data = path.join(root, "data");
	const firstWorkspace = path.join(root, "workspace-a");
	const secondWorkspace = path.join(root, "workspace-b");
	await Promise.all([
		mkdir(path.join(source, "scratch"), { recursive: true }),
		mkdir(firstWorkspace),
		mkdir(secondWorkspace),
	]);
	await writeFile(path.join(source, "guide.md"), "removalneedle");
	await writeFile(path.join(source, "scratch", "notes.txt"), "removalneedle");
	return { source, data, firstWorkspace, secondWorkspace };
}

test("removal deletes only the current workspace catalog entry, keeping original files and other workspaces", async (t) => {
	const { source, data, firstWorkspace, secondWorkspace } = await fixture(t);
	let workspace = firstWorkspace;
	const service = new SourceService(data, async () => workspace);
	const [first] = await service.add([source]);
	await service.saveIndexingConfig({
		id: first.id,
		excludedDirectories: ["scratch"],
		excludePatterns: [],
	});
	workspace = secondWorkspace;
	const [second] = await service.add([source]);
	workspace = firstWorkspace;
	await service.remove(first.id);
	assert.deepEqual(await service.list(), []);
	assert.deepEqual(await service.search({ query: "removalneedle" }), []);
	await assert.rejects(service.read(first.id, "guide.md"), /Indexed source not found/);
	await assert.rejects(service.getIndexingConfig(first.id), /Source not found/);
	await assert.rejects(service.remove(first.id), /Source not found/);
	assert.equal(await readFile(path.join(source, "guide.md"), "utf8"), "removalneedle");
	assert.equal(await readFile(path.join(source, "scratch", "notes.txt"), "utf8"), "removalneedle");
	assert.deepEqual(
		await new SourceService(data, async () => firstWorkspace).list(),
		[],
		"removal survives restart",
	);
	workspace = secondWorkspace;
	assert.equal((await service.list())[0].id, second.id);
	assert.equal((await service.search({ query: "removalneedle" })).length, 2);
	workspace = firstWorkspace;
	const [addedAgain] = await service.add([source]);
	assert.notEqual(addedAgain.id, first.id, "adding after removal creates a new registration");
	assert.equal(addedAgain.fileCount, 2);
	assert.deepEqual((await service.getIndexingConfig(addedAgain.id)).excludedDirectories, []);
});

test("failed catalog writes preserve the cached source and its saved registration", async (t) => {
	const { source, data, firstWorkspace } = await fixture(t);
	const service = new SourceService(data, async () => firstWorkspace);
	const [indexed] = await service.add([source]);
	const catalogPath = path.join(data, "sources", (await readdir(path.join(data, "sources")))[0]);
	const backupPath = `${catalogPath}.test-backup`;
	const before = await readFile(catalogPath, "utf8");
	await rename(catalogPath, backupPath);
	await mkdir(catalogPath);
	await assert.rejects(service.remove(indexed.id));
	assert.equal((await service.list())[0].id, indexed.id);
	await rm(catalogPath, { recursive: true });
	await rename(backupPath, catalogPath);
	assert.equal(await readFile(catalogPath, "utf8"), before);
	assert.equal(
		(await new SourceService(data, async () => firstWorkspace).list())[0].id,
		indexed.id,
	);
});

test("renderer removal and catalog synchronization preserve chats, knowledge and historical references", (t) => {
	const storage = withRendererStorage(t);
	const source = {
		id: "removed",
		name: "Documents",
		path: "C:\\demo\\documents",
		type: "docs",
		status: "indexed",
		fileCount: 2,
	};
	loadWorkspaceState(
		JSON.stringify({
			state: {
				sources: [source],
				sessions: [
					{ id: "chat", parentId: null, title: "Saved conversation", isRoot: true, status: "idle" },
				],
				turns: [
					{
						id: "turn",
						sessionId: "chat",
						role: "user",
						content: "Saved question",
						status: "complete",
						createdAt: "2026-10-12T00:00:00Z",
					},
				],
				entities: [
					{
						id: "knowledge",
						name: "Existing knowledge",
						aliases: [],
						type: "Concept",
						summary: "Saved summary",
						content: "Saved content",
						confidence: "confirmed",
						sourceRefs: [{ sourceId: "removed", path: "guide.md" }],
						version: 1,
						updatedAt: "2026-10-12T00:00:00Z",
					},
				],
			},
		}),
	);
	const before = useAppStore.getState();
	before.removeSource("removed");
	const removed = useAppStore.getState();
	assert.deepEqual(removed.sources, []);
	for (const key of ["sessions", "turns", "entities", "relations", "diagrams"] as const) {
		assert.equal(removed[key], before[key]);
	}
	assert.equal(removed.entities[0].sourceRefs[0].sourceId, "removed");
	assert.deepEqual(JSON.parse(storage.get("rhyza-workspace-v2")!).state.sources, []);
	useAppStore.setState({ sources: [before.sources[0]] });
	useAppStore.getState().syncSources([]);
	assert.deepEqual(
		useAppStore.getState().sources,
		[],
		"the authoritative catalog clears stale persisted source entries",
	);
	assert.equal(useAppStore.getState().entities, before.entities);
});

test("authoritative source synchronization preserves revision invalidation behavior", (t) => {
	withRendererStorage(t);
	loadWorkspaceState(
		JSON.stringify({
			state: {
				sources: [
					{
						id: "source",
						name: "Repository",
						path: "C:\\demo\\repo",
						type: "repo",
						status: "indexed",
						fileCount: 1,
						revision: "old",
					},
				],
				entities: [
					{
						id: "knowledge",
						name: "Saved knowledge",
						aliases: [],
						type: "Concept",
						summary: "Summary",
						content: "Content",
						confidence: "confirmed",
						sourceRefs: [{ sourceId: "source", revision: "old" }],
						version: 1,
						updatedAt: "2026-10-12T00:00:00Z",
					},
				],
			},
		}),
	);
	const current = useAppStore.getState().sources[0];
	useAppStore.getState().syncSources([{ ...current, revision: "new" }]);
	assert.equal(useAppStore.getState().entities[0].sourceRefs[0].stale, true);
	assert.equal(useAppStore.getState().sources[0].revision, "new");
});
