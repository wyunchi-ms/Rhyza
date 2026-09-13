import assert from "node:assert/strict";
import test from "node:test";
import { graphPreviewPosition } from "../src/utils/graphPreviewPosition.js";

test("preview flips left when a node is near the graph's right edge", () => {
	const anchor = { left: 650, right: 850, top: 100, bottom: 240 };
	const position = graphPreviewPosition(anchor, {left: 0, right: 900, top: 0, bottom: 700}, {width: 1500, height: 900});
	assert.ok(position.left + position.width <= anchor.left);
});

test("a clipped node cannot push the preview into the conversation pane", () => {
	const graph = {left: 0, right: 324, top: 40, bottom: 800};
	const position = graphPreviewPosition({left: 65, right: 470, top: 90, bottom: 295}, graph, {width: 1080, height: 900});
	assert.ok(position.left >= graph.left + 12);
	assert.ok(position.left + position.width <= graph.right - 12);
	assert.ok(position.top >= 295);
	assert.ok(position.top + position.maxHeight <= graph.bottom - 12);
});

test("preview uses space above a low node and scrolls within a small graph", () => {
	const position = graphPreviewPosition({left: 40, right: 300, top: 510, bottom: 680}, {left: 0, right: 360, top: 0, bottom: 700}, {width: 1080, height: 900});
	assert.ok(position.top + position.maxHeight <= 510);
	const small = graphPreviewPosition({left: 0, right: 400, top: 0, bottom: 400}, {left: 0, right: 280, top: 0, bottom: 220}, {width: 1080, height: 900});
	assert.equal(small.width, 256);
	assert.equal(small.maxHeight, 196);
	assert.equal(small.left, 12);
	assert.equal(small.top, 12);
});
