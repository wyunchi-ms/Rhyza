import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppStateStore } from "../electron/main/app-state-store.js";

const dataRoot = await mkdtemp(path.join(os.tmpdir(), "rhyza-state-store-"));
const workspacePath = path.join(dataRoot, "workspace");
const otherWorkspacePath = path.join(dataRoot, "other-workspace");
const recoveryWorkspacePath = path.join(dataRoot, "recovery-workspace");
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

	const legacyUsage = { input: 100, output: 20, cacheRead: 30, cacheWrite: 40, cost: 0.002 };
	const legacyState = JSON.stringify({
		workspacePath: recoveryWorkspacePath,
		state: { sessions: [{ id: "legacy-session", usage: legacyUsage }], turns: [] },
	});
	const strippedState = JSON.stringify({
		workspacePath: recoveryWorkspacePath,
		state: { sessions: [{ id: "legacy-session" }], turns: [] },
	});
	await store.save(recoveryWorkspacePath, legacyState);
	await store.save(recoveryWorkspacePath, strippedState);
	const recovered = JSON.parse(store.load(recoveryWorkspacePath) ?? "{}") as {
		state?: { sessions?: Array<{ usage?: typeof legacyUsage }> };
	};
	assert.deepEqual(recovered.state?.sessions?.[0]?.usage, legacyUsage);
	console.log("AppStateStore smoke passed.");
} finally {
	await rm(dataRoot, { recursive: true, force: true });
}
