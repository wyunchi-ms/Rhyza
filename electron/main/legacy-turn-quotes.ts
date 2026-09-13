import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Turn } from "../../src/types/index.js";
import { isRecord } from "../../src/shared/value.js";

/** Early selection questions saved the passage only in the Pi session prompt. */
export function restoreLegacyTurnQuotes(serialized: string, sessionDirectory: string): string {
	try {
		const envelope = JSON.parse(serialized);
		const state = isRecord(envelope.state) ? envelope.state : envelope;
		if (!Array.isArray(state.turns)) return serialized;
		const turns: Turn[] = state.turns;
		const sessions = new Map<string, Turn[]>();
		for (const turn of turns) {
			const group = sessions.get(turn.sessionId) ?? [];
			group.push(turn);
			sessions.set(turn.sessionId, group);
		}
		const files = readdirSync(sessionDirectory);
		const recovered = new Map<string, NonNullable<Turn["quote"]>>();
		for (const [sessionId, history] of sessions) {
			if (!history.some((turn) => turn.role === "user" && !turn.quote)) continue;
			const suffix = `_kb-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "-")}.jsonl`;
			for (const file of files.filter((name) => name.endsWith(suffix))) {
				let lines: string[];
				try { lines = readFileSync(path.join(sessionDirectory, file), "utf8").split(/\r?\n/); }
				catch { continue; }
				for (const line of lines) {
					const selection = readSelection(line);
					if (!selection) continue;
					// Equal questions can refer to different passages. Only restore an
					// unambiguous question in this exact session, never guess from answers.
					const matches = history.filter((turn) => turn.role === "user" && turn.content.trim() === selection.question);
					if (matches.length !== 1 || matches[0].quote) continue;
					const user = matches[0];
					const source = history.slice(0, history.indexOf(user)).reverse().find((turn) =>
						turn.role === "assistant" && normalizedText(turn.content).includes(normalizedText(selection.text)),
					);
					if (source) recovered.set(user.id, { turnId: source.id, text: selection.text });
				}
			}
		}
		if (!recovered.size) return serialized;
		state.turns = turns.map((turn) => {
			const quote = recovered.get(turn.id) ?? (turn.sourceTurnId ? recovered.get(turn.sourceTurnId) : undefined);
			return !turn.quote && quote ? { ...turn, quote } : turn;
		});
		return JSON.stringify(envelope);
	} catch {
		// Missing or damaged legacy logs must never prevent loading a workspace.
		return serialized;
	}
}

function readSelection(line: string): { text: string; question: string } | undefined {
	try {
		const entry = JSON.parse(line);
		if (entry.type !== "message" || entry.message?.role !== "user") return;
		const content = entry.message.content;
		const text = typeof content === "string" ? content : Array.isArray(content)
			? content.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n") : "";
		const start = text.lastIndexOf("<user_question>\n");
		if (start < 0 || !text.trimEnd().endsWith("</user_question>")) return;
		const prompt = text.slice(start + "<user_question>\n".length, text.lastIndexOf("</user_question>")).trim();
		if (!prompt.startsWith("Answer the user's question using the selected passage as the primary focus.")) return;
		const passageStart = prompt.indexOf("\n\nSelected passage:\n");
		const questionStart = prompt.lastIndexOf("\n\nUser question:\n");
		if (passageStart < 0 || questionStart <= passageStart) return;
		const passage = prompt.slice(passageStart + "\n\nSelected passage:\n".length, questionStart).trim();
		const question = prompt.slice(questionStart + "\n\nUser question:\n".length).trim();
		if (passage && question && normalizedText(passage)) return { text: passage, question };
	} catch { /* Ignore partial JSONL entries. */ }
}

function normalizedText(text: string): string {
	return text.replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();
}
