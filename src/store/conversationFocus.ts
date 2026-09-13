import { create } from "zustand";

// Reading position is transient UI state. Keep it out of workspace persistence:
// scrolling must not serialize/save the entire conversation on every turn change.
export const useConversationFocus = create<{
	sessionId: string | null;
	turnId: string | null;
	setFocus: (sessionId: string | null, turnId: string | null) => void;
}>((set) => ({
	sessionId: null,
	turnId: null,
	setFocus: (sessionId, turnId) => set((state) =>
		state.sessionId === sessionId && state.turnId === turnId ? state : { sessionId, turnId }),
}));
