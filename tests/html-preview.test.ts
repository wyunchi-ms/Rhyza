import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectHtmlPreviews } from "../electron/main/html-preview-service";
import {
	extractHtmlPreviewReferences,
	parseHtmlPreviewReference,
	sandboxHtmlDocument,
} from "../src/shared/html-preview";
import { PiPluginService } from "../electron/main/pi-plugin-service";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const fence = (filename: string) =>
	`\`\`\`html-preview\n${JSON.stringify({ version: 1, path: filename, title: "Preview" })}\n\`\`\``;

test("preview declarations require a version and preserve paths with spaces", () => {
	assert.deepEqual(parseHtmlPreviewReference('{"version":1,"path":"output/a b.html"}'), {
		version: 1,
		path: "output/a b.html",
	});
	assert.throws(() => parseHtmlPreviewReference('{"path":"a.html"}'));
	assert.throws(() => parseHtmlPreviewReference('{"version":1,"path":"a.html","title":5}'));
	assert.equal(extractHtmlPreviewReferences(`${fence("a.html")}\n${fence("a.html")}`).length, 1);
	assert.deepEqual(extractHtmlPreviewReferences("```html-preview\ninvalid\n```"), []);
});

test("HTML is snapshotted and survives deleting its source file", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-html-preview-"));
	try {
		const html =
			'<!doctype html><h1>A standalone page</h1><script>document.body.dataset.ready="yes"</script>';
		const filename = path.join(root, "page with spaces.html");
		await writeFile(filename, html);
		const documents = await collectHtmlPreviews(fence("page with spaces.html"), root);
		await rm(filename);
		assert.equal(JSON.parse(JSON.stringify(documents))[0].html, html);
		assert.equal(documents[0].error, undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("file boundaries reject traversal, junction escapes, non-HTML and oversize files without failing other previews", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-html-boundary-"));
	try {
		const workspace = path.join(root, "workspace");
		const outside = path.join(root, "outside");
		await mkdir(workspace);
		await mkdir(outside);
		await writeFile(path.join(outside, "private.html"), "outside");
		await symlink(
			outside,
			path.join(workspace, "linked"),
			process.platform === "win32" ? "junction" : "dir",
		);
		await writeFile(path.join(workspace, "text.txt"), "text");
		await writeFile(path.join(workspace, "big.html"), "x".repeat(5_000_001));
		await writeFile(path.join(workspace, "ok.html"), "<h1>OK</h1>");
		const documents = await collectHtmlPreviews(
			[
				"../outside/private.html",
				"linked/private.html",
				"text.txt",
				"big.html",
				"missing.html",
				"ok.html",
			]
				.map(fence)
				.join("\n"),
			workspace,
		);
		assert.equal(documents.length, 6);
		assert(documents.slice(0, 5).every((item) => item.error && item.html === undefined));
		assert.equal(documents[5].html, "<h1>OK</h1>");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("preview CSP precedes user content and blocks network and nested frames", () => {
	const html = sandboxHtmlDocument(
		'<html><head><script src="https://invalid.example/script.js"></script></head></html>',
	);
	assert(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
	assert.match(html, /connect-src 'none'/);
	assert.match(html, /frame-src 'none'/);
	assert.match(html, /script-src 'unsafe-inline'/);
});

test("ordinary local Pi extensions install, load tools and guidance, and uninstall without deleting their files", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-local-package-"));
	try {
		const source = path.join(root, "a local extension");
		await mkdir(source);
		await writeFile(
			path.join(source, "package.json"),
			JSON.stringify({ name: "html-example", type: "module", pi: { extensions: ["index.ts"] } }),
		);
		await writeFile(
			path.join(source, "index.ts"),
			`export default function(pi) {
			pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt + "\\nUse generated HTML" }));
			pi.registerTool({ name: "example_html", label: "HTML", description: "Generate HTML", parameters: {type:"object", properties:{}}, execute: async () => ({content:[{type:"text",text:"done"}], details:{}}) });
		}`,
		);
		const agentDir = path.join(root, "agent");
		const plugins = new PiPluginService(agentDir, async () => root);
		await plugins.install(source);
		const restarted = new PiPluginService(agentDir, async () => root);
		assert.equal((await restarted.list())[0].installed, true);
		const loader = new DefaultResourceLoader({ cwd: root, agentDir });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert(
			loader
				.getExtensions()
				.extensions.some(
					(extension) =>
						extension.tools.has("example_html") && extension.handlers.has("before_agent_start"),
				),
		);
		await restarted.remove(source);
		await loader.reload();
		assert.equal(loader.getExtensions().extensions.length, 0);
		assert.equal((await plugins.install(source))[0].installed, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
