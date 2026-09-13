import assert from "node:assert/strict";
import test from "node:test";
import { inHoverRegion } from "../src/utils/hoverRegion.js";

const source = { left: 100, right: 380, top: 100, bottom: 196 };
test("a popup below keeps the content area, lower metrics crossing and gap connected", () => {
	const popup = { left: 100, right: 480, top: 246, bottom: 600 };
	for (const y of [120, 195, 205, 235, 245, 300, 599]) assert.equal(inHoverRegion({ x: 220, y }, source, popup), true);
	assert.equal(inHoverRegion({ x: 500, y: 230 }, source, popup), false);
	assert.equal(inHoverRegion({ x: 220, y: 620 }, source, popup), false);
});
test("side, above and overlapping popups retain their connecting corridor", () => {
	assert.equal(inHoverRegion({ x: 385, y: 150 }, source, { left: 390, right: 700, top: 100, bottom: 500 }), true);
	assert.equal(inHoverRegion({ x: 220, y: 95 }, source, { left: 100, right: 480, top: 0, bottom: 90 }), true);
	assert.equal(inHoverRegion({ x: 220, y: 210 }, source, { left: 100, right: 480, top: 180, bottom: 500 }), true);
	assert.equal(inHoverRegion({ x: 50, y: 150 }, source, { left: 390, right: 700, top: 100, bottom: 500 }), false);
});
