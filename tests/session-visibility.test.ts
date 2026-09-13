import assert from "node:assert/strict";
import test from "node:test";
import type { Turn } from "../src/types/index.js";
import { buildTurnSessionMap, sessionAtViewportAnchor, turnAtViewportAnchor, turnAtViewportRegion } from "../src/utils/sessionVisibility.js";

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

test("focus crosses user and assistant bubbles in both scroll directions at the middle", () => {
	const boxes = [
		{ id: "user", top: 80, bottom: 180 },
		{ id: "assistant", top: 210, bottom: 800 },
	];
	assert.equal(turnAtViewportAnchor(boxes, 0, 300)?.id, "user");
	assert.equal(turnAtViewportAnchor(boxes, 0, 500)?.id, "assistant");
	assert.equal(turnAtViewportAnchor(boxes, 0, 300)?.id, "user");
});

test("gaps use bubble edges, not centers biased against long replies", () => {
	assert.equal(turnAtViewportAnchor([
		{ id: "long", top: -1000, bottom: 190 },
		{ id: "short", top: 230, bottom: 260 },
	], 0, 400)?.id, "long");
});

test("exact boundaries select the next bubble and offscreen bubbles never win", () => {
	const boxes = [{ id: "user", top: 0, bottom: 200 }, { id: "agent", top: 200, bottom: 500 }];
	assert.equal(turnAtViewportAnchor(boxes, 0, 400)?.id, "agent");
	assert.equal(turnAtViewportAnchor(boxes, 500, 800), null);
	assert.equal(turnAtViewportAnchor(boxes, 200, 200), null);
	assert.equal(turnAtViewportAnchor([], 0, 400), null);
});

test("nested and legacy shared turns map to their original list node", () => {
	const root = { id: "root", parentId: null, title: "Root", isRoot: true, status: "idle" as const };
	const child = { ...root, id: "child", parentId: "root", isRoot: false, forkedFromTurnId: "a1" };
	const nested = { ...child, id: "nested", parentId: "child", forkedFromTurnId: "copy" };
	const original = makeTurn("a1", "root");
	const turns = [original, { ...original, id: "copy", sessionId: "child" },
		{ ...original, id: "nested-copy", sessionId: "nested", sourceTurnId: "copy" }, makeTurn("local", "nested")];
	const mapping = buildTurnSessionMap(turns, [nested, child, root]);
	assert.equal(mapping.get("copy"), "root");
	assert.equal(mapping.get("nested-copy"), "root");
	assert.equal(mapping.get("local"), "nested");
});

function makeTurn(id: string, sessionId: string): Turn {
	return { id, sessionId, role: "assistant", content: id, status: "complete", createdAt: "2026-08-25T00:00:00.000Z" };
}

test("a one-line question stays selected across the reading band in either direction", () => {
	for (const direction of [-1, 1] as const) {
		let current: string | null = null;
		const positions = direction === 1 ? [370, 320, 280, 230, 205] : [205, 230, 280, 320, 370];
		for (const top of positions) {
			const boxes = [
				{ turnId: "before", role: "assistant" as const, top: -400, bottom: top - 20 },
				{ turnId: "question", role: "user" as const, top, bottom: top + 24 },
				{ turnId: "after", role: "assistant" as const, top: top + 44, bottom: 1000 },
			];
			current = turnAtViewportRegion(boxes, 0, 600, current, direction)?.turnId ?? null;
			assert.equal(current, "question");
		}
	}
});

test("exit padding absorbs tiny reversals, then releases the user bubble", () => {
	const question = (bottom: number) => ({ turnId: "q", role: "user" as const, top: bottom - 24, bottom });
	const answer = { turnId: "a", role: "assistant" as const, top: 220, bottom: 900 };
	for (const bottom of [211, 208, 212, 200, 188]) {
		assert.equal(turnAtViewportRegion([question(bottom), answer], 0, 600, "q", 1)?.turnId, "q");
	}
	assert.equal(turnAtViewportRegion([question(185), answer], 0, 600, "q", 1)?.turnId, "a");
	assert.equal(turnAtViewportRegion([question(208), answer], 0, 600, "a", -1)?.turnId, "a");
});

test("without users the reading band advances in the scroll direction", () => {
	const boxes = [{ turnId: "earlier", role: "assistant" as const, top: 0, bottom: 280 },
		{ turnId: "later", role: "assistant" as const, top: 300, bottom: 700 }];
	assert.equal(turnAtViewportRegion(boxes, 0, 600, null, -1)?.turnId, "earlier");
	assert.equal(turnAtViewportRegion(boxes, 0, 600, null, 1)?.turnId, "later");
});

test("multiple questions retain the current one until it leaves; stale focus is ignored", () => {
	const boxes = [{ turnId: "q1", role: "user" as const, top: 240, bottom: 264 },
		{ turnId: "q2", role: "user" as const, top: 330, bottom: 354 }];
	assert.equal(turnAtViewportRegion(boxes, 0, 600, "q1", 1)?.turnId, "q1");
	assert.equal(turnAtViewportRegion(boxes, 0, 600, "missing", 1)?.turnId, "q2");
	assert.equal(turnAtViewportRegion(boxes, 0, 600, "missing", -1)?.turnId, "q1");
	assert.equal(turnAtViewportRegion([], 0, 600, "q1", 1), null);
	assert.equal(turnAtViewportRegion(boxes, 0, 0, "q1", 1), null);
});
