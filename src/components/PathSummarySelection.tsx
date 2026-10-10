import { FileText, GitMerge, X } from "lucide-react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { getRhyzaBridge } from "../hooks/useRhyzaBridge";
import { useTranslation } from "../i18n";
import { providerModelSelection } from "../shared/providers";
import { errorToMessage } from "../shared/value";
import { getWorkspacePersistencePath, useAppStore } from "../store";
import { useConversationFocus } from "../store/conversationFocus";
import { createId } from "../utils/common";
import { projectConversationGraph } from "../utils/conversationGraph";
import { buildPathSummaryInput } from "../utils/pathSummary";
import "./pathSummary.css";

interface SummarySelection {
	selecting: boolean;
	selected: ReadonlySet<string>;
	running: boolean;
	canceling: boolean;
	error: string | null;
	cancel: () => Promise<void>;
	begin: (ids?: readonly string[]) => void;
	toggle: (id: string) => void;
	toggleList: (roundIds: readonly string[], endpoint: string) => void;
	summarize: (ids?: readonly string[]) => Promise<void>;
	reportVisible: (owner: string, ids: readonly string[] | null) => void;
}

const SummarySelectionContext = createContext<SummarySelection | null>(null);

export function usePathSummarySelection(): SummarySelection {
	const context = useContext(SummarySelectionContext);
	if (!context) throw new Error("Summary selection requires PathSummaryProvider.");
	return context;
}

