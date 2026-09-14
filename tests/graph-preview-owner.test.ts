import assert from "node:assert/strict";
import test from "node:test";
import { createGraphPreviewOwner } from "../src/utils/graphPreviewOwner.js";

test("switching nodes closes the old preview synchronously without releasing the new one", () => {
	const owner = createGraphPreviewOwner();
	const visible = new Set<string>();
	const open = (id: string) => {
		owner.claim(id, () => {
			visible.delete(id);
			owner.release(id);
		});
		visible.add(id);
	};
	open("a");
	open("b");
	open("c");
	assert.deepEqual([...visible], ["c"]);
	owner.release("a");
	assert.equal(owner.owns("c"), true);
	owner.close();
	assert.equal(visible.size, 0);
	assert.equal(owner.owns("c"), false);
});

test("switching nodes cancels delayed opens before they can show a stale preview", (context) => {
	context.mock.timers.enable({ apis: ["setTimeout"] });
	const owner = createGraphPreviewOwner();
	const opened: string[] = [];
	const schedule = (id: string) => {
		const timer = setTimeout(() => {
			if (owner.owns(id)) opened.push(id);
		}, 220);
		owner.claim(id, () => {
			clearTimeout(timer);
			owner.release(id);
		});
	};
	schedule("a");
	context.mock.timers.tick(100);
	schedule("b");
	context.mock.timers.tick(100);
	schedule("c");
	context.mock.timers.tick(220);
	assert.deepEqual(opened, ["c"]);
	schedule("d");
	owner.close();
	context.mock.timers.tick(220);
	assert.deepEqual(opened, ["c"]);
});

test("reentering the same node retains its preview", () => {
	const owner = createGraphPreviewOwner();
	let closed = 0;
	const close = () => {
		closed++;
		owner.release("a");
	};
	owner.claim("a", close);
	owner.claim("a", close);
	assert.equal(closed, 0);
	assert.equal(owner.owns("a"), true);
	owner.close();
	assert.equal(closed, 1);
});
