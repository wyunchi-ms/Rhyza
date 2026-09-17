import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { collectHtmlPreviews } from "../electron/main/html-preview-service";
import {
	extractHtmlPreviewReferences,
	parseHtmlPreviewReference,
	readHtmlPreviewHeight,
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

test("preview height messages require the current document and a positive finite number", () => {
	const message = { type: "rhyza:html-preview-resize", id: "current", height: 1700.25 };
	assert.equal(readHtmlPreviewHeight(message, "current"), 1701);
	assert.equal(readHtmlPreviewHeight(message, "previous"), null);
	for (const data of [
		null,
		undefined,
		1700,
		{},
		{ ...message, type: "other" },
		...[0, -1, NaN, Infinity, "1700", null].map((height) => ({ ...message, height })),
	]) {
		assert.equal(readHtmlPreviewHeight(data, "current"), null);
	}
});

test("only inline documents receive sizing code and the CSP still precedes every script", () => {
	const original = '<html><body><script>document.title = "Original";</script></body></html>';
	const inline = sandboxHtmlDocument(original, "</script><script>unexpected()</script>");
	assert(inline.indexOf("Content-Security-Policy") < inline.indexOf("<script>"));
	assert.match(inline, /ResizeObserver/);
	assert.match(inline, /min-height: 0 !important/);
	assert.match(inline, /overflow-y: hidden !important/);
	assert(inline.endsWith(original));
	assert.equal((inline.match(/<script>/g) ?? []).length, 2);
	assert(!sandboxHtmlDocument(original).includes("ResizeObserver"));
	assert(!sandboxHtmlDocument(original).includes("min-height"));
	assert(!sandboxHtmlDocument(original).includes("overflow-y"));
});

test("sandbox sizing grows, shrinks, coalesces changes, and cleans up without viewport feedback", () => {
	const html = sandboxHtmlDocument("<p>Preview</p>", "document-id");
	const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
	assert(script);
	const listeners = new Map<string, (event?: unknown) => void>();
	const frames = new Map<number, () => void>();
	const reports: unknown[] = [];
	const observers: FakeObserver[] = [];
	let nextFrame = 0;
	let contentHeight = 1600;
	let now = 0;
	let fontReady: () => void = () => {};
	class FakeObserver {
		disconnected = false;
		constructor(public callback: () => void) {
			observers.push(this);
		}
		observe() {}
		disconnect() {
			this.disconnected = true;
		}
	}
	const events = {
		addEventListener: (name: string, callback: (event?: unknown) => void) =>
			listeners.set(name, callback),
		removeEventListener: (name: string) => listeners.delete(name),
	};
	const parent = { postMessage: (message: unknown) => reports.push(message) };
	const root = {
		clientHeight: 150,
		getBoundingClientRect: () => ({ height: contentHeight + 16 }),
		get scrollHeight() {
			throw new Error("Viewport-floored scrollHeight must not drive inline height.");
		},
	};
	const window = { ...events, scrollY: 0, innerHeight: 150 };
	runInNewContext(script, {
		parent,
		window,
		performance: { now: () => now },
		document: {
			...events,
			documentElement: root,
			body: {
				getBoundingClientRect: () => ({ top: 8, bottom: contentHeight + 8 }),
				get scrollHeight() {
					return contentHeight;
				},
			},
			fonts: {
				ready: {
					then: (callback: () => void) => {
						fontReady = callback;
					},
				},
			},
		},
		getComputedStyle: () => ({ marginBottom: "8px" }),
		ResizeObserver: FakeObserver,
		MutationObserver: FakeObserver,
		requestAnimationFrame: (callback: () => void) => {
			frames.set(++nextFrame, callback);
			return nextFrame;
		},
		cancelAnimationFrame: (id: number) => frames.delete(id),
	});
	const flush = () => {
		assert.equal(frames.size, 1);
		now += 16;
		const callbacks = [...frames.values()];
		frames.clear();
		callbacks.forEach((callback) => callback());
	};
	const settle = () => {
		for (let attempt = 0; frames.size > 0 && attempt < 20; attempt++) flush();
		assert.equal(frames.size, 0, "Height measurement must stop once the layout settles.");
	};
	const height = () => readHtmlPreviewHeight(reports.at(-1), "document-id");
	listeners.get("DOMContentLoaded")?.();
	flush();
	assert.equal(height(), 1616);
	window.innerHeight = root.clientHeight = 1616;
	observers.forEach((observer) => observer.callback());
	flush();
	assert.equal(reports.length, 1);

	contentHeight = 2400;
	observers.forEach((observer) => observer.callback());
	listeners.get("load")?.();
	fontReady();
	flush();
	assert.equal(height(), 2416);
	window.innerHeight = root.clientHeight = 2416;

	contentHeight = 2359;
	observers[0].callback();
	for (let index = 0; index < 5; index++) flush();
	assert.equal(
		height(),
		2416,
		"Temporary removal of 41px toolbar space must not shrink the frame.",
	);
	contentHeight = 2400;
	flush();
	assert.equal(reports.length, 2);
	assert.equal(frames.size, 0);

	contentHeight = 80;
	observers.forEach((observer) => observer.callback());
	listeners.get("resize")?.();
	flush();
	assert.equal(height(), 2416, "A smaller height must settle before being reported.");
	settle();
	assert.equal(height(), 96);
	window.innerHeight = 96;
	root.clientHeight = 81;
	listeners.get("resize")?.();
	flush();
	assert.equal(height(), 111);

	const request = { type: "rhyza:html-preview-measure", id: "document-id" };
	listeners.get("message")?.({ source: {}, data: request });
	listeners.get("message")?.({ source: parent, data: { ...request, id: "old" } });
	assert.equal(frames.size, 0);
	listeners.get("message")?.({ source: parent, data: request });
	flush();
	assert.equal(reports.length, 5);

	window.innerHeight = root.clientHeight = 111;
	contentHeight = 80.25;
	observers[0].callback();
	flush();
	settle();
	assert.equal(height(), 97);
	const reportCount = reports.length;
	for (const roundedHeight of [80, 80.25, 80, 80.25]) {
		contentHeight = roundedHeight;
		window.innerHeight = root.clientHeight = 97;
		observers[0].callback();
		flush();
		assert.equal(reports.length, reportCount);
	}
	contentHeight = 81.25;
	observers[0].callback();
	flush();
	assert.equal(height(), 98);
	contentHeight = 64;
	observers[0].callback();
	flush();
	settle();
	assert.equal(height(), 80);

	contentHeight = 32;
	listeners.get("resize")?.();
	flush();
	listeners.get("pagehide")?.();
	assert.equal(frames.size, 0);
	assert(observers.every((observer) => observer.disconnected));
	for (const event of ["resize", "message", "load"]) assert(!listeners.has(event));
	fontReady();
	assert.equal(frames.size, 0);
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