export function PathSummaryProvider({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const sessions = useAppStore((state) => state.sessions);
	const turns = useAppStore((state) => state.turns);
	const graph = useMemo(() => projectConversationGraph(sessions, turns), [sessions, turns]);
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [prompt, setPrompt] = useState("");
	const [visible, setVisible] = useState<Map<string, Set<string>>>(() => new Map());
	const [running, setRunning] = useState(false);
	const [canceling, setCanceling] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pending = useRef<{ id: string; cancelRequested: boolean } | null>(null);
	const mounted = useRef(true);
	const reportVisible = useCallback((owner: string, ids: readonly string[] | null) => {
		setVisible((current) => {
			const previous = current.get(owner);
			if (!ids && !previous) return current;
			if (ids && previous?.size === ids.length && ids.every((id) => previous.has(id)))
				return current;
			const next = new Map(current);
			if (ids) next.set(owner, new Set(ids));
			else next.delete(owner);
			return next;
		});
	}, []);
	const toggle = useCallback((id: string) => {
		if (pending.current) return;
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
		setError(null);
	}, []);
	const toggleList = useCallback((roundIds: readonly string[], endpoint: string) => {
		if (pending.current) return;
		setSelected((current) => {
			const next = new Set(current);
			if (roundIds.some((id) => next.has(id))) roundIds.forEach((id) => next.delete(id));
			else next.add(endpoint);
			return next;
		});
		setError(null);
	}, []);
	const cancel = useCallback(async () => {
		const operation = pending.current;
		if (!operation) {
			setSelecting(false);
			setSelected(new Set());
			setError(null);
			return;
		}
		const bridge = getRhyzaBridge();
		if (!bridge) {
			setError("The Electron runtime is unavailable; the summary could not be canceled.");
			return;
		}
		setCanceling(true);
		operation.cancelRequested = true;
		try {
			await bridge.cancelAuxiliaryRequest({ requestId: operation.id });
		} catch (failure) {
			operation.cancelRequested = false;
			setError(errorToMessage(failure));
			setCanceling(false);
		}
	}, []);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			const id = pending.current?.id;
			const bridge = getRhyzaBridge();
			if (id && bridge) {
				void bridge.cancelAuxiliaryRequest({ requestId: id }).catch((failure: unknown) => {
					console.error("Could not cancel the unmounted path-summary request.", failure);
				});
			}
		};
	}, []);
	useEffect(() => {
		if (!selecting) return;
		const escape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				void cancel();
			}
		};
		window.addEventListener("keydown", escape);
		return () => window.removeEventListener("keydown", escape);
	}, [selecting, cancel]);

	const summarize = useCallback(
		async (ids?: readonly string[]) => {
			if (pending.current) return;
			const selectedIds = ids ?? [...selected];
			setSelecting(true);
			if (ids) setSelected(new Set(ids));
			setError(null);
			const workspace = getWorkspacePersistencePath();
			const operation = { id: createId("summary"), cancelRequested: false };
			let pendingSessionId: string | undefined;
			const previousSessionId = useAppStore.getState().activeSessionId;
			try {
				const state = useAppStore.getState();
				const input = buildPathSummaryInput(state.sessions, state.turns, selectedIds);
				const bridge = getRhyzaBridge();
				if (!bridge || typeof bridge.generatePathSummary !== "function") {
					throw new Error(
						"Path summaries require the updated Electron runtime. Restart the desktop app.",
					);
				}
				const model = providerModelSelection(state.settings);
				const createdAt = new Date().toISOString();
				pendingSessionId = state.createSummarySession(
					"",
					{ sources: input.sources, createdAt, model },
					undefined,
					prompt,
				);
				useConversationFocus.getState().setFocus(pendingSessionId, null);
				state.setActiveSession(pendingSessionId);
				navigate("/");
				pending.current = operation;
				setRunning(true);
				setCanceling(false);
				const result = await bridge.generatePathSummary({
					requestId: operation.id,
					model,
					prompt: prompt.trim(),
					rounds: input.rounds,
					paths: input.paths,
				});
				if (!mounted.current) return;
				if (getWorkspacePersistencePath() !== workspace) {
					throw new Error(
						"The workspace changed during summary generation. The result was not added to another workspace.",
					);
				}
				const current = useAppStore.getState();
				if (
					result.canceled ||
					operation.cancelRequested ||
					result.error ||
					!result.content?.trim()
				) {
					const sourceSession = input.sources
						.map((source) => source.sessionId)
						.find((id) => current.sessions.some((session) => session.id === id));
					const usageOwner = sourceSession ?? current.activeSessionId;
					if (usageOwner) current.addSessionSummaryUsage(usageOwner, result.usage);
					if (result.canceled || operation.cancelRequested) {
						setError(t("Summary canceled. Your selection is preserved."));
						return;
					}
					throw new Error(result.error || "The model returned an empty path summary.");
				}
				current.completeSummarySession(pendingSessionId, result.content, result.usage);
				pendingSessionId = undefined;
				setSelected(new Set());
				setSelecting(false);
				setPrompt("");
			} catch (failure) {
				if (mounted.current) setError(errorToMessage(failure));
			} finally {
				if (pendingSessionId && getWorkspacePersistencePath() === workspace) {
					const current = useAppStore.getState();
					if (current.sessions.some((session) => session.id === pendingSessionId)) {
						if (current.activeSessionId === pendingSessionId && previousSessionId) {
							useConversationFocus.getState().setFocus(previousSessionId, null);
							current.setActiveSession(previousSessionId);
						}
						current.deleteSession(pendingSessionId);
					}
				}
				pending.current = null;
				if (mounted.current) {
					setRunning(false);
					setCanceling(false);
				}
			}
		},
		[selected, prompt, navigate, t],
	);
	const allVisible = new Set([...visible.values()].flatMap((ids) => [...ids]));
	const hiddenCount = [...selected].filter((id) => !allVisible.has(id)).length;
	const begin = useCallback((ids?: readonly string[]) => {
		setSelecting(true);
		setSelected(new Set(ids));
		setError(null);
	}, []);
	const value = useMemo(
		() => ({
			selecting,
			selected,
			running,
			canceling,
			error,
			cancel,
			begin,
			toggle,
			toggleList,
			summarize,
			reportVisible,
		}),
		[
			selecting,
			selected,
			running,
			canceling,
			error,
			cancel,
			begin,
			toggle,
			toggleList,
			summarize,
			reportVisible,
		],
	);
	return (
		<SummarySelectionContext.Provider value={value}>
			<PathSummaryToolbarContext.Provider
				value={
					selecting &&
					!running && (
						<div className="path-summary-toolbar">
							<>
								<div className="path-summary-controls">
									<span aria-live="polite">
										{selected.size} {t("selected")}
									</span>
									<button
										type="button"
										className="path-summary-cancel"
										onClick={() => void cancel()}
										disabled={canceling}
									>
										{canceling ? t("Canceling…") : t("Cancel")}
									</button>
									<button
										type="button"
										className="path-summary-generate"
										onClick={() => void summarize()}
										disabled={!selected.size}
									>
										<FileText size={14} /> {t("Summary")}
									</button>
								</div>
								<label className="path-summary-prompt">
									<span>{t("Summary instructions (optional)")}</span>
									<textarea
										value={prompt}
										maxLength={4000}
										rows={2}
										onChange={(event) => setPrompt(event.target.value)}
										placeholder={t("What should the summary focus on?")}
									/>
								</label>
								{hiddenCount > 0 && (
									<span className="path-summary-hint">
										{hiddenCount} {t("selected nodes are hidden")}
									</span>
								)}
								{selected.size > 0 && (
									<details className="path-summary-selection-details">
										<summary>{t("Selected paths")}</summary>
										{[...selected].map((id) => (
											<div key={id} className="path-summary-selected-item">
												<span>
													{graph.rounds.find((round) => round.id === id)?.title ??
														t("Source deleted")}
												</span>
												<button
													type="button"
													onClick={() => toggle(id)}
													disabled={running}
													aria-label={t("Remove selection")}
												>
													<X size={13} />
												</button>
											</div>
										))}
									</details>
								)}
							</>
							{error && (
								<div className="path-summary-error" role="alert">
									{error}
								</div>
							)}
						</div>
					)
				}
			>
				{children}
			</PathSummaryToolbarContext.Provider>
		</SummarySelectionContext.Provider>
	);
}

const PathSummaryToolbarContext = createContext<ReactNode>(null);

export function PathSummaryToolbar() {
	return useContext(PathSummaryToolbarContext);
}

export function MergeModeButton() {
	const { t } = useTranslation();
	const { begin, selecting } = usePathSummarySelection();
	if (selecting) return null;
	return (
		<button
			type="button"
			className="path-summary-mode-button"
			aria-label={t("Merge paths")}
			title={t("Merge paths")}
			onClick={() => begin()}
		>
			<GitMerge size={14} /> {t("Merge paths")}
		</button>
	);
}
