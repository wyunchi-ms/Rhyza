import { open, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
	validateWorkspaceTodoUpdateRequest,
	type WorkspaceTodoUpdateRequest,
	type WorkspaceTodoFile,
	type WorkspaceTodoNode,
	type WorkspaceTodosResponse,
} from "../../src/shared/ipc.js";

const ignoredDirectories = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"bin",
	"obj",
	".next",
	".cache",
	"coverage",
]);
const todoFilename = /^(?:todo|tasks?|roadmap|checklist)(?:[._-].*)?\.(?:md|markdown|txt)$/i;
const maxDepth = 6;
const maxFiles = 50;
const maxFileBytes = 2_000_000;
const pendingWrites = new Map<string, Promise<WorkspaceTodosResponse>>();

export async function updateWorkspaceTodo(
	workspacePath: string,
	input: WorkspaceTodoUpdateRequest,
): Promise<WorkspaceTodosResponse> {
	const request = validateWorkspaceTodoUpdateRequest(input);
	if (path.resolve(request.workspacePath) !== path.resolve(workspacePath)) {
		throw new Error("The active TODO workspace changed. Refresh the checklist and try again.");
	}
	const segments = request.path.split(/[\\/]/);
	if (
		path.isAbsolute(request.path) ||
		path.win32.isAbsolute(request.path) ||
		segments.some(
			(segment) => !segment || segment === "." || segment === ".." || segment.includes(":"),
		) ||
		segments.length > maxDepth + 1 ||
		segments.slice(0, -1).some((segment) => ignoredDirectories.has(segment.toLowerCase())) ||
		!todoFilename.test(segments[segments.length - 1])
	) {
		throw new Error("Invalid workspace TODO file path.");
	}
	const root = await realpath(workspacePath);
	const filePath = await realpath(path.join(root, ...segments));
	const relativePath = path.relative(root, filePath);
	if (
		relativePath === ".." ||
		relativePath.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativePath)
	) {
		throw new Error("The TODO file must stay inside the current workspace.");
	}
	const previous = pendingWrites.get(filePath);
	const operation = (async () => {
		if (previous) {
			try {
				await previous;
			} catch {
				// A failed earlier save must not block later user edits.
			}
		}
		const file = await open(filePath, "r+");
		try {
			const info = await file.stat();
			if (!info.isFile() || info.size > maxFileBytes) {
				throw new Error("The TODO file must be a regular file no larger than 2 MB.");
			}
			const bytes = await file.readFile();
			const content = bytes.toString("utf8");
			if (bytes.length > maxFileBytes || !Buffer.from(content, "utf8").equals(bytes)) {
				throw new Error("The TODO file must contain UTF-8 text no larger than 2 MB.");
			}
			const lines = content.split("\n");
			const line = lines[request.line - 1];
			const node = line === undefined ? undefined : parseTodoChecklist(line)[0];
			if (!node || node.text !== request.text || node.completed !== request.expectedCompleted) {
				throw new Error("This TODO changed on disk. Refresh the checklist and try again.");
			}
			const marker = /^(\s*(?:[-*+]|\d+[.)])\s+\[)[ xX]\]/.exec(line);
			if (!marker) throw new Error("The selected line is no longer a TODO checkbox.");
			const prefix =
				lines
					.slice(0, request.line - 1)
					.map((entry) => `${entry}\n`)
					.join("") + marker[1];
			const result = await file.write(
				Buffer.from(request.completed ? "x" : " "),
				0,
				1,
				Buffer.byteLength(prefix, "utf8"),
			);
			if (result.bytesWritten !== 1) throw new Error("Could not save the TODO checkbox.");
			await file.sync();
		} finally {
			await file.close();
		}
		return readWorkspaceTodos(workspacePath);
	})();
	pendingWrites.set(filePath, operation);
	try {
		return await operation;
	} finally {
		if (pendingWrites.get(filePath) === operation) pendingWrites.delete(filePath);
	}
}

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
			files.push({
				path: relativePath,
				completed: items.filter((item) => item.completed).length,
				total: items.length,
				nodes,
			});
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
			if (!ignoredDirectories.has(entry.name.toLocaleLowerCase()))
				await collectTodoFiles(entryPath, depth + 1, output);
		} else if (entry.isFile() && todoFilename.test(entry.name)) {
			output.push(entryPath);
		}
	}
}
