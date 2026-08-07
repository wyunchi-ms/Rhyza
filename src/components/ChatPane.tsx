import clsx from "clsx";
import { Bot, GitFork, MoreHorizontal, User } from "lucide-react";
import React, { useState } from "react";
import {
	githubCopilotProviderId,
	getKnowbranchBridge,
	isElectronRuntime,
} from "../hooks/useKnowbranchBridge";
import { useAppStore } from "../store";
import type { Turn } from "../types";

export const ChatPane: React.FC = () => {
	const {
		turns,
		activeSessionId,
		addTurn,
		addManualTurn,
		updateTurn,
		forkSession,
		toggleRightPane,
		rightPaneOpen,
		settings,
		sessions,
	} = useAppStore();
	const sessionTurns = turns.filter((t) => t.sessionId === activeSessionId);
	const [input, setInput] = useState("");
	const [sendError, setSendError] = useState<string | null>(null);
	const [isSending, setIsSending] = useState(false);

	const handleSend = async () => {
		if (!input.trim() || !activeSessionId) return;
		const prompt = input.trim();
		setInput("");
		setSendError(null);

		const bridge = getKnowbranchBridge();
		if (!bridge) {
			addTurn(activeSessionId, prompt);
			return;
		}

		const userTurnId = crypto.randomUUID();
		const assistantTurnId = crypto.randomUUID();
		addManualTurn({
			id: userTurnId,
			sessionId: activeSessionId,
			role: "user",
			content: prompt,
			status: "complete",
			summary: `${prompt.substring(0, 15)}...`,
		});
		addManualTurn({
			id: assistantTurnId,
			sessionId: activeSessionId,
			role: "assistant",
			content: "Running through Pi SDK...",
			status: "running",
			summary: "Pi SDK request running",
		});

		setIsSending(true);
		try {
			const activeSession = sessions.find((session) => session.id === activeSessionId);
			const result = await bridge.agentPrompt({
				frontendSessionId: activeSessionId,
				parentFrontendSessionId: activeSession?.parentId ?? undefined,
				forkedFromTurnId: activeSession?.parentId
					? sessionTurns[sessionTurns.length - 1]?.id
					: undefined,
				transcript: sessionTurns.map((turn) => ({
					id: turn.id,
					role: turn.role,
					content: turn.content,
				})),
				prompt,
				model: isLikelyProviderModelId(settings.defaultModel)
					? {
							providerId: githubCopilotProviderId,
							modelId: settings.defaultModel,
						}
					: undefined,
			});
			updateTurn(assistantTurnId, {
				content: result.ok
					? result.assistantText || "Pi SDK completed without text output."
					: result.error || "Pi SDK request failed.",
				status: result.ok ? "complete" : "finalizing",
				summary: result.ok ? "Pi SDK response" : "Pi SDK error",
			});
			if (!result.ok) {
				setSendError(result.error ?? "Pi SDK request failed.");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			updateTurn(assistantTurnId, {
				content: message,
				status: "finalizing",
				summary: "Pi SDK error",
			});
			setSendError(message);
		} finally {
			setIsSending(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<div className="flex-1 flex flex-col bg-white h-full relative">
			<div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-6">
				{sessionTurns.map((turn) => (
					<TurnMessage
						key={turn.id}
						turn={turn}
						onFork={() => forkSession(turn.id)}
						onEntityClick={() => !rightPaneOpen && toggleRightPane()}
					/>
				))}
				{sessionTurns.length === 0 && (
					<div className="m-auto text-center max-w-md">
						<h1 className="text-4xl font-black tracking-tight text-primary mb-4">
							Start Exploring.
						</h1>
						<p className="text-secondary text-lg">
							Ask a question about your code or documents to begin building your
							knowledge graph.
						</p>
					</div>
				)}
			</div>

			<div className="p-4 bg-white border-t border-gray-100">
				<div className="max-w-3xl mx-auto relative rounded-2xl shadow-sm border border-gray-200 bg-white p-2 flex items-end">
					<textarea
						className="w-full max-h-48 min-h-[44px] resize-none outline-none p-2 text-primary placeholder-gray-400 bg-transparent"
						placeholder="Ask about architecture, components, or ask to modify code..."
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						rows={1}
					/>
					<button
						type="button"
						onClick={handleSend}
						disabled={isSending}
						className="p-2 mb-1 mr-1 bg-accent text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
					>
						{isSending ? "Sending" : "Send"}
					</button>
				</div>
				<div className="text-center mt-2 text-xs text-gray-400 font-medium tracking-wide">
					{isElectronRuntime()
						? `Using Pi SDK / GitHub Copilot (${settings.defaultModel})`
						: `Browser demo fallback: mocked chat using ${settings.provider} (${settings.defaultModel})`}
				</div>
				{sendError && (
					<div className="text-center mt-1 text-xs text-red-500 font-medium">
						{sendError}
					</div>
				)}
			</div>
		</div>
	);
};

function isLikelyProviderModelId(value: string): boolean {
	return value.trim() === value && !value.includes(" ") && !value.includes("(");
}

const TurnMessage = ({
	turn,
	onFork,
	onEntityClick,
}: {
	turn: Turn;
	onFork: () => void;
	onEntityClick: () => void;
}) => {
	const isUser = turn.role === "user";

	const renderContent = () => {
		if (!turn.entities || turn.entities.length === 0) {
			return <div className="leading-relaxed text-[15px]">{turn.content}</div>;
		}

		let parts: (string | React.ReactNode)[] = [turn.content];

		turn.entities.forEach((entity) => {
			const nextParts: (string | React.ReactNode)[] = [];
			parts.forEach((part) => {
				if (typeof part === "string") {
					const split = part.split(entity.name);
					split.forEach((s, i) => {
						nextParts.push(s);
						if (i < split.length - 1) {
							nextParts.push(
								<button
									type="button"
									key={`${entity.id}-${i}`}
									onClick={onEntityClick}
									className="text-accent hover:underline font-medium cursor-pointer inline bg-transparent border-none p-0 appearance-none text-left"
								>
									{entity.name}
								</button>,
							);
						}
					});
				} else {
					nextParts.push(part);
				}
			});
			parts = nextParts;
		});

		return (
			<div className="leading-relaxed text-[15px]">
				{parts.map((part, i) => (
					<React.Fragment key={i}>{part}</React.Fragment>
				))}
			</div>
		);
	};

	return (
		<div
			className={clsx(
				"flex gap-4 max-w-3xl mx-auto w-full group",
				isUser ? "flex-row-reverse" : "",
			)}
		>
			<div
				className={clsx(
					"w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1",
					isUser
						? "bg-gray-100 text-gray-600"
						: "bg-primary text-white shadow-sm",
				)}
			>
				{isUser ? <User size={16} /> : <Bot size={16} />}
			</div>
			<div
				className={clsx(
					"flex flex-col gap-2 max-w-[85%]",
					isUser ? "items-end" : "items-start",
				)}
			>
				<div
					className={clsx(
						"p-4 rounded-2xl",
						isUser
							? "bg-gray-50 rounded-tr-sm"
							: "bg-white border border-gray-100 shadow-sm rounded-tl-sm",
					)}
				>
					{renderContent()}
				</div>

				<div
					className={clsx(
						"flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity",
						isUser ? "flex-row-reverse" : "flex-row",
					)}
				>
					<button
						type="button"
						onClick={onFork}
						className="text-xs text-gray-500 hover:text-accent flex items-center gap-1 font-medium bg-gray-50 px-2 py-1 rounded"
					>
						<GitFork size={12} /> Fork here
					</button>
					{!isUser && (
						<button
							type="button"
							className="text-xs text-gray-500 hover:text-primary flex items-center gap-1 font-medium bg-gray-50 px-2 py-1 rounded"
						>
							<MoreHorizontal size={12} />
						</button>
					)}
				</div>
			</div>
		</div>
	);
};
