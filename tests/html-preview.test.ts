import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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

const fence = (filename: string, previewPath?: string, title = "Preview") =>
	`\`\`\`html-preview\n${JSON.stringify({ version: 1, path: filename, previewPath, title })}\n\`\`\``;

test("preview declarations preserve legacy references and optional compact paths with spaces", () => {
	assert.deepEqual(parseHtmlPreviewReference('{"version":1,"path":"output/a b.html"}'), {
		version: 1,
		path: "output/a b.html",
	});
	const reference = {
		version: 1,
		path: "output/full page.html",
		previewPath: "output/compact page.htm",
		title: "A page",
	};
	assert.deepEqual(parseHtmlPreviewReference(JSON.stringify(reference)), reference);
	assert.throws(() => parseHtmlPreviewReference('{"path":"a.html"}'));
	assert.throws(() => parseHtmlPreviewReference('{"version":1,"path":"a.html","title":5}'));
	assert.throws(() => parseHtmlPreviewReference('{"version":2,"path":"a.html"}'));
	assert.deepEqual(extractHtmlPreviewReferences("```html-preview\ninvalid\n```"), []);
});

test("full and compact paths share string, length and control-character validation", () => {
	for (const field of ["path", "previewPath"]) {
		for (const value of [
			null,
			0,
			false,
			[],
			{},
			"",
			" \t ",
			"x".repeat(2049),
			...Array.from({ length: 32 }, (_, code) => `page${String.fromCharCode(code)}.html`),
		]) {
			const reference = { version: 1, path: "full.html", [field]: value };
			assert.throws(() => parseHtmlPreviewReference(JSON.stringify(reference)));
			assert.deepEqual(
				extractHtmlPreviewReferences(`\`\`\`html-preview\n${JSON.stringify(reference)}\n\`\`\``),
				[],
			);
		}
		const reference = { version: 1, path: "full.html", [field]: "x".repeat(2048) };
		assert.deepEqual(parseHtmlPreviewReference(JSON.stringify(reference)), reference);
	}
});

test("deduplication uses the full and compact path pair, ignores titles and keeps eight pairs", () => {
	const references = extractHtmlPreviewReferences(
		[
			fence("full.html"),
			fence("full.html", undefined, "Another title"),
			fence("full.html", "compact-a.html"),
			fence("full.html", "compact-a.html", "Another title"),
			fence("full.html", "compact-b.html"),
		].join("\n"),
	);
	assert.deepEqual(
		references.map(({ path, previewPath }) => [path, previewPath]),
		[
			["full.html", undefined],
			["full.html", "compact-a.html"],
			["full.html", "compact-b.html"],
		],
	);
	assert(references.every(({ title }) => title === "Preview"));
	assert.equal(
		extractHtmlPreviewReferences(
			Array.from({ length: 10 }, (_, index) => fence("full.html", `compact-${index}.html`)).join(
				"\n",
			),
		).length,
		8,
	);
});

