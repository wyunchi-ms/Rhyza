import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { restoreLegacyTurnQuotes } from "../electron/main/legacy-turn-quotes.js";
import { AppStateStore } from "../electron/main/app-state-store.js";
import type { Turn } from "../src/types/index.js";

const turn = (id: string, role: Turn["role"], content: string, sessionId = "branch"): Turn => ({
	id, role, content, sessionId, status: "complete", createdAt: "2026-08-19T14:04:21.931Z",
});
const history = () => [turn("answer", "assistant", "Repeated wakes use **coalescing**.\nA `Promise` is an asynchronous result."), turn("question", "user", "what's this")];
const request = (passage: string, question = "what's this") => JSON.stringify({ type: "message", message: {
	role: "user", content: [{ type: "text", text: `<knowledge_context>unrelated context</knowledge_context>\n\n<user_question>\nAnswer the user's question using the selected passage as the primary focus. Prefer linking or updating existing knowledge-base entities instead of creating duplicates.\n\nSelected passage:\n${passage}\n\nUser question:\n${question}\n</user_question>` }],
} });

test("workspace load restores exact legacy selections and retains them after saving", async (t) => {
	const directory = mkdtempSync(path.join(tmpdir(), "rhyza-quotes-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(path.join(directory, "2026-08-19_kb-branch.jsonl"), `${request("coalescing")}\n{partial`);
	writeFileSync(path.join(directory, "2026-08-19_kb-other.jsonl"), request("Promise"));
	const turns = [...history(), ...history().map((item) => ({ ...item, id: `other-${item.id}`, sessionId: "other" }))];
	const raw = JSON.stringify({ version: 0, state: { sessions: [], turns, entities: [{ id: "retained" }] } });
	const store = new AppStateStore(directory, directory);
	const workspace = path.join(directory, "workspace");
	await store.save(workspace, raw);
	const loaded = store.load(workspace)!;
	const restored = JSON.parse(loaded);
	assert.deepEqual(restored.state.turns[1].quote, { turnId: "answer", text: "coalescing" });
	assert.deepEqual(restored.state.turns[3].quote, { turnId: "other-answer", text: "Promise" });
	assert.equal(restored.state.turns[1].content, "what's this");
	assert.deepEqual(restored.state.entities, [{ id: "retained" }]);
	assert.equal(restored.version, 0);
	await store.save(workspace, loaded);
	assert.deepEqual(JSON.parse(store.load(workspace)!), restored);
});

test("recovery preserves saved quotes, restores copied turns, and skips ambiguous questions", (t) => {
	const directory = mkdtempSync(path.join(tmpdir(), "rhyza-quotes-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(path.join(directory, "2026-08-19_kb-branch.jsonl"), request("coalescing"));
	const existing = { ...turn("existing", "user", "other question"), quote: { turnId: "answer", text: "original quotation" } };
	const copy = { ...turn("copy", "user", "what's this", "copied"), sourceTurnId: "question" };
	const restored = JSON.parse(restoreLegacyTurnQuotes(JSON.stringify({ state: { turns: [...history(), existing, copy] } }), directory));
	assert.deepEqual(restored.state.turns[2], existing);
	assert.deepEqual(restored.state.turns[3].quote, { turnId: "answer", text: "coalescing" });
	const ambiguous = JSON.stringify({ state: { turns: [...history(), turn("repeat", "user", "what's this")] } });
	assert.equal(restoreLegacyTurnQuotes(ambiguous, directory), ambiguous);
});

test("recovery ignores missing logs, unmatched sources, and ordinary messages", (t) => {
	const directory = mkdtempSync(path.join(tmpdir(), "rhyza-quotes-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const raw = JSON.stringify({ state: { turns: history() } });
	assert.equal(restoreLegacyTurnQuotes(raw, path.join(directory, "missing")), raw);
	writeFileSync(path.join(directory, "2026-08-19_kb-branch.jsonl"), request("never appeared in the source"));
	assert.equal(restoreLegacyTurnQuotes(raw, directory), raw);
	writeFileSync(path.join(directory, "2026-08-19_kb-branch.jsonl"), JSON.stringify({ type: "message", message: { role: "user", content: "what's this" } }));
	assert.equal(restoreLegacyTurnQuotes(raw, directory), raw);
	assert.equal(restoreLegacyTurnQuotes("broken", directory), "broken");
});
