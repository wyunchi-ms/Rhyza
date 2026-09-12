import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode } from "../src/types/index.js";
import { layoutSessionGraph } from "../src/utils/sessionGraph.js";

test("horizontal graph lays children to the right of their parent", () => {
	const positions = new Map(layoutSessionGraph(sessions(), "horizontal").map((node) => [node.id, node]));
	assert.ok(positions.get("child")!.x > positions.get("root")!.x);
	assert.ok(positions.get("sibling")!.x > positions.get("root")!.x);
});

test("vertical graph lays children below their parent", () => {
	const positions = new Map(layoutSessionGraph(sessions(), "vertical").map((node) => [node.id, node]));
	assert.ok(positions.get("child")!.y > positions.get("root")!.y);
	assert.ok(positions.get("sibling")!.y > positions.get("root")!.y);
});

function sessions(): SessionNode[] {
	return [
		{ id: "root", parentId: null, title: "Root", isRoot: true, status: "idle" },
		{ id: "child", parentId: "root", title: "Child", isRoot: false, status: "idle" },
		{ id: "sibling", parentId: "root", title: "Sibling", isRoot: false, status: "idle" },
	];
}
