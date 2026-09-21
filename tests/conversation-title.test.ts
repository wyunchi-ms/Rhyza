import assert from "node:assert/strict";
import test from "node:test";
import type { SessionNode, Turn } from "../src/types/index.js";
import { conversationTurnTitle } from "../src/utils/conversationTitle.js";
import { projectConversationGraph } from "../src/utils/conversationGraph.js";
import { projectConversationTree } from "../src/utils/conversationTree.js";

const quote = { turnId: "answer", text: "decoder-only architecture" };

test("Explain titles include their quoted subject for new and existing prompts", () => {
	for (const summary of [undefined, "", "explain", " Explain! "]) {
		assert.equal(
			conversationTurnTitle({ content: " explain ", summary, quote }),
			"Explain: decoder-only architecture",
		);
	}
	const long = conversationTurnTitle({
		content: "EXPLAIN",
		quote: { ...quote, text: "  Attention\n  connects\t tokens " + "and context ".repeat(12) },
	});
	assert.match(long, /^Explain: Attention connects token/);
	assert.ok(long.endsWith("..."));
	assert.equal(long.length, 36);
});

test("custom titles, ordinary prompts, image prompts, and missing quotes keep their behavior", () => {
	assert.equal(
		conversationTurnTitle({ content: "explain", summary: "My custom title", quote }),
		"My custom title",
	);
	assert.equal(
		conversationTurnTitle({
			content: "explain",
			summary: "Explain: decoder-only architecture",
			quote,
		}),
		"Explain: decoder-only architecture",
	);
	assert.equal(
		conversationTurnTitle({ content: "Why does attention work?", quote }),
		"Why does attention work?",
	);
	assert.equal(conversationTurnTitle({ content: "explain" }), "explain");
	assert.equal(
		conversationTurnTitle({ content: "explain", quote: { ...quote, text: " \n " } }),
		"explain",
	);
	assert.equal(conversationTurnTitle({ content: "" }), "Image prompt");
});

test("stored Explain turns gain contextual titles in both node projections without rewriting history", () => {
	const session: SessionNode = {
		id: "chat",
		parentId: null,
		isRoot: true,
		title: "explain",
		status: "idle",
	};
	const turn: Turn = {
		id: "question",
		sessionId: session.id,
		role: "user",
		content: "explain",
		summary: "explain",
		quote,
		status: "complete",
		createdAt: "2026-09-21T00:00:00Z",
	};
	assert.equal(
		projectConversationGraph([session], [turn]).rounds[0].title,
		"Explain: decoder-only architecture",
	);
	assert.equal(
		projectConversationTree([session], [turn]).roots[0].title,
		"Explain: decoder-only architecture",
	);
	assert.equal(turn.content, "explain");
	assert.equal(turn.summary, "explain");
});
