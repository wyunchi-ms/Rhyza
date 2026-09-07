import assert from "node:assert/strict";
import test from "node:test";
import { parseTodoChecklist } from "../electron/main/todo-service";

test("TODO checklist parser preserves hierarchy, state, and source lines", () => {
	const nodes = parseTodoChecklist([
		"# Delivery",
		"- [ ] Build inspector",
		"  - [x] Add IPC",
		"  - [ ] Add panel",
		"1. [X] Run tests",
		"This is not a checklist item.",
	].join("\n"), "TODO.md");

	assert.equal(nodes.length, 2);
	assert.deepEqual(nodes[0], {
		id: "TODO.md:2",
		text: "Build inspector",
		completed: false,
		line: 2,
		children: [
			{ id: "TODO.md:3", text: "Add IPC", completed: true, line: 3, children: [] },
			{ id: "TODO.md:4", text: "Add panel", completed: false, line: 4, children: [] },
		],
	});
	assert.equal(nodes[1].text, "Run tests");
	assert.equal(nodes[1].completed, true);
	assert.equal(nodes[1].line, 5);
});

test("TODO checklist parser handles tabs and sibling indentation", () => {
	const nodes = parseTodoChecklist("- [ ] Parent\n\t- [ ] Child\n- [x] Sibling", "tasks.md");
	assert.equal(nodes.length, 2);
	assert.equal(nodes[0].children[0].text, "Child");
	assert.equal(nodes[1].id, "tasks.md:3");
});
