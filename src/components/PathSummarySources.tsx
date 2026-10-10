import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../i18n";
import { useAppStore } from "../store";
import { useConversationFocus } from "../store/conversationFocus";
import type { PathSummarySnapshot } from "../types";
import { projectConversationGraph } from "../utils/conversationGraph";

export function PathSummarySources({ snapshot }: { snapshot: PathSummarySnapshot }) {
	const { t } = useTranslation();
	const sessions = useAppStore((state) => state.sessions);
	const turns = useAppStore((state) => state.turns);
	const graph = useMemo(() => projectConversationGraph(sessions, turns), [sessions, turns]);
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const open = (id: string) => {
		const current = useAppStore.getState();
		const projection = projectConversationGraph(current.sessions, current.turns);
		const round = projection.rounds.find((item) => item.id === id);
		if (!round) {
			setError(t("Source deleted"));
			return;
		}
		const turnId = round.answers[round.answers.length - 1]?.id ?? round.user?.id;
		const sessionId = turnId
			? (current.turns.find((turn) => turn.id === turnId)?.sessionId ?? round.sessionId)
			: round.sessionId;
		if (turnId) window.sessionStorage.setItem("rhyza-focus-turn", turnId);
		else window.sessionStorage.removeItem("rhyza-focus-turn");
		useConversationFocus.getState().setFocus(sessionId, turnId ?? null);
		useAppStore.getState().setActiveSession(sessionId);
		navigate("/");
		if (turnId) window.dispatchEvent(new CustomEvent("rhyza:focus-turn", { detail: { turnId } }));
	};
	return (
		<blockquote
			className="user-message-quote path-summary-source-quote"
			aria-label={t("Source paths")}
		>
			{error && <p role="alert">{error}</p>}
			<ul>
				{snapshot.sources.map((source) => {
					const exists = graph.rounds.some((round) => round.id === source.roundId);
					return (
						<li key={source.roundId}>
							<button type="button" disabled={!exists} onClick={() => open(source.roundId)}>
								{source.title}
							</button>
							{!exists && <span>{t("Source deleted")}</span>}
						</li>
					);
				})}
			</ul>
		</blockquote>
	);
}
