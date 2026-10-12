import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { SourceService } from "../electron/main/source-service.js";
import { validateSourceIndexingSaveRequest } from "../src/shared/ipc.js";

const execFileAsync = promisify(execFile);
const needle = "catalogneedle";

async function fixture(t: test.TestContext) {
	const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-source-ignore-"));
	t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
	const source = path.join(root, "source");
	const data = path.join(root, "data");
	await mkdir(source);
	const service = new SourceService(data, async () => source);
	const write = async (segments: string[], content = needle) => {
		const file = path.join(source, ...segments);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, content);
	};
	return { root, source, data, service, write };
}

test("index, search and agent reads exclude internal data, dependencies, caches and build output", async (t) => {
	const { source, service, write } = await fixture(t);
	const defaults = [
		".git",
		".hg",
		".svn",
		"node_modules",
		"dist",
		"dist-electron",
		"build",
		"bin",
		"obj",
		"target",
		".next",
		".nuxt",
		".output",
		".cache",
		".turbo",
		".gradle",
		".venv",
		"venv",
		"__pycache__",
		".pytest_cache",
		".mypy_cache",
		".ruff_cache",
		".tox",
		".nox",
		"coverage",
		".nyc_output",
		".rhyza-debug",
		".pi-graph",
	];
	await Promise.all(defaults.map((directory) => write([directory, "dump.json"])));
	await write(["nested", ".rhyza-debug", "fork-dumps", "chat.json"]);
	const included = [
		["src", "main.ts"],
		["docs", "guide.md"],
		["settings.json"],
		["UPPER.TXT"],
		[".github", "workflows", "ci.yml"],
		[".agents", "skills", "audit", "SKILL.md"],
	];
	await Promise.all(included.map((segments) => write(segments)));
	const [indexed] = await service.add([source]);
	assert.equal(indexed.status, "indexed");
	assert.equal(indexed.fileCount, included.length);
	const hits = await service.search({ query: `${needle} SKILL.md`, limit: 100 });
	assert.deepEqual(
		new Set(hits.map((hit) => hit.path)),
		new Set(included.map((segments) => path.join(...segments))),
	);
	for (const directory of defaults) {
		await assert.rejects(
			service.read(indexed.id, path.join(directory, "dump.json")),
			/not part of the indexed source/,
		);
	}
	if (process.platform === "win32") {
		await write(["NESTED", ".RHYZA-DEBUG", "dump.json"]);
		assert.equal((await service.refresh(indexed.id)).fileCount, included.length);
	}
});

test("root and nested gitignore rules work for document folders, with Rhyza overrides and negations", async (t) => {
	const { source, service, write } = await fixture(t);
	await write(
		[".gitignore"],
		[
			"*.json",
			"!settings.json",
			"blocked/",
			"notes/*",
			"!notes/keep.md",
			"docs/**/generated*.md",
			"",
		].join("\n"),
	);
	await write(["docs", ".gitignore"], "!restored.json\n!custom-blocked.json\nblocked.md\n");
	await write(["blocked", ".gitignore"], "!restore.txt\n");
	await write(
		[".rhyzaignore"],
		["private/", "docs/custom-blocked.json", "!explicit.json", "!node_modules/", ""].join("\n"),
	);
	const included = [
		["settings.json"],
		["explicit.json"],
		["notes", "keep.md"],
		["docs", "restored.json"],
		["docs", "guide.md"],
	];
	const excluded = [
		["ordinary.json"],
		["notes", "drop.md"],
		["docs", "custom-blocked.json"],
		["docs", "blocked.md"],
		["docs", "deep", "generated-api.md"],
		["blocked", "restore.txt"],
		["private", "notes.md"],
		["node_modules", "included.txt"],
	];
	await Promise.all([...included, ...excluded].map((segments) => write(segments)));
	const [indexed] = await service.add([source]);
	assert.equal(indexed.type, "docs", "rules also work without a Git repository");
	assert.equal(indexed.fileCount, included.length);
	assert.deepEqual(
		new Set((await service.search({ query: needle, limit: 100 })).map((hit) => hit.path)),
		new Set(included.map((segments) => path.join(...segments))),
	);
	for (const segments of excluded) {
		await assert.rejects(
			service.read(indexed.id, path.join(...segments)),
			/not part of the indexed source/,
		);
	}
});

