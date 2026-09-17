import assert from "node:assert/strict";
import test from "node:test";
import {
	applyAdaptiveGridSpacing,
	applyEstimatedComponentWidths,
	applySuggestedComponentWidths,
	applySuggestedLabelPositions,
	prepareArchifySpec,
} from "../src/runtime";
import { archifyToMermaid, isArchifyCodeBlock, parseArchifySource } from "../src/spec";
import { createArchifyPreviewHtml, prepareArchifyViewerHtml } from "../src/viewer";
import { patchArchifyExportHtml } from "../src/export";

const architectureSource = JSON.stringify({
	schema_version: 1,
	diagram_type: "architecture",
	meta: { title: "Runtime map", quality_profile: "showcase" },
	components: [
		{ id: "ui", type: "frontend", label: "Web UI" },
		{ id: "api", type: "backend", label: "API" },
	],
	connections: [{ id: "request", from: "ui", to: "api", label: "HTTPS" }],
});

test("parses Archify topology and creates a Mermaid fallback", () => {
	const parsed = parseArchifySource(architectureSource);
	assert.equal(parsed.type, "architecture");
	assert.equal(parsed.title, "Runtime map");
	assert.deepEqual(
		parsed.nodes.map((node) => node.key),
		["ui", "api"],
	);
	assert.deepEqual(parsed.edges[0], { sourceKey: "ui", targetKey: "api", label: "HTTPS" });
	assert.match(archifyToMermaid(architectureSource), /ui -->\|"HTTPS"\| api/);
});

test("recognizes only explicitly tagged Archify blocks", () => {
	assert.equal(isArchifyCodeBlock("language-archify"), true);
	assert.equal(isArchifyCodeBlock("language-json"), false);
	assert.throws(
		() => parseArchifySource('{"diagram_type":"unknown"}'),
		/diagram_type must be one of/,
	);
});

test("normalizes generic node-edge JSON mislabeled as Archify", () => {
	const source = JSON.stringify({
		title: "Runtime architecture",
		nodes: [
			{ id: "clients", label: "Clients", kind: "group", children: ["ui", "api"] },
			{ id: "ui", label: "Web UI", kind: "component" },
			{ id: "api", label: "API\nrequest handler", kind: "service" },
		],
		edges: [{ from: "ui", to: "api", label: "HTTPS" }],
	});
	const parsed = parseArchifySource(source);
	assert.equal(parsed.type, "architecture");
	assert.equal(parsed.spec.diagram_type, "architecture");
	assert.equal(parsed.spec.schema_version, 1);
	assert.deepEqual(
		parsed.nodes.map((node) => node.key),
		["ui", "api"],
	);
	assert.match(archifyToMermaid(source), /ui -->\|"HTTPS"\| api/);
});

test("normalizes legacy lane-event sequence JSON", () => {
	const source = JSON.stringify({
		version: "1.0",
		title: "Request path",
		type: "sequence",
		lanes: [
			{ id: "client", label: "Client" },
			{ id: "api", label: "API" },
		],
		events: [
			{ lane: "client", kind: "note", label: "Starts request" },
			{ from: "client", to: "api", label: "GET /items" },
		],
	});
	const parsed = parseArchifySource(source);
	assert.equal(parsed.type, "sequence");
	assert.equal(parsed.spec.diagram_type, "sequence");
	assert.match(archifyToMermaid(source), /client->>api: GET \/items/);
});

