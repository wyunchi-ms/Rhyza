import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	parseTodoChecklist,
	readWorkspaceTodos,
	updateWorkspaceTodo,
} from "../electron/main/todo-service";
import {
	validateWorkspaceTodoUpdateRequest,
	type WorkspaceTodoUpdateRequest,
} from "../src/shared/ipc";

test("TODO checklist parser preserves hierarchy, state, and source lines", () => {
	const nodes = parseTodoChecklist(
		[
			"# Delivery",
			"- [ ] Build inspector",
			"  - [x] Add IPC",
			"  - [ ] Add panel",
			"1. [X] Run tests",
			"This is not a checklist item.",
		].join("\n"),
		"TODO.md",
	);

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

function updateRequest(
	workspacePath: string,
	overrides: Partial<WorkspaceTodoUpdateRequest> = {},
): WorkspaceTodoUpdateRequest {
	return {
		workspacePath,
		path: "TODO.md",
		line: 2,
		text: "Build inspector",
		expectedCompleted: false,
		completed: true,
		...overrides,
	};
}

test("TODO updates persist only the checkbox byte, preserve UTF-8, BOM, CRLF and hierarchy", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-todo-save-"));
	const original = "\uFEFF# 清单\r\n- [ ] Build inspector  \r\n\t1. [X] 已完成\r\n- [ ] Other";
	try {
		await writeFile(path.join(directory, "TODO.md"), original);
		const result = await updateWorkspaceTodo(directory, updateRequest(directory));
		assert.equal(
			await readFile(path.join(directory, "TODO.md"), "utf8"),
			original.replace("- [ ] Build", "- [x] Build"),
		);
		assert.equal(result.completed, 2);
		assert.equal(result.total, 3);
		assert.equal(result.files[0].nodes[0].children[0].completed, true);
		await updateWorkspaceTodo(
			directory,
			updateRequest(directory, { expectedCompleted: true, completed: false }),
		);
		assert.equal(await readFile(path.join(directory, "TODO.md"), "utf8"), original);
		assert.equal((await readWorkspaceTodos(directory)).completed, 1);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("TODO updates reject stale lines, text, state and workspace without changing the file", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-todo-conflict-"));
	const original = "# Delivery\n- [ ] Build inspector\n";
	try {
		await writeFile(path.join(directory, "TODO.md"), original);
		for (const overrides of [
			{ line: 1 },
			{ line: 99 },
			{ text: "A different task" },
			{ expectedCompleted: true },
			{ workspacePath: path.join(directory, "other") },
		]) {
			await assert.rejects(
				updateWorkspaceTodo(directory, updateRequest(directory, overrides)),
				/changed|no longer/,
			);
			assert.equal(await readFile(path.join(directory, "TODO.md"), "utf8"), original);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("TODO updates serialize concurrent saves without losing sibling edits", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-todo-concurrent-"));
	try {
		await writeFile(
			path.join(directory, "TODO.md"),
			"# Delivery\n- [ ] Build inspector\n- [ ] Add panel\n",
		);
		await Promise.all([
			updateWorkspaceTodo(directory, updateRequest(directory)),
			updateWorkspaceTodo(directory, updateRequest(directory, { line: 3, text: "Add panel" })),
		]);
		assert.equal((await readWorkspaceTodos(directory)).completed, 2);
		await assert.rejects(updateWorkspaceTodo(directory, updateRequest(directory)), /changed/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("TODO updates reject traversal, absolute paths, non-checklist files and external junctions", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "rhyza-todo-paths-"));
	const workspace = path.join(directory, "workspace");
	const outside = path.join(directory, "outside");
	try {
		await Promise.all([mkdir(workspace), mkdir(outside)]);
		await writeFile(path.join(outside, "TODO.md"), "# Delivery\n- [ ] Build inspector\n");
		for (const filePath of [
			"../outside/TODO.md",
			"..\\outside\\TODO.md",
			path.join(outside, "TODO.md"),
			"C:\\TODO.md",
			"notes.md",
			"node_modules/TODO.md",
			"TODO.md:stream",
		]) {
			await assert.rejects(
				updateWorkspaceTodo(workspace, updateRequest(workspace, { path: filePath })),
				/Invalid/,
			);
		}
		await symlink(
			outside,
			path.join(workspace, "linked"),
			process.platform === "win32" ? "junction" : "dir",
		);
		await assert.rejects(
			updateWorkspaceTodo(workspace, updateRequest(workspace, { path: "linked/TODO.md" })),
			/inside/,
		);
		assert.equal(
			await readFile(path.join(outside, "TODO.md"), "utf8"),
			"# Delivery\n- [ ] Build inspector\n",
		);
		await assert.rejects(updateWorkspaceTodo(workspace, updateRequest(workspace)), /ENOENT/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("TODO update validation rejects malformed write requests", () => {
	const valid = updateRequest("workspace");
	assert.deepEqual(validateWorkspaceTodoUpdateRequest(valid), valid);
	for (const value of [
		null,
		{},
		{ ...valid, completed: "true" },
		{ ...valid, line: 0 },
		{ ...valid, line: 1.5 },
		{ ...valid, text: "" },
		{ ...valid, frontendSessionId: 1 },
	]) {
		assert.throws(() => validateWorkspaceTodoUpdateRequest(value), /Invalid/);
	}
});