test("ignore rules exclude matching tracked files too, and support escaped names and directory anchoring", async (t) => {
	const { source, service, write } = await fixture(t);
	await execFileAsync("git", ["init", "--quiet", source], { windowsHide: true });
	await write([".gitignore"], "tracked.json\n/root-only/\n");
	await write([".rhyzaignore"], "\\#scratch.txt\n\\!scratch.txt\nspace\\ name.txt\n");
	const excluded = [
		["tracked.json"],
		["#scratch.txt"],
		["!scratch.txt"],
		["space name.txt"],
		["root-only", "notes.md"],
	];
	await Promise.all(excluded.map((segments) => write(segments)));
	await execFileAsync("git", ["-C", source, "add", "--force", "tracked.json"], {
		windowsHide: true,
	});
	await write(["nested", "root-only", "notes.md"]);
	const [indexed] = await service.add([source]);
	assert.equal(indexed.type, "repo");
	assert.equal(indexed.fileCount, 1);
	assert.deepEqual(
		(await service.search({ query: needle })).map((hit) => hit.path),
		[path.join("nested", "root-only", "notes.md")],
	);
});

test("existing catalogs are filtered and persisted before search or agent reads without reindexing", async (t) => {
	const { source, data, service, write } = await fixture(t);
	await write(["guide.md"]);
	await write(["private", "notes.txt"]);
	await write([".rhyza-debug", "fork-dumps", "chat.json"]);
	const [indexed] = await service.add([source]);
	const catalogPath = path.join(data, "sources", (await readdir(path.join(data, "sources")))[0]);
	const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
	catalog[0].files.push(path.join(".rhyza-debug", "fork-dumps", "chat.json"));
	catalog[0].fileCount = catalog[0].files.length;
	await writeFile(catalogPath, JSON.stringify(catalog));
	await write([".rhyzaignore"], "private/\n");
	const restarted = new SourceService(data, async () => source);
	assert.equal((await restarted.list())[0].fileCount, 1);
	assert.deepEqual(
		(await restarted.search({ query: needle })).map((hit) => hit.path),
		["guide.md"],
	);
	await assert.rejects(
		restarted.read(indexed.id, path.join(".rhyza-debug", "fork-dumps", "chat.json")),
		/not part of the indexed source/,
	);
	await assert.rejects(
		restarted.read(indexed.id, path.join("private", "notes.txt")),
		/not part of the indexed source/,
	);
	const persisted = JSON.parse(await readFile(catalogPath, "utf8"));
	assert.deepEqual(persisted[0].files, ["guide.md"]);
	assert.equal(persisted[0].fileCount, 1);
	await write([".rhyzaignore"], "");
	assert.equal((await new SourceService(data, async () => source).list())[0].fileCount, 1);
	assert.equal(
		(await restarted.refresh(indexed.id)).fileCount,
		2,
		"reindex restores files when rules are removed",
	);
});

test("text extension and exact size limits are preserved, and symbolic links are not followed", async (t) => {
	const { root, source, service, write } = await fixture(t);
	await write(["limit.txt"], "x".repeat(2_000_000));
	await write(["oversized.txt"], "x".repeat(2_000_001));
	await Promise.all(
		["pdf", "docx", "png", "exe"].map((extension) => write([`document.${extension}`])),
	);
	const external = path.join(root, "external");
	await mkdir(external);
	await writeFile(path.join(external, "outside.txt"), needle);
	await symlink(
		external,
		path.join(source, "linked"),
		process.platform === "win32" ? "junction" : "dir",
	);
	const [indexed] = await service.add([source]);
	assert.equal(indexed.fileCount, 1);
	assert.equal((await service.read(indexed.id, "limit.txt")).content.length, 32_000);
	await assert.rejects(
		service.read(indexed.id, path.join("linked", "outside.txt")),
		/not part of the indexed source/,
	);
});

test("invalid ignore files produce an explicit indexing error and permit retry after correction", async (t) => {
	const { source, service, write } = await fixture(t);
	await write(["guide.md"]);
	await write([".rhyzaignore"], "x".repeat(2_000_001));
	const [failed] = await service.add([source]);
	assert.equal(failed.status, "error");
	assert.match(failed.error ?? "", /ignore rules exceed the 2 MB limit/);
	await write([".rhyzaignore"], "");
	assert.equal((await service.refresh(failed.id)).status, "indexed");
});

test("catalog load failures caused by ignore files are not cached permanently", async (t) => {
	const { source, data, service, write } = await fixture(t);
	await write(["guide.md"]);
	await service.add([source]);
	await mkdir(path.join(source, ".gitignore"));
	const restarted = new SourceService(data, async () => source);
	await assert.rejects(restarted.list(), /ignore rules must be a regular file/);
	await rm(path.join(source, ".gitignore"), { recursive: true });
	assert.equal((await restarted.list())[0].fileCount, 1);
});

