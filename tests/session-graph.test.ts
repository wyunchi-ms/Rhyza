import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode } from "../src/types/index.js";
import { groupSummarySourceEdges, layoutSessionGraph } from "../src/utils/sessionGraph.js";

test("horizontal graph lays children to the right of their parent", () => {
	const positions = new Map(
		layoutSessionGraph(sessions(), "horizontal").map((node) => [node.id, node]),
	);
	assert.ok(positions.get("child")!.x > positions.get("root")!.x);
	assert.ok(positions.get("sibling")!.x > positions.get("root")!.x);
});

test("vertical graph lays children below their parent", () => {
	const positions = new Map(
		layoutSessionGraph(sessions(), "vertical").map((node) => [node.id, node]),
	);
	assert.ok(positions.get("child")!.y > positions.get("root")!.y);
	assert.ok(positions.get("sibling")!.y > positions.get("root")!.y);
});

test("summaries with the same sources share a junction without merging distinct source sets", () => {
	const groups = groupSummarySourceEdges([
		{ source: "child", target: "summary-a" },
		{ source: "sibling", target: "summary-a" },
		{ source: "sibling", target: "summary-b" },
		{ source: "child", target: "summary-b" },
		{ source: "child", target: "summary-a" },
		{ source: "child", target: "summary-c" },
	]);
	assert.deepEqual(groups, [
		{
			id: "summary-sources:summary-a",
			sources: ["child", "sibling"],
			targets: ["summary-a", "summary-b"],
		},
		{ id: "summary-sources:summary-c", sources: ["child"], targets: ["summary-c"] },
	]);
	for (const orientation of ["horizontal", "vertical"] as const) {
		const positions = new Map(
			layoutSessionGraph(
				[
					...sessions(),
					...["summary-a", "summary-b", "summary-c"].map((id) => ({
						id,
						parentId: null,
					})),
				],
				orientation,
				groups,
			).map((node) => [node.id, node]),
		);
		assert.equal(positions.size, 8, `${orientation} positions all sessions and both junctions`);
		const axis = orientation === "horizontal" ? "x" : "y";
		assert.ok(positions.get(groups[0].id)![axis] > positions.get("child")![axis]);
		assert.ok(positions.get(groups[0].id)![axis] > positions.get("sibling")![axis]);
		assert.ok(positions.get("summary-a")![axis] > positions.get(groups[0].id)![axis]);
		assert.ok(positions.get("summary-b")![axis] > positions.get(groups[0].id)![axis]);
		assert.ok(positions.get("summary-c")![axis] > positions.get(groups[1].id)![axis]);
	}
});

function sessions(): SessionNode[] {
	return [
		{ id: "root", parentId: null, title: "Root", isRoot: true, status: "idle" },
		{ id: "child", parentId: "root", title: "Child", isRoot: false, status: "idle" },
		{ id: "sibling", parentId: "root", title: "Sibling", isRoot: false, status: "idle" },
	];
}
