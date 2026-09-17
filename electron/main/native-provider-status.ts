import type { ProviderStatusResponse } from "../../src/shared/ipc.js";
import { errorToMessage, isRecord } from "../../src/shared/value.js";
import { bundledCodexCommand, localClaudeCommand, runCliStatus } from "./cli-process.js";
import type { NativeProviderId } from "./native-agent.js";

export const nativeSetupInstructions: Record<NativeProviderId, string> = {
	codex:
		"Codex uses the official SDK and your local Codex login. Install the login CLI with `npm install -g @openai/codex`, run `codex login`, then Check connection. CODEX_HOME is respected; CODEX_API_KEY is also supported. Authentication is managed outside Rhyza.",
	"claude-code":
		"Install Claude Code from https://code.claude.com/docs/en/setup, run `claude auth login`, then restart Rhyza and Check connection. On Windows, install Git for Windows (Git Bash). For a custom install set RHYZA_CLAUDE_PATH to the absolute executable path. Authentication is managed by your local Claude Code CLI.",
};

export async function getNativeProviderStatus(
	providerId: NativeProviderId,
): Promise<ProviderStatusResponse> {
	const base = {
		providerId,
		externalAuth: true,
		setupInstructions: nativeSetupInstructions[providerId],
	};
	try {
		if (providerId === "codex") {
			if (process.env.CODEX_API_KEY?.trim()) {
				return { ...base, configured: true, source: "CODEX_API_KEY" };
			}
			await runCliStatus(bundledCodexCommand(), ["login", "status"]);
			return { ...base, configured: true, source: "local Codex login" };
		}
		const status: unknown = JSON.parse(
			await runCliStatus(await localClaudeCommand(), ["auth", "status", "--json"]),
		);
		if (!isRecord(status) || typeof status.loggedIn !== "boolean") {
			throw new Error(
				"Claude Code returned an unsupported authentication status. Update Claude Code.",
			);
		}
		return {
			...base,
			configured: status.loggedIn,
			source: status.loggedIn ? "local Claude Code login" : undefined,
			error: status.loggedIn ? undefined : "Claude Code is not signed in. Run `claude auth login`.",
		};
	} catch (error) {
		return { ...base, configured: false, error: errorToMessage(error) };
	}
}