test("per-source exclusions persist, reindex immediately, and do not alter source files or another source", async (t) => {
	const { root, source, data, service, write } = await fixture(t);
	await write(["docs", "guide.md"]);
	await write(["scratch [1]", "notes.md"]);
	await write(["nested", "scratch [1]", "keep.md"]);
	await write(["generated.json"]);
	await write([".rhyza-debug", "dump.json"]);
	await write([".rhyzaignore"], "!generated.json\n");
	const other = path.join(root, "other");
	await mkdir(other);
	await writeFile(path.join(other, "generated.json"), needle);
	const [indexed, second] = await service.add([source, other]);
	const original = await service.getIndexingConfig(indexed.id);
	assert.equal(
		original.directories.find((entry) => entry.name === ".rhyza-debug")?.automaticallyExcluded,
		true,
	);
	assert.equal(
		original.directories.find((entry) => entry.name === "scratch [1]")?.automaticallyExcluded,
		false,
	);
	const saved = await service.saveIndexingConfig({
		id: indexed.id,
		excludedDirectories: ["scratch [1]"],
		excludePatterns: ["generated.json"],
	});
	assert.equal(saved.fileCount, 2);
	assert.equal("indexing" in saved, false, "indexing internals use their dedicated API");
	assert.equal(await readFile(path.join(source, "scratch [1]", "notes.md"), "utf8"), needle);
	assert.equal(await readFile(path.join(source, ".rhyzaignore"), "utf8"), "!generated.json\n");
	const restarted = new SourceService(data, async () => source);
	const config = await restarted.getIndexingConfig(indexed.id);
	assert.deepEqual(config.excludedDirectories, ["scratch [1]"]);
	assert.deepEqual(config.excludePatterns, ["generated.json"]);
	assert.deepEqual(
		new Set(
			(await restarted.search({ query: needle, sourceId: indexed.id })).map((hit) => hit.path),
		),
		new Set([path.join("docs", "guide.md"), path.join("nested", "scratch [1]", "keep.md")]),
	);
	await assert.rejects(
		restarted.read(indexed.id, path.join("scratch [1]", "notes.md")),
		/not part of the indexed source/,
	);
	assert.equal((await restarted.search({ query: needle, sourceId: second.id })).length, 1);
	await restarted.refresh(indexed.id);
	assert.equal((await restarted.list())[0].fileCount, 2, "ordinary refresh preserves exclusions");
	const restored = await restarted.saveIndexingConfig({
		id: indexed.id,
		excludedDirectories: [],
		excludePatterns: [],
	});
	assert.equal(restored.fileCount, 4, "clearing custom exclusions restores eligible files");
});

test("failed configuration saves do not persist or replace the prior options", async (t) => {
	const { source, data, service, write } = await fixture(t);
	await write(["docs", "guide.md"]);
	const [indexed] = await service.add([source]);
	const catalogPath = path.join(data, "sources", (await readdir(path.join(data, "sources")))[0]);
	const before = await readFile(catalogPath, "utf8");
	await write([".rhyzaignore"], "x".repeat(2_000_001));
	await assert.rejects(
		service.saveIndexingConfig({
			id: indexed.id,
			excludedDirectories: ["docs"],
			excludePatterns: [],
		}),
		/2 MB limit/,
	);
	assert.equal(await readFile(catalogPath, "utf8"), before);
	await write([".rhyzaignore"], "");
	assert.deepEqual((await service.getIndexingConfig(indexed.id)).excludedDirectories, []);
	assert.equal((await service.list())[0].fileCount, 1);
});

test("source indexing requests validate exclusion-only inputs and reject removed sources", async (t) => {
	assert.deepEqual(
		validateSourceIndexingSaveRequest({
			id: "source",
			excludedDirectories: ["docs", "docs"],
			excludePatterns: ["*.json"],
		}),
		{ id: "source", excludedDirectories: ["docs"], excludePatterns: ["*.json"] },
	);
	for (const directories of [
		[".."],
		["a/b"],
		["a\\b"],
		["a\nb"],
		[""],
		[42],
		new Array(501).fill("docs"),
	]) {
		assert.throws(
			() =>
				validateSourceIndexingSaveRequest({
					id: "source",
					excludedDirectories: directories,
					excludePatterns: [],
				}),
			/Invalid source exclusion settings/,
		);
	}
	for (const patterns of [
		["!include.md"],
		[" !include.md"],
		["a\nb"],
		[""],
		[42],
		["x".repeat(1025)],
	]) {
		assert.throws(
			() =>
				validateSourceIndexingSaveRequest({
					id: "source",
					excludedDirectories: [],
					excludePatterns: patterns,
				}),
			/Invalid source exclusion settings/,
		);
	}
	const { source, service, write } = await fixture(t);
	await write(["guide.md"]);
	const [indexed] = await service.add([source]);
	await service.remove(indexed.id);
	await assert.rejects(service.getIndexingConfig(indexed.id), /Source not found/);
	await assert.rejects(
		service.saveIndexingConfig({ id: indexed.id, excludedDirectories: [], excludePatterns: [] }),
		/Source not found/,
	);
});