test("both snapshots and legacy documents survive serialization and deleting their source files", async () => {
	const root = await mkdtemp(path.join(process.cwd(), ".rhyza-html-preview-"));
	try {
		const html =
			'<!doctype html><h1>A standalone page</h1><script>document.body.dataset.ready="yes"</script>';
		const previewHtml = "<!doctype html><p>Compact page</p>";
		const filename = path.join(root, "page with spaces.html");
		await writeFile(filename, html);
		const compactFilename = path.join(root, "compact page.htm");
		await writeFile(compactFilename, previewHtml);
		const documents = await collectHtmlPreviews(
			[
				fence("page with spaces.html"),
				fence("page with spaces.html", "compact page.htm"),
				fence("page with spaces.html", "compact page.htm", "Duplicate"),
			].join("\n"),
			root,
		);
		await rm(filename);
		await rm(compactFilename);
		assert.deepEqual(JSON.parse(JSON.stringify(documents)), [
			{ version: 1, path: "page with spaces.html", title: "Preview", html },
			{
				version: 1,
				path: "page with spaces.html",
				previewPath: "compact page.htm",
				title: "Preview",
				html,
				previewHtml,
			},
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("both files reject traversal, junction escapes, non-HTML, non-files and oversize content", async () => {
	const root = await mkdtemp(path.join(process.cwd(), ".rhyza-html-boundary-"));
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
		await writeFile(path.join(workspace, "compact.HTM"), "<p>Compact</p>");
		await mkdir(path.join(workspace, "directory.html"));
		const invalidPaths = [
			path.join("..", "outside", "private.html"),
			path.join(outside, "private.html"),
			path.join("linked", "private.html"),
			"text.txt",
			"big.html",
			"missing.html",
			"directory.html",
		];
		for (const field of ["path", "previewPath"]) {
			const documents = await collectHtmlPreviews(
				[
					...invalidPaths.map((filename) =>
						field === "path" ? fence(filename, "compact.HTM") : fence("ok.html", filename),
					),
					fence("ok.html", "compact.HTM"),
				].join("\n"),
				workspace,
			);
			assert.equal(documents.length, 8);
			for (const document of documents.slice(0, 7)) {
				assert.equal(document.previewHtml, undefined);
				if (field === "path") {
					assert(document.error);
					assert.equal(document.html, undefined);
					assert.equal(document.previewError, undefined);
				} else {
					assert.equal(document.html, "<h1>OK</h1>");
					assert.equal(document.error, undefined);
					assert(document.previewError);
				}
			}
			assert.equal(documents[7].html, "<h1>OK</h1>");
			assert.equal(documents[7].previewHtml, "<p>Compact</p>");
			assert.equal(documents[7].error, undefined);
			assert.equal(documents[7].previewError, undefined);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("optional preview errors persist beside full HTML and empty compact documents are valid", async () => {
	const root = await mkdtemp(path.join(process.cwd(), ".rhyza-html-fallback-"));
	try {
		await writeFile(path.join(root, "full.html"), "<h1>Full page</h1>");
		await writeFile(path.join(root, "empty.html"), "");
		const documents = await collectHtmlPreviews(
			[fence("full.html", "missing.html"), fence("full.html", "empty.html")].join("\n"),
			root,
		);
		await rm(path.join(root, "full.html"));
		const saved = JSON.parse(JSON.stringify(documents));
		assert.equal(saved[0].html, "<h1>Full page</h1>");
		assert.match(saved[0].previewError, /ENOENT/);
		assert.equal(saved[0].previewHtml, undefined);
		assert.equal(saved[0].error, undefined);
		assert.equal(saved[1].previewHtml, "");
		assert.equal(saved[1].previewError, undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("both snapshots accept exactly 5MB each, count UTF-8 bytes and enforce 10MB total", async () => {
	const root = await mkdtemp(path.join(process.cwd(), ".rhyza-html-limit-"));
	try {
		const html = "é".repeat(2_500_000);
		const previewHtml = "p".repeat(5_000_000);
		await writeFile(path.join(root, "full.html"), html);
		await writeFile(path.join(root, "compact.html"), previewHtml);
		await writeFile(path.join(root, "one.html"), "x");
		const documents = await collectHtmlPreviews(
			[fence("full.html", "compact.html"), fence("one.html")].join("\n"),
			root,
		);
		assert.equal(documents[0].html, html);
		assert.equal(documents[0].previewHtml, previewHtml);
		assert.equal(documents[0].error, undefined);
		assert.equal(documents[0].previewError, undefined);
		assert.match(documents[1].error ?? "", /size limit/);
		assert.equal(documents[1].html, undefined);
		const sameFile = await collectHtmlPreviews(
			[fence("full.html", "full.html"), fence("one.html")].join("\n"),
			root,
		);
		assert.equal(sameFile[0].html, html);
		assert.equal(sameFile[0].previewHtml, html);
		assert.match(sameFile[1].error ?? "", /size limit/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("the shared budget retains full HTML when compact exceeds the remaining total", async () => {
	const root = await mkdtemp(path.join(process.cwd(), ".rhyza-html-total-"));
	try {
		await writeFile(path.join(root, "first.html"), "a".repeat(4_000_000));
		await writeFile(path.join(root, "first-compact.html"), "b".repeat(4_000_000));
		await writeFile(path.join(root, "next.html"), "c".repeat(1_000_000));
		await writeFile(path.join(root, "too-large-compact.html"), "d".repeat(1_000_001));
		await writeFile(path.join(root, "last.html"), "e".repeat(1_000_000));
		await writeFile(path.join(root, "one.html"), "x");
		const documents = await collectHtmlPreviews(
			[
				fence("first.html", "first-compact.html"),
				fence("next.html", "too-large-compact.html"),
				fence("last.html"),
				fence("one.html"),
			].join("\n"),
			root,
		);
		assert.equal(documents[0].previewHtml?.length, 4_000_000);
		assert.equal(documents[1].html?.length, 1_000_000);
		assert.equal(documents[1].previewHtml, undefined);
		assert.match(documents[1].previewError ?? "", /size limit/);
		assert.equal(documents[1].error, undefined);
		assert.equal(documents[2].html?.length, 1_000_000);
		assert.equal(documents[2].error, undefined);
		assert.match(documents[3].error ?? "", /size limit/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("distinct compact paths keep separate full copies and cannot bypass the total limit", async () => {
	const root = await mkdtemp(path.join(process.cwd(), ".rhyza-html-identity-"));
	try {
		await writeFile(path.join(root, "full.html"), "x".repeat(3_000_000));
		await writeFile(path.join(root, "compact-a.html"), "a".repeat(2_000_000));
		await writeFile(path.join(root, "compact-b.html"), "b".repeat(2_000_001));
		const documents = await collectHtmlPreviews(
			[
				fence("full.html", "compact-a.html"),
				fence("full.html", "compact-a.html"),
				fence("full.html", "compact-b.html"),
				fence("full.html"),
			].join("\n"),
			root,
		);
		assert.equal(documents.length, 3);
		assert.equal(documents[0].previewHtml?.length, 2_000_000);
		assert.equal(documents[1].html?.length, 3_000_000);
		assert.match(documents[1].previewError ?? "", /size limit/);
		assert.match(documents[2].error ?? "", /size limit/);
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
	const root = await mkdtemp(path.join(process.cwd(), ".rhyza-local-package-"));
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
