import assert from "node:assert/strict";
import test from "node:test";
import { isMermaidSource } from "../src/utils/mermaidSource";

test("Mermaid saves accept the supported declarations, comments and frontmatter", () => {
	for (const source of [
		"flowchart TD\n A-->B",
		"%% generated diagram\nsequenceDiagram\n A->>B: Hello",
		'---\ntitle: Example\n---\npie\n "A": 1',
		"classDiagram\n class A",
		"architecture-beta\n group api(cloud)[API]",
		"stateDiagram-v2\n [*]-->A",
		"mindmap\n root((Root))",
		"xychart-beta\n bar [1, 2]",
	]) {
		assert.equal(isMermaidSource(source), true, source);
	}
});

test("Mermaid declaration detection rejects absent and unsupported sources", () => {
	for (const source of [null, undefined, 3, "", "%% comment only", "A-->B", "flowcharts TD"]) {
		assert.equal(isMermaidSource(source), false, String(source));
	}
});