test("applies deterministic Archify labelAt repair suggestions", () => {
	const spec: Record<string, unknown> = {
		diagram_type: "architecture",
		connections: [
			{ id: "request", from: "clients", to: "apiEntry", label: "HTTP / API 请求", labelDy: -10 },
			{ id: "session", from: "coreSession", to: "legacyAgent", label: "会话上下文与执行协调" },
		],
	};
	const error = `Architecture layout validation failed:
- Label "HTTP / API 请求" overlaps component "clients" — adjust labelDx/labelDy/labelSegment or set labelAt.
  Suggested fix: labelAt [243, 316] or labelDy +60 (below); or labelAt [243, 226] or labelDy -30 (above)
- Label "会话上下文与执行协调" overlaps component "coreSession" — adjust labelDx/labelDy/labelSegment or set labelAt.
  Suggested fix: labelAt [748, 316] or labelDy +60 (below); or labelAt [748, 226] or labelDy -30 (above)`;
	assert.equal(applySuggestedLabelPositions(spec, error), 2);
	const connections = spec.connections as Array<Record<string, unknown>>;
	assert.deepEqual(connections[0].labelAt, [243, 316]);
	assert.equal(connections[0].labelDy, undefined);
	assert.deepEqual(connections[1].labelAt, [748, 316]);
	assert.equal(applySuggestedLabelPositions(spec, error), 0);
});

test("widens architecture components from Archify readability diagnostics", () => {
	const spec: Record<string, unknown> = {
		diagram_type: "architecture",
		components: [
			{ id: "execution", size: [112, 72] },
			{ id: "models", size: [112, 72] },
			{ id: "storage", size: [120, 72] },
		],
	};
	const error = `Architecture layout validation failed:
- Sublabel "Execution · Coordinator · Runner" needs ~116px at the 6px legible minimum, but component "execution" provides 112px — shorten the sublabel or widen size.
- Sublabel "Anthropic · OpenAI · Google · Azure · …" needs ~141px at the 6px legible minimum, but component "models" provides 112px — shorten the sublabel or widen size.
- Label "SessionStore / Database" (~152px) is wider than component "storage" (120px) — shorten the label or widen size.`;
	assert.equal(applySuggestedComponentWidths(spec, error), 3);
	const components = spec.components as Array<Record<string, unknown>>;
	assert.deepEqual(
		components.map((component) => component.size),
		[
			[128, 72],
			[153, 72],
			[164, 72],
		],
	);
	assert.equal(applySuggestedComponentWidths(spec, error), 0);
});

test("estimates readable architecture widths before validation", () => {
	const spec: Record<string, unknown> = {
		diagram_type: "architecture",
		components: [
			{
				id: "execution",
				label: "Execution",
				sublabel: "Execution · Coordinator · Runner",
				size: [112, 72],
			},
			{
				id: "models",
				label: "Models",
				sublabel: "Anthropic · OpenAI · Google · Azure · …",
				size: [112, 72],
			},
			{ id: "storage", label: "SessionStore / Database", size: [120, 72] },
		],
	};
	assert.equal(applyEstimatedComponentWidths(spec), 3);
	const components = spec.components as Array<Record<string, unknown>>;
	assert.deepEqual(
		components.map((component) => component.size),
		[
			[131, 72],
			[157, 72],
			[159, 72],
		],
	);
	assert.equal(applyEstimatedComponentWidths(spec), 0);
});

test("removes authored canvas limits before rendering", () => {
	const source = {
		diagram_type: "architecture",
		meta: {
			title: "Unbounded layout",
			output: "fixed.html",
			viewBox: [800, 600],
			visual_preset: "editorial",
		},
	};
	const prepared = prepareArchifySpec(source);
	const meta = prepared.meta as Record<string, unknown>;
	assert.equal(meta.output, undefined);
	assert.equal(meta.viewBox, undefined);
	assert.equal(meta.visual_preset, "classic");
	assert.deepEqual((source.meta as Record<string, unknown>).viewBox, [800, 600]);
});

