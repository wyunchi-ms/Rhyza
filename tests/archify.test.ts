import assert from "node:assert/strict";
import test from "node:test";
import { applySuggestedLabelPositions } from "../electron/main/archify-service";
import { archifyToMermaid, isArchifyCodeBlock, parseArchifySource } from "../src/shared/archify";
import { prepareArchifyViewerHtml } from "../src/shared/archify-viewer";

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
	assert.deepEqual(parsed.nodes.map((node) => node.key), ["ui", "api"]);
	assert.deepEqual(parsed.edges[0], { sourceKey: "ui", targetKey: "api", label: "HTTPS" });
	assert.match(archifyToMermaid(architectureSource), /ui -->\|"HTTPS"\| api/);
});

test("recognizes only explicitly tagged Archify blocks", () => {
	assert.equal(isArchifyCodeBlock("language-archify"), true);
	assert.equal(isArchifyCodeBlock("language-json"), false);
	assert.throws(() => parseArchifySource('{"diagram_type":"unknown"}'), /diagram_type must be one of/);
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
	assert.deepEqual(parsed.nodes.map((node) => node.key), ["ui", "api"]);
	assert.match(archifyToMermaid(source), /ui -->\|"HTTPS"\| api/);
});

test("normalizes legacy lane-event sequence JSON", () => {
	const source = JSON.stringify({
		version: "1.0",
		title: "Request path",
		type: "sequence",
		lanes: [{ id: "client", label: "Client" }, { id: "api", label: "API" }],
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

test("adapts Archify HTML for the app-owned inline viewer", () => {
	const html = '<!doctype html><html lang="en" data-theme="dark" data-preset="editorial"><head></head><body><button id="btn-theme"></button><div class="cards"></div></body></html>';
	const prepared = prepareArchifyViewerHtml(html, { theme: "light", mode: "inline" });
	assert.match(prepared, /data-rhyza-viewer="true"/);
	assert.match(prepared, /data-rhyza-mode="inline"/);
	assert.match(prepared, /data-theme="light"/);
	assert.match(prepared, /data-preset="classic"/);
	assert.match(prepared, /#btn-route-probe/);
	assert.match(prepared, /\.cards/);
	assert.match(prepared, /\.pulse-dot/);
	assert.match(prepared, /MutationObserver/);
	assert.match(prepared, /rhyza:archify-size/);
	assert.match(prepared, /rhyza:archify-measure/);
	assert.match(prepared, /root\.scrollHeight/);
	assert.match(prepared, /body\.scrollHeight/);
	assert.match(prepared, /\.export-menu-section:has\(button\[data-format="share-card"\]\)/);
	assert.match(prepared, /scrollbar-width: none/);
	assert.doesNotMatch(prepared, /data-preset="editorial"/);
});

test("expanded Archify viewer keeps advanced content while hiding host-owned controls", () => {
	const html = '<html data-theme="light" data-preset="signal-flow"><head></head><body><div class="cards"></div></body></html>';
	const prepared = prepareArchifyViewerHtml(html, { theme: "dark", mode: "expanded" });
	assert.match(prepared, /data-rhyza-mode="expanded"/);
	assert.match(prepared, /data-theme="dark"/);
	assert.match(prepared, /\.toolbar > :not\(\.export-wrap\)/);
	assert.doesNotMatch(prepared, /data-preset="signal-flow"/);
});
