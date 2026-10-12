import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { SourceIndexingOptions } from "../../src/shared/ipc.js";

const ignoredDirectories = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"dist",
	"dist-electron",
	"build",
	"bin",
	"obj",
	"target",
	".next",
	".nuxt",
	".output",
	".cache",
	".turbo",
	".gradle",
	".venv",
	"venv",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache",
	".tox",
	".nox",
	"coverage",
	".nyc_output",
	".rhyza-debug",
	".pi-graph",
]);

export class SourceFilePolicy {
	private readonly rules = new Map<string, Promise<Ignore>>();
	private readonly extraRules: Ignore;

	constructor(
		private readonly root: string,
		options?: SourceIndexingOptions,
	) {
		this.extraRules = ignore({ ignorecase: process.platform === "win32" });
		if (options) {
			this.extraRules.add([
				...options.excludedDirectories.map(
					(directory) => `/${directory.replace(/[\\!*?[\]# ]/g, "\\$&")}/`,
				),
				...options.excludePatterns,
			]);
		}
	}

	async allows(relativePath: string, directory = false): Promise<boolean> {
		const segments = relativePath.split(/[\\/]/);
		if (
			path.isAbsolute(relativePath) ||
			segments.some((segment) => !segment || segment === "." || segment === "..")
		) {
			throw new Error("Source paths must be relative and cannot leave the source directory.");
		}
		const directorySegments = directory ? segments : segments.slice(0, -1);
		if (
			directorySegments.some((segment) =>
				ignoredDirectories.has(process.platform === "win32" ? segment.toLowerCase() : segment),
			)
		)
			return false;

		const customRules = await this.getRules("", ".rhyzaignore");
		const scopes: Ignore[] = [];
		for (let depth = 0; depth < segments.length; depth++) {
			const parentDirectory = segments.slice(0, depth).join(path.sep);
			scopes.push(await this.getRules(parentDirectory, ".gitignore"));
			const suffix = depth < segments.length - 1 || directory ? "/" : "";
			let ignored = false;
			for (let scopeDepth = 0; scopeDepth < scopes.length; scopeDepth++) {
				const candidate = segments.slice(scopeDepth, depth + 1).join("/") + suffix;
				const result = scopes[scopeDepth].test(candidate);
				if (result.ignored) ignored = true;
				else if (result.unignored) ignored = false;
			}
			// Rhyza-specific rules take precedence over Git rules, but never over built-in exclusions.
			const custom = customRules.test(segments.slice(0, depth + 1).join("/") + suffix);
			if (custom.ignored) ignored = true;
			else if (custom.unignored) ignored = false;
			const candidatePath = segments.slice(0, depth + 1).join("/") + suffix;
			if (ignored || this.extraRules.ignores(candidatePath)) return false;
		}
		return true;
	}

	private getRules(directory: string, name: ".gitignore" | ".rhyzaignore"): Promise<Ignore> {
		const key = path.join(directory, name);
		let rules = this.rules.get(key);
		if (!rules) {
			rules = this.readRules(path.join(this.root, key));
			this.rules.set(key, rules);
		}
		return rules;
	}

	private async readRules(filePath: string): Promise<Ignore> {
		const rules = ignore({ ignorecase: process.platform === "win32" });
		try {
			const details = await lstat(filePath);
			if (!details.isFile() || details.isSymbolicLink()) {
				throw new Error(`Source ignore rules must be a regular file: ${filePath}`);
			}
			if (details.size > 2_000_000) {
				throw new Error(`Source ignore rules exceed the 2 MB limit: ${filePath}`);
			}
			return rules.add(await readFile(filePath, "utf8"));
		} catch (error) {
			if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
				return rules;
			throw error;
		}
	}
}