test("grows grid columns with readable components without moving free-positioned nodes", () => {
	const spec: Record<string, unknown> = {
		diagram_type: "architecture",
		layout: { mode: "grid", cols: 10, cellW: 112, gapX: 40 },
		components: [
			{ id: "wide", row: 0, col: 0, size: [320, 72] },
			{ id: "next", row: 0, col: 1, size: [164, 72] },
			{ id: "free", pos: [20, 200], size: [700, 72] },
		],
	};
	applyAdaptiveGridSpacing(spec);
	assert.deepEqual(spec.layout, { mode: "grid", cols: 10, cellW: 320, gapX: 40 });
	const prepared = structuredClone(spec);
	applyAdaptiveGridSpacing(spec);
	assert.deepEqual(spec, prepared);
});

test("keeps generous authored grid spacing", () => {
	const spec = {
		diagram_type: "architecture",
		layout: { mode: "grid", cellW: 400 },
		components: [{ row: 0, col: 0, size: [164, 72] }],
	};
	applyAdaptiveGridSpacing(spec);
	assert.equal(spec.layout.cellW, 400);
});

test("embeds compact customization before the upstream viewer starts", () => {
	const html =
		'<!doctype html><html lang="en" data-theme="dark" data-preset="editorial"><head></head><body><button id="btn-theme"></button><div class="cards"></div><script>startViewer()</script></body></html>';
	const prepared = prepareArchifyViewerHtml(html, { theme: "light", mode: "inline" });
	assert(prepared.indexOf('id="rhyza-archify-host"') < prepared.indexOf("startViewer()"));
	assert.match(prepared, /const theme = "light"/);
	assert.match(prepared, /<html[^>]*data-rhyza-mode="inline"/);
	assert.match(prepared, /root\.setAttribute\("data-preset", "classic"\)/);
	assert.match(prepared, /#btn-route-probe/);
	assert.match(prepared, /\.cards/);
	assert.match(prepared, /\.pulse-dot/);
	assert.match(prepared, /MutationObserver/);
	assert.match(prepared, /getBBox/);
	assert.match(prepared, /data-rhyza-fitted/);
	assert.match(prepared, /ResizeObserver/);
	assert.match(prepared, /max-width: none !important/);
	assert.match(prepared, /min-width: 0 !important/);
	assert.doesNotMatch(prepared, /--rhyza-diagram-height|window\.innerHeight/);
	assert.match(prepared, /new Set\(\["png", "webp", "svg"\]\)/);
	assert.doesNotMatch(prepared, /postMessage/);
	assert.doesNotMatch(prepared, /setTimeout/);
});

test("full Archify viewer restores toolbar, title, and guided content", () => {
	const html =
		'<html data-theme="light" data-preset="signal-flow"><head></head><body><div class="cards"></div></body></html>';
	const prepared = prepareArchifyViewerHtml(html, { theme: "dark", mode: "expanded" });
	assert.match(prepared, /<html[^>]*data-rhyza-mode="expanded"/);
	assert.match(prepared, /const theme = "dark"/);
	assert.doesNotMatch(prepared, /\.toolbar > :not\(\.export-wrap\)/);
});

test("standalone artifacts default to full mode and the system theme", () => {
	const prepared = prepareArchifyViewerHtml("<html><head></head><body></body></html>");
	assert.match(prepared, /<html[^>]*data-rhyza-mode="expanded"/);
	assert.match(prepared, /const theme = null/);
	assert.match(prepared, /prefers-color-scheme: dark/);
});

test("compact previews are derived from full HTML without changing content or scripts", () => {
	const full = prepareArchifyViewerHtml(
		'<html><head></head><body><div class="header">Title</div><svg><text>Diagram</text></svg></body></html>',
	);
	const preview = createArchifyPreviewHtml(full);
	assert.equal(preview.replace('data-rhyza-mode="inline"', 'data-rhyza-mode="expanded"'), full);
	assert.equal((preview.match(/id="rhyza-archify-host"/g) ?? []).length, 1);
	assert.throws(() => createArchifyPreviewHtml("<html></html>"), /derived from the full/);
});

test("export adaptation fails explicitly when the upstream serializer changes", () => {
	assert.throws(() => patchArchifyExportHtml("<html></html>"), /does not match/);
});
