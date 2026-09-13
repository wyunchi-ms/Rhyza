import assert from "node:assert/strict";
import test from "node:test";
import { useConversationFocus } from "../src/store/conversationFocus.js";

test("reading focus publishes one atomic update and ignores unchanged scroll frames", () => {
	const updates: Array<[string | null, string | null]> = [];
	const unsubscribe = useConversationFocus.subscribe((state) => updates.push([state.sessionId, state.turnId]));
	try {
		const { setFocus } = useConversationFocus.getState();
		setFocus("child", "user");
		setFocus("child", "user");
		setFocus("child", "agent");
		setFocus("other", null);
		assert.deepEqual(updates, [["child", "user"], ["child", "agent"], ["other", null]]);
	} finally {
		unsubscribe();
		useConversationFocus.getState().setFocus(null, null);
	}
});
