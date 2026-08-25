import assert from "node:assert/strict";
import test from "node:test";
import type { Turn } from "../src/types/index.js";
import { buildTurnSessionMap, sessionAtViewportAnchor } from "../src/utils/sessionVisibility.js";

test("copied turns highlight their source session while local turns highlight the active branch", () => {
	const turns: Turn[] = [
		makeTurn("root-turn", "root"),
		{ ...makeTurn("copied-root-turn", "child"), sourceTurnId: "root-turn" },
		makeTurn("child-turn", "child"),
	];
	const mapping = buildTurnSessionMap(turns);
	assert.equal(mapping.get("copied-root-turn"), "root");
	assert.equal(mapping.get("child-turn"), "child");
});

test("the viewport anchor chooses the currently displayed session without moving the viewport", () => {
	const sessionId = sessionAtViewportAnchor([
		{ sessionId: "root", top: -100, bottom: 120 },
		{ sessionId: "child", top: 120, bottom: 500 },
	], 0, 400);
	assert.equal(sessionId, "child");
});

function makeTurn(id: string, sessionId: string): Turn {
	return { id, sessionId, role: "assistant", content: id, status: "complete", createdAt: "2026-08-25T00:00:00.000Z" };
}
