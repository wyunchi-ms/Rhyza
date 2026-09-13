import assert from "node:assert/strict";
import test from "node:test";
import { floatingPosition } from "../src/utils/floatingPosition.js";

test("menus use client coordinates without adding list scroll or graph zoom offsets", () => {
	assert.deepEqual(floatingPosition({ x: 120, y: 180 }, { width: 224, height: 310 }, { width: 1280, height: 720 }), { left: 120, top: 180 });
});
test("measured menu size is clamped at every viewport edge", () => {
	assert.deepEqual(floatingPosition({ x: 1278, y: 718 }, { width: 224, height: 310 }, { width: 1280, height: 720 }), { left: 1048, top: 402 });
	assert.deepEqual(floatingPosition({ x: -10, y: -20 }, { width: 224, height: 310 }, { width: 1280, height: 720 }), { left: 8, top: 8 });
	assert.deepEqual(floatingPosition({ x: 50, y: 50 }, { width: 224, height: 310 }, { width: 200, height: 200 }), { left: 8, top: 8 });
});
