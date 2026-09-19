import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { openOrCreatePiSession } from "../electron/main/pi-session-lineage.js";

test("frontend nodes map one-to-one to persistent Pi sessions with real parent paths", async () => {
	const dataRoot = await mkdtemp(path.join(os.tmpdir(), "rhyza-pi-lineage-"));
	const sessionDir = path.join(dataRoot, "sessions");
	try {
		const root = await openOrCreatePiSession({
			workspacePath: path.join(dataRoot, "root-worktree"),
			sessionDir,
			frontendSessionId: "root",
			transcript: [],
		});
		assert.equal(root.created, true);
		root.sessionManager.appendMessage({
			role: "user",
			content: "first question",
			timestamp: Date.now(),
		});
		root.sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "first answer" }],
			api: "openai-responses",
			provider: "test",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});
		const persistedAfterFirstMessage = await SessionManager.listAll(sessionDir);
		assert.deepEqual(
			persistedAfterFirstMessage.map((session) => session.id),
			["kb-root"],
		);

		const reopenedRoot = await openOrCreatePiSession({
			workspacePath: path.join(dataRoot, "root-worktree"),
			sessionDir,
			frontendSessionId: "root",
			transcript: [{ id: "must-not-replay", role: "user", content: "duplicate" }],
		});
		assert.equal(reopenedRoot.created, false);
		assert.equal(reopenedRoot.sessionFile, root.sessionFile);
		assert.equal(
			reopenedRoot.sessionManager.getEntries().filter((entry) => entry.type === "message").length,
			2,
		);

		const child = await openOrCreatePiSession({
			workspacePath: path.join(dataRoot, "child-worktree"),
			sessionDir,
			frontendSessionId: "child",
			parentFrontendSessionId: "root",
			forkedFromTurnId: "root-assistant",
			transcript: [
				{ id: "copied-user", role: "user", content: "first question" },
				{ id: "copied-assistant", role: "assistant", content: "first answer" },
			],
		});
		assert.equal(
			path.resolve(String(child.sessionManager.getHeader()?.parentSession)),
			path.resolve(root.sessionFile),
		);
		assert.equal(
			child.sessionManager.getEntries().filter((entry) => entry.type === "message").length,
			1,
		);
		assert.equal(
			child.sessionManager.getEntries().filter((entry) => entry.type === "custom_message").length,
			1,
		);
		child.sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "branch answer" }],
			api: "openai-responses",
			provider: "test",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});

		const nested = await openOrCreatePiSession({
			workspacePath: path.join(dataRoot, "nested-worktree"),
			sessionDir,
			frontendSessionId: "nested",
			parentFrontendSessionId: "child",
			forkedFromTurnId: "child-local-assistant",
			transcript: [{ id: "nested-copy", role: "user", content: "first question" }],
		});
		nested.sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "nested answer" }],
			api: "openai-responses",
			provider: "test",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});
		assert.equal(
			path.resolve(String(nested.sessionManager.getHeader()?.parentSession)),
			path.resolve(child.sessionFile),
		);
		assert.equal((await SessionManager.listAll(sessionDir)).length, 3);
	} finally {
		await rm(dataRoot, { recursive: true, force: true });
	}
});

test("a branch recovers when its Pi parent is missing", async () => {
	const dataRoot = await mkdtemp(path.join(os.tmpdir(), "rhyza-pi-missing-parent-"));
	try {
		const child = await openOrCreatePiSession({
			workspacePath: path.join(dataRoot, "child-worktree"),
			sessionDir: path.join(dataRoot, "sessions"),
			frontendSessionId: "child",
			parentFrontendSessionId: "missing",
			forkedFromTurnId: "missing-turn",
			transcript: [{ id: "copied-user", role: "user", content: "recovered context" }],
		});
		assert.equal(child.created, true);
		assert.equal(child.sessionManager.getHeader()?.parentSession, undefined);
		assert.equal(
			child.sessionManager.getEntries().filter((entry) => entry.type === "message").length,
			1,
		);
		const branchEntry = child.sessionManager
			.getEntries()
			.find((entry) => entry.type === "custom" && entry.customType === "rhyza.branch");
		assert.equal(branchEntry?.type, "custom");
		if (branchEntry?.type === "custom") {
			assert.equal(
				(branchEntry.data as { parentResolution?: string }).parentResolution,
				"missing-parent-recovered",
			);
		}
	} finally {
		await rm(dataRoot, { recursive: true, force: true });
	}
});

test("concurrent resolution cannot create two Pi sessions for one frontend node", async () => {
	const dataRoot = await mkdtemp(path.join(os.tmpdir(), "rhyza-pi-concurrent-"));
	const sessionDir = path.join(dataRoot, "sessions");
	try {
		const options = {
			workspacePath: path.join(dataRoot, "worktree"),
			sessionDir,
			frontendSessionId: "same-node",
			transcript: [],
		};
		const [left, right] = await Promise.all([
			openOrCreatePiSession(options),
			openOrCreatePiSession(options),
		]);
		assert.equal(left.sessionFile, right.sessionFile);
		left.sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "done" }],
			api: "openai-responses",
			provider: "test",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});
		assert.equal((await SessionManager.listAll(sessionDir)).length, 1);
	} finally {
		await rm(dataRoot, { recursive: true, force: true });
	}
});
