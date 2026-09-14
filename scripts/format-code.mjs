import { execFileSync } from "node:child_process";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensions = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".html",
	".htm",
	".css",
	".scss",
	".less",
	".json",
	".jsonc",
	".yaml",
	".yml",
]);
const excludedDirectories = new Set([
	".git",
	".codex",
	".agents",
	".sisyphus",
	".sisphus",
	".opencode",
	"node_modules",
	"dist",
	"dist-electron",
	"build",
	"coverage",
]);

export function isSourcePath(root, file) {
	const relative = path.relative(root, path.resolve(root, file));
	if (
		!relative ||
		relative.startsWith(`..${path.sep}`) ||
		relative === ".." ||
		path.isAbsolute(relative)
	) {
		return false;
	}
	const parts = relative.split(path.sep).map((part) => part.toLowerCase());
	return (
		!parts.some((part) => excludedDirectories.has(part)) &&
		!(parts[0] === "resources" && parts[1] === "skills") &&
		extensions.has(path.extname(file).toLowerCase()) &&
		!/(?:^|[\\/])package-lock\.json$|\.min\.(?:js|css)$|sample\.json$/i.test(file)
	);
}

export function patchFiles(command) {
	return [...command.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)\r?$/gm)].map(
		(match) => match[1].trim(),
	);
}

export function changedFiles(root) {
	const git = (args) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
	return [
		...new Set(
			[
				...git(["diff", "--name-only", "--diff-filter=ACMR", "-z"]).split("\0"),
				...git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).split("\0"),
				...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
			].filter(Boolean),
		),
	];
}

export async function formatFiles(root, files, check = false) {
	const actualRoot = await realpath(root);
	const changed = [];
	for (const candidate of new Set(files)) {
		const file = path.resolve(root, candidate);
		if (!isSourcePath(root, file)) {
			continue;
		}
		let actualFile;
		try {
			actualFile = await realpath(file);
		} catch (error) {
			if (error.code === "ENOENT") {
				continue;
			}
			throw error;
		}
		if (!isSourcePath(actualRoot, actualFile) || !(await stat(file)).isFile()) {
			continue;
		}
		const info = await prettier.getFileInfo(file, {
			ignorePath: [path.join(root, ".gitignore"), path.join(root, ".prettierignore")],
		});
		if (info.ignored || !info.inferredParser) {
			continue;
		}
		const config = await prettier.resolveConfig(file, { editorconfig: true });
		const before = await readFile(file, "utf8");
		const after = await prettier.format(before, { ...config, filepath: file });
		if (before === after) {
			continue;
		}
		if (!check) {
			if ((await readFile(file, "utf8")) !== before) {
				throw new Error(
					`File changed while formatting: ${path.relative(root, file)}. Retry formatting.`,
				);
			}
			await writeFile(file, after, "utf8");
		}
		changed.push(path.relative(root, file));
	}
	return changed;
}

async function main() {
	const args = process.argv.slice(2);
	const hook = args.includes("--hook");
	const check = args.includes("--check");
	let payload = {};
	try {
		if (hook) {
			let input = "";
			for await (const chunk of process.stdin) {
				input += chunk;
			}
			payload = JSON.parse(input);
		}
		const explicit = args.filter((arg) => !arg.startsWith("--"));
		const patch =
			hook && payload.tool_name === "apply_patch"
				? patchFiles(payload.tool_input?.command ?? "").map((file) =>
						path.resolve(payload.cwd ?? projectRoot, file),
					)
				: null;
		const files = patch ?? (explicit.length ? explicit : changedFiles(projectRoot));
		const changed = await formatFiles(projectRoot, files, check);
		if (hook) {
			console.log(
				JSON.stringify(
					changed.length
						? {
								systemMessage: `Prettier formatted ${changed.length} changed source file(s).`,
							}
						: {},
				),
			);
		} else {
			console.log(
				changed.length
					? `${check ? "Needs formatting" : "Formatted"}:\n${changed.join("\n")}`
					: "All selected source files are formatted.",
			);
		}
		if (check && changed.length) {
			process.exitCode = 1;
		}
	} catch (error) {
		if (hook) {
			const reason = `Source formatting failed: ${error.message}. Fix the issue and rerun npm run format.`;
			console.log(
				JSON.stringify(
					payload.stop_hook_active ? { systemMessage: reason } : { decision: "block", reason },
				),
			);
		} else {
			console.error(error.message);
			process.exitCode = 1;
		}
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
