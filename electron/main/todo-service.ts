import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceTodoFile, WorkspaceTodoNode, WorkspaceTodosResponse } from "../../src/shared/ipc.js";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "bin", "obj", ".next", ".cache", "coverage"]);
const todoFilename = /^(?:todo|tasks?|roadmap|checklist)(?:[._-].*)?\.(?:md|markdown|txt)$/i;
const maxDepth = 6;
const maxFiles = 50;
const maxFileBytes = 2_000_000;

export async function readWorkspaceTodos(workspacePath: string): Promise<WorkspaceTodosResponse> {
	const paths: string[] = [];
	await collectTodoFiles(workspacePath, 0, paths);
	const files: WorkspaceTodoFile[] = [];
	for (const filePath of paths.sort((left, right) => left.localeCompare(right))) {
		try {
			if ((await stat(filePath)).size > maxFileBytes) continue;
			const relativePath = path.relative(workspacePath, filePath).replace(/\\/g, "/");
			const nodes = parseTodoChecklist(await readFile(filePath, "utf8"), relativePath);
			if (!nodes.length) continue;
			const items = flattenTodoNodes(nodes);
			files.push({ path: relativePath, completed: items.filter((item) => item.completed).length, total: items.length, nodes });
		} catch {
			// A checklist may be rewritten between directory enumeration and reading.
		}
	}
	return {
		workspacePath,
		completed: files.reduce((sum, file) => sum + file.completed, 0),
		total: files.reduce((sum, file) => sum + file.total, 0),
		files,
	};
}

export function parseTodoChecklist(content: string, relativePath = "TODO.md"): WorkspaceTodoNode[] {
	const roots: WorkspaceTodoNode[] = [];
	const stack: Array<{ indent: number; node: WorkspaceTodoNode }> = [];
	for (const [index, line] of content.split(/\r?\n/).entries()) {
		const match = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line);
		if (!match) continue;
		const indent = match[1].replace(/\t/g, "    ").length;
		const node: WorkspaceTodoNode = {
			id: `${relativePath}:${index + 1}`,
			text: match[3],
			completed: match[2].toLocaleLowerCase() === "x",
			line: index + 1,
			children: [],
		};
		while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
		const parent = stack[stack.length - 1]?.node;
		(parent ? parent.children : roots).push(node);
		stack.push({ indent, node });
	}
	return roots;
}

function flattenTodoNodes(nodes: WorkspaceTodoNode[]): WorkspaceTodoNode[] {
	return nodes.flatMap((node) => [node, ...flattenTodoNodes(node.children)]);
}

async function collectTodoFiles(directory: string, depth: number, output: string[]): Promise<void> {
	if (depth > maxDepth || output.length >= maxFiles) return;
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (output.length >= maxFiles) return;
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!ignoredDirectories.has(entry.name.toLocaleLowerCase())) await collectTodoFiles(entryPath, depth + 1, output);
		} else if (entry.isFile() && todoFilename.test(entry.name)) {
			output.push(entryPath);
		}
	}
}
