import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { changedFiles, formatFiles, isSourcePath, patchFiles } from "../scripts/format-code.mjs";

async function fixture(context) {
	const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-format-test-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(
		path.join(root, ".prettierrc.json"),
		JSON.stringify({ useTabs: true, printWidth: 100 }),
	);
	return root;
}

test("formats TS, TSX, HTML and CSS and a second pass writes nothing", async (context) => {
	const root = await fixture(context);
	const inputs = {
		"handler.ts": "export function run(){const value=1;return value+2}",
		"Card.tsx": "export function Card(){return <section><h1>Hello</h1><p>Body</p></section>}",
		"page.html": "<!doctype html><html><body><main><h1>Hello</h1></main></body></html>",
		"style.css": ".card{color:red;background:white;border:1px solid black}",
	};
	for (const [name, text] of Object.entries(inputs)) {
		await writeFile(path.join(root, name), text);
	}
	assert.equal((await formatFiles(root, Object.keys(inputs), true)).length, 4);
	assert.equal(await readFile(path.join(root, "handler.ts"), "utf8"), inputs["handler.ts"]);
	assert.equal((await formatFiles(root, Object.keys(inputs))).length, 4);
	assert.match(await readFile(path.join(root, "handler.ts"), "utf8"), /\{\n\tconst value = 1;/);
	assert.match(await readFile(path.join(root, "style.css"), "utf8"), /\.card \{\n\tcolor: red;/);
	assert.deepEqual(await formatFiles(root, Object.keys(inputs)), []);
});

test("reserved directories and paths outside the repo are rejected before reading files", () => {
	const root = path.resolve(os.tmpdir(), "rhyza-boundary-test");
	for (const file of [
		".sisyphus/demo.tsx",
		".sisphus/test.ts",
		".SISYPHUS/nested/style.css",
		"nested/.sisyphus/fixture.html",
		".codex/hooks.json",
		"node_modules/pkg/index.ts",
		"dist/app.js",
		"dist-electron/app.js",
		"resources/skills/vendor/index.js",
		"archify-extension/skills/archify/renderers/index.mjs",
		"extensions/pi-archify/skills/archify/renderers/index.mjs",
		"dist-extensions/archify/index.js",
		"../outside.ts",
		"package-lock.json",
		"app.min.js",
	]) {
		assert.equal(isSourcePath(root, file), false, file);
	}
	assert.equal(isSourcePath(root, "src/file with spaces.tsx"), true);
	assert.equal(isSourcePath(root, "extensions/pi-archify/src/viewer.ts"), true);
});

test("honors ignore files and does not rewrite invalid source", async (context) => {
	const root = await fixture(context);
	await writeFile(path.join(root, ".prettierignore"), "ignored.ts\n");
	await writeFile(path.join(root, "ignored.ts"), "const x=1");
	await writeFile(path.join(root, "broken.ts"), "function broken( {");
	assert.deepEqual(await formatFiles(root, ["ignored.ts"]), []);
	assert.equal(await readFile(path.join(root, "ignored.ts"), "utf8"), "const x=1");
	await assert.rejects(formatFiles(root, ["broken.ts"]));
	assert.equal(await readFile(path.join(root, "broken.ts"), "utf8"), "function broken( {");
});

test("patch parsing includes added, edited and moved files but skips deletions", () => {
	assert.deepEqual(
		patchFiles(
			"*** Begin Patch\r\n*** Add File: src/a.ts\r\n+x\r\n*** Update File: src/old.ts\r\n*** Move to: src/new name.ts\r\n*** Delete File: gone.ts\r\n*** End Patch",
		),
		["src/a.ts", "src/old.ts", "src/new name.ts"],
	);
});

test("collects staged, unstaged and untracked files without touching clean files", async (context) => {
	const root = await fixture(context);
	const git = (...args) => execFileSync("git", args, { cwd: root, windowsHide: true });
	git("init", "--quiet");
	await mkdir(path.join(root, "src"));
	for (const name of ["clean.ts", "edited.ts", "staged.ts"]) {
		await writeFile(path.join(root, "src", name), "export const x = 1;\n");
	}
	git("add", ".");
	git(
		"-c",
		"user.name=Formatter test",
		"-c",
		"user.email=formatter@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--quiet",
		"-m",
		"fixture",
	);
	await writeFile(path.join(root, "src", "edited.ts"), "export const x=2;");
	await writeFile(path.join(root, "src", "staged.ts"), "export const x=3;");
	git("add", "src/staged.ts");
	await writeFile(path.join(root, "src", "new file.ts"), "export const x=4;");
	assert.deepEqual(changedFiles(root).sort(), [
		"src/edited.ts",
		"src/new file.ts",
		"src/staged.ts",
	]);
});
