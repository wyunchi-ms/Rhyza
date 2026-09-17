import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { errorToMessage } from "../../src/shared/value.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export interface CliCommand {
	file: string;
	args: string[];
	env: NodeJS.ProcessEnv;
}

export function bundledCodexCommand(): CliCommand {
	return {
		file: process.execPath,
		args: [require.resolve("@openai/codex/bin/codex.js")],
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
	};
}

export async function localClaudeCommand(): Promise<CliCommand> {
	const override = process.env.RHYZA_CLAUDE_PATH;
	if (override && !path.isAbsolute(override)) {
		throw new Error("RHYZA_CLAUDE_PATH must be an absolute path to Claude Code.");
	}
	const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
	const candidates = override
		? [override]
		: [
				...extensions.map((extension) =>
					path.join(homedir(), ".local", "bin", `claude${extension}`),
				),
				...(process.env.PATH ?? process.env.Path ?? "")
					.split(path.delimiter)
					.filter(Boolean)
					.flatMap((directory) =>
						extensions.map((extension) =>
							path.join(directory.replace(/^"|"$/g, ""), `claude${extension}`),
						),
					),
			];
	for (const candidate of candidates) {
		try {
			await access(candidate);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		if (/\.(?:cmd|bat)$/i.test(candidate)) {
			const script = path.join(
				path.dirname(candidate),
				"node_modules",
				"@anthropic-ai",
				"claude-code",
				"cli.js",
			);
			await access(script);
			return {
				file: process.execPath,
				args: [script],
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			};
		}
		if (/\.[cm]?js$/i.test(candidate)) {
			return {
				file: process.execPath,
				args: [candidate],
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			};
		}
		return { file: candidate, args: [], env: { ...process.env } };
	}
	throw new Error(
		override
			? `Claude Code was not found at RHYZA_CLAUDE_PATH: ${override}`
			: "Claude Code is not installed or is not on PATH. Install it, run `claude auth login`, then restart Rhyza.",
	);
}

export async function runCliStatus(command: CliCommand, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync(command.file, [...command.args, ...args], {
		env: command.env,
		windowsHide: true,
		timeout: 10_000,
		maxBuffer: 64_000,
	});
	return stdout;
}

export async function* streamCliJson(
	command: CliCommand,
	args: string[],
	input: string,
	cwd: string,
	signal: AbortSignal,
): AsyncGenerator<unknown> {
	signal.throwIfAborted();
	const child = spawn(command.file, [...command.args, ...args], {
		cwd,
		env: command.env,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	let closed = false;
	let stopping = false;
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		stderr = `${stderr}${chunk}`.slice(-4_000);
	});
	const exited = new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => {
			closed = true;
			if (signal.aborted) reject(signal.reason);
			else if (code !== 0) {
				reject(
					new Error(`Claude Code exited with code ${code}: ${stderr || "no diagnostic output"}`),
				);
			} else resolve();
		});
	});
	// The process can fail before the stdout iterator finishes.
	void exited.catch(() => {});
	const stop = () => {
		if (closed || stopping || child.exitCode !== null || !child.pid) return;
		stopping = true;
		if (process.platform === "win32") {
			void execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
				windowsHide: true,
			}).catch((error: unknown) => {
				if (child.exitCode === null)
					console.warn(`Could not stop Claude Code: ${errorToMessage(error)}`);
			});
		} else child.kill("SIGTERM");
	};
	signal.addEventListener("abort", stop, { once: true });
	child.stdin.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code !== "EPIPE") console.warn(`Claude Code input failed: ${errorToMessage(error)}`);
	});
	const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
	try {
		child.stdin.end(input);
		if (signal.aborted) stop();
		for await (const line of lines) {
			if (!line.trim()) continue;
			try {
				yield JSON.parse(line) as unknown;
			} catch (error) {
				if (error instanceof SyntaxError)
					throw new Error("Claude Code returned invalid stream JSON.");
				throw error;
			}
		}
		await exited;
	} finally {
		lines.close();
		signal.removeEventListener("abort", stop);
		stop();
		await exited.catch(() => {});
	}
}
