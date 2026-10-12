import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsStore } from "../electron/main/settings-store.js";
import { AppStateStore } from "../electron/main/app-state-store.js";
import { validateWorkspaceSwitchRequest } from "../src/shared/ipc.js";

async function fixture(t: test.TestContext) {
	const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-workspace-history-"));
	t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
	const data = path.join(root, "data");
	const first = path.join(root, "first");
	const second = path.join(root, "second");
	await Promise.all([mkdir(data), mkdir(first), mkdir(second)]);
	return { root, data, first: await realpath(first), second: await realpath(second) };
}

test("history persists across restart, reorders on use and deduplicates canonical paths", async (t) => {
	const { root, data, first, second } = await fixture(t);
	const settings = new SettingsStore(data);
	assert.deepEqual(await settings.getWorkspaceHistory(), []);
	await settings.setWorkspacePath(first);
	await settings.setWorkspacePath(second);
	const history = await new SettingsStore(data).getWorkspaceHistory();
	assert.deepEqual(
		history.map((entry) => entry.path),
		[second, first],
	);
	assert.ok(
		history.every((entry) => entry.lastUsedAt && Number.isFinite(Date.parse(entry.lastUsedAt))),
	);
	await settings.switchWorkspace(first);
	const alias = path.join(root, "alias");
	await symlink(first, alias, process.platform === "win32" ? "junction" : "dir");
	await settings.setWorkspacePath(alias);
	assert.deepEqual(
		(await settings.getWorkspaceHistory()).map((entry) => entry.path),
		[first, second],
	);
	assert.equal(settings.getWorkspacePathSync(), first);
	if (process.platform === "win32") {
		await settings.switchWorkspace(first.toUpperCase());
		assert.equal((await settings.getWorkspaceHistory()).length, 2);
	}
	await settings.setWorkspacePath(null);
	assert.equal(await settings.getWorkspacePath(), null);
	assert.equal((await settings.getWorkspaceHistory()).length, 2);
});

test("legacy current settings and existing state index seed history only once", async (t) => {
	const { root, data, first, second } = await fixture(t);
	const legacy = path.join(root, "legacy");
	await mkdir(legacy);
	await writeFile(
		path.join(legacy, `${["know", "branch"].join("")}-settings.json`),
		JSON.stringify({ workspacePath: first }),
	);
	const states = new AppStateStore(data);
	await states.save(first, JSON.stringify({ state: { sessions: [], turns: [] } }));
	await states.save(second, JSON.stringify({ state: { sessions: [], turns: [] } }));
	const settings = new SettingsStore(data, legacy);
	assert.equal(settings.getWorkspacePathSync(), first);
	assert.deepEqual(
		(await settings.getWorkspaceHistory()).map((entry) => entry.path),
		[first, second],
	);
	const persisted = JSON.parse(await readFile(path.join(data, "settings.json"), "utf8"));
	assert.equal(persisted.workspacePath, first);
	await writeFile(path.join(data, "workspaces.json"), "not-json");
	assert.deepEqual(await new SettingsStore(data).getWorkspaceHistory(), persisted.workspaceHistory);
});

test("saved workspaces are recovered even without a settings file", async (t) => {
	const { data, first, second } = await fixture(t);
	await writeFile(
		path.join(data, "workspaces.json"),
		JSON.stringify({
			version: 1,
			workspaces: {
				[first]: { stateFile: "unused.json", updatedAt: "2026-10-01T00:00:00.000Z" },
				[second]: { stateFile: "unused.json", updatedAt: "2026-10-02T00:00:00.000Z" },
			},
		}),
	);
	assert.deepEqual(
		(await new SettingsStore(data).getWorkspaceHistory()).map((entry) => entry.path),
		[second, first],
	);
});

test("invalid or removed folders preserve current workspace and history, then allow recovery", async (t) => {
	const { root, data, first, second } = await fixture(t);
	const settings = new SettingsStore(data);
	await settings.setWorkspacePath(first);
	await settings.setWorkspacePath(second);
	await settings.switchWorkspace(first);
	const before = await readFile(path.join(data, "settings.json"), "utf8");
	await rm(second, { recursive: true });
	await assert.rejects(settings.switchWorkspace(second), /ENOENT/);
	await assert.rejects(settings.switchWorkspace(root), /not in your history/);
	const file = path.join(root, "file.txt");
	await writeFile(file, "not a directory");
	await assert.rejects(settings.setWorkspacePath(file), /must be a directory/);
	assert.equal(await readFile(path.join(data, "settings.json"), "utf8"), before);
	assert.equal(await settings.requireWorkspacePath(), first);
	await mkdir(second);
	await settings.switchWorkspace(second);
	assert.equal(await settings.getWorkspacePath(), second);
});

test("concurrent selections do not lose history or leave a partial settings file", async (t) => {
	const { data, first, second } = await fixture(t);
	const settings = new SettingsStore(data);
	await Promise.all([settings.setWorkspacePath(first), settings.setWorkspacePath(second)]);
	assert.deepEqual(
		(await settings.getWorkspaceHistory()).map((entry) => entry.path),
		[second, first],
	);
	await assert.rejects(readFile(path.join(data, "settings.json.tmp")), /ENOENT/);
});

test("malformed settings and indexes report errors instead of overwriting history", async (t) => {
	const { data } = await fixture(t);
	const settingsPath = path.join(data, "settings.json");
	const malformed = JSON.stringify({ workspaceHistory: [{ path: "", lastUsedAt: null }] });
	await writeFile(settingsPath, malformed);
	await assert.rejects(
		new SettingsStore(data).getWorkspaceHistory(),
		/Invalid workspace history entry/,
	);
	assert.equal(await readFile(settingsPath, "utf8"), malformed);
	await rm(settingsPath);
	await writeFile(path.join(data, "workspaces.json"), "{");
	await assert.rejects(new SettingsStore(data).getWorkspaceHistory(), SyntaxError);
});

test("workspace switches validate the IPC request", () => {
	assert.deepEqual(validateWorkspaceSwitchRequest({ path: "C:\\demo\\workspace" }), {
		path: "C:\\demo\\workspace",
	});
	for (const value of [
		null,
		"",
		{},
		{ path: " " },
		{ path: 42 },
		{ path: "a\nb" },
		{ path: "x".repeat(4097) },
	]) {
		assert.throws(() => validateWorkspaceSwitchRequest(value), /Invalid workspace path/);
	}
});
