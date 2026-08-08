import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppStateStore } from "../electron/main/app-state-store.js";

const dataRoot = await mkdtemp(path.join(os.tmpdir(), "pigraph-state-store-"));
const workspacePath = path.join(dataRoot, "workspace");
const otherWorkspacePath = path.join(dataRoot, "other-workspace");
const populated = JSON.stringify({
	workspacePath,
	state: {
		sessions: [{ id: "session-1" }],
		turns: [{ id: "turn-1" }],
		entities: [],
		relations: [],
		diagrams: [],
		sources: [],
		changesets: [],
	},
});
const empty = JSON.stringify({
	workspacePath,
	state: {
		sessions: [],
		turns: [],
		entities: [],
		relations: [],
		diagrams: [],
		sources: [],
		changesets: [],
	},
});

try {
	const store = new AppStateStore(dataRoot);
	await store.save(workspacePath, populated);
	await assert.rejects(
		() => store.save(otherWorkspacePath, populated),
		/does not match its destination workspace/,
	);
	assert.equal(store.load(otherWorkspacePath), null);
	await assert.rejects(() => store.save(workspacePath, empty), /non-empty workspace data/);
	assert.equal(store.load(workspacePath), populated);
	await assert.rejects(
		() => store.save(workspacePath, JSON.stringify({ state: { diagrams: [{ id: "legacy" }] } })),
		/valid Mermaid source/,
	);
	assert.equal(store.load(workspacePath), populated);

	const updated = populated.replace("turn-1", "turn-2");
	await store.save(workspacePath, updated);
	assert.equal(store.load(workspacePath), updated);

	const index = JSON.parse(await readFile(path.join(dataRoot, "workspaces.json"), "utf8")) as {
		workspaces: Record<string, { stateFile: string }>;
	};
	const stateFile = Object.values(index.workspaces)[0]?.stateFile;
	assert.ok(stateFile);
	assert.equal(await readFile(path.join(dataRoot, `${stateFile}.backup`), "utf8"), populated);
	console.log("AppStateStore smoke passed.");
} finally {
	await rm(dataRoot, { recursive: true, force: true });
}
