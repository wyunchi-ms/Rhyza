import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentTranscriptTurn } from "../../src/shared/ipc.js";

export interface PiSessionLineageOptions {
	workspacePath: string;
	sessionDir: string;
	frontendSessionId: string;
	parentFrontendSessionId?: string;
	forkedFromTurnId?: string;
	transcript: AgentTranscriptTurn[];
}

export interface PiSessionLineageResult {
	sessionManager: SessionManager;
	sessionFile: string;
	created: boolean;
}

const pendingSessionResolutions = new Map<string, Promise<PiSessionLineageResult>>();

/**
 * Resolve one canonical persisted Pi session for a frontend tree node. Existing
 * sessions are reopened without replay; new sessions are seeded once and link
 * to the real parent session file path expected by Pi.
 */
export async function openOrCreatePiSession(
	options: PiSessionLineageOptions,
): Promise<PiSessionLineageResult> {
	const resolutionKey = `${path.resolve(options.sessionDir).toLocaleLowerCase()}::${piSessionIdForFrontend(options.frontendSessionId)}`;
	const pending = pendingSessionResolutions.get(resolutionKey);
	if (pending) return pending;
	const operation = openOrCreatePiSessionUnlocked(options);
	pendingSessionResolutions.set(resolutionKey, operation);
	try {
		return await operation;
	} finally {
		if (pendingSessionResolutions.get(resolutionKey) === operation) pendingSessionResolutions.delete(resolutionKey);
	}
}

async function openOrCreatePiSessionUnlocked(
	options: PiSessionLineageOptions,
): Promise<PiSessionLineageResult> {
	const sessions = await SessionManager.listAll(options.sessionDir);
	const sessionId = piSessionIdForFrontend(options.frontendSessionId);
	const existing = sessions.find((session) => session.id === sessionId);
	const parentSessionFile = resolveParentSessionFile(
		sessions,
		options.frontendSessionId,
		options.parentFrontendSessionId,
	);

	if (existing) {
		return {
			sessionManager: SessionManager.open(existing.path, options.sessionDir, options.workspacePath),
			sessionFile: existing.path,
			created: false,
		};
	}

	const sessionManager = SessionManager.create(options.workspacePath, options.sessionDir, {
		id: sessionId,
		parentSession: parentSessionFile,
	});
	for (const turn of options.transcript) appendTranscriptTurn(sessionManager, turn);
	if (options.parentFrontendSessionId || options.forkedFromTurnId) {
		sessionManager.appendCustomEntry("knowbranch.branch", {
			frontendSessionId: options.frontendSessionId,
			parentFrontendSessionId: options.parentFrontendSessionId,
			parentSessionFile,
			forkedFromTurnId: options.forkedFromTurnId,
			replayStrategy: "distinct persisted Pi session seeded once from the frontend branch transcript",
		});
	}
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error(`Pi did not persist session ${options.frontendSessionId}.`);
	return { sessionManager, sessionFile, created: true };
}

export function piSessionIdForFrontend(frontendSessionId: string): string {
	return `kb-${frontendSessionId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function resolveParentSessionFile(
	sessions: Awaited<ReturnType<typeof SessionManager.listAll>>,
	frontendSessionId: string,
	parentFrontendSessionId?: string,
): string | undefined {
	if (!parentFrontendSessionId) return undefined;
	if (parentFrontendSessionId === frontendSessionId) {
		throw new Error(`Pi session ${frontendSessionId} cannot be its own parent.`);
	}
	const parentId = piSessionIdForFrontend(parentFrontendSessionId);
	const parent = sessions.find((session) => session.id === parentId);
	if (!parent) {
		throw new Error(`Cannot create Pi branch ${frontendSessionId}: parent session ${parentFrontendSessionId} is missing.`);
	}
	return parent.path;
}

function appendTranscriptTurn(sessionManager: SessionManager, turn: AgentTranscriptTurn): void {
	if (turn.role === "user") {
		sessionManager.appendMessage({
			role: "user",
			content: turn.images?.length
				? [{ type: "text", text: turn.content }, ...turn.images.map((image): ImageContent => ({ type: "image", data: image.data, mimeType: image.mimeType }))]
				: turn.content,
			timestamp: Date.now(),
		});
		return;
	}
	sessionManager.appendCustomMessageEntry(
		"knowbranch.replayed-assistant",
		`Assistant said earlier: ${turn.content}`,
		false,
		{ sourceTurnId: turn.id },
	);
}
