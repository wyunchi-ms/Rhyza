import { CornerDownLeft, MessageSquareText, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store";
import type { SessionNode, Turn } from "../types";
import { useTranslation } from "../i18n";

interface GlobalSearchResult {
	session: SessionNode;
	turn?: Turn;
	snippet: string;
	score: number;
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
	const { t } = useTranslation();
	const sessions = useAppStore((state) => state.sessions);
	const turns = useAppStore((state) => state.turns);
	const setActiveSession = useAppStore((state) => state.setActiveSession);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const deferredQuery = useDeferredValue(query);
	const inputRef = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();
	const results = useMemo(
		() => buildGlobalResults(deferredQuery, sessions, turns),
		[deferredQuery, sessions, turns],
	);

	useEffect(() => {
		if (!open) return;
		setActiveIndex(0);
		const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onClose();
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [onClose, open]);

	useEffect(() => {
		setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
	}, [results.length]);

	if (!open) return null;

	const openResult = (result: GlobalSearchResult | undefined) => {
		if (!result) return;
		setActiveSession(result.session.id);
		if (result.turn) window.sessionStorage.setItem("rhyza-focus-turn", result.turn.id);
		else window.sessionStorage.removeItem("rhyza-focus-turn");
		navigate("/");
		if (result.turn)
			window.dispatchEvent(
				new CustomEvent("rhyza:focus-turn", { detail: { turnId: result.turn.id } }),
			);
		onClose();
	};

	return (
		<div
			className="global-search-backdrop"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<section
				className="global-search-dialog"
				role="dialog"
				aria-modal="true"
				aria-label={t("Search all chats")}
			>
				<header className="global-search-input-row">
					<Search size={18} aria-hidden="true" />
					<input
						ref={inputRef}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActiveIndex(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								onClose();
							}
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setActiveIndex((current) => (results.length ? (current + 1) % results.length : 0));
							}
							if (event.key === "ArrowUp") {
								event.preventDefault();
								setActiveIndex((current) =>
									results.length ? (current - 1 + results.length) % results.length : 0,
								);
							}
							if (event.key === "Enter") {
								event.preventDefault();
								openResult(results[activeIndex]);
							}
						}}
						placeholder={t("Search chats")}
						aria-label={t("Search chats")}
						aria-controls="global-search-results"
						aria-activedescendant={
							results[activeIndex]
								? `global-search-result-${results[activeIndex].session.id}`
								: undefined
						}
					/>
					<kbd>Ctrl Shift F</kbd>
					<button
						type="button"
						onClick={onClose}
						title={t("Close search")}
						aria-label={t("Close search")}
					>
						<X size={17} />
					</button>
				</header>
				<div
					id="global-search-results"
					className="global-search-results"
					role="listbox"
					aria-label="Chat search results"
				>
					<div className="global-search-section-label">
						{query.trim() ? `${results.length} ${t("matching chats")}` : t("Recent chats")}
					</div>
					{results.map((result, index) => (
						<button
							id={`global-search-result-${result.session.id}`}
							key={result.session.id}
							type="button"
							role="option"
							aria-selected={index === activeIndex}
							className={index === activeIndex ? "is-active" : undefined}
							onMouseEnter={() => setActiveIndex(index)}
							onClick={() => openResult(result)}
						>
							<span className="global-search-result-icon">
								<MessageSquareText size={16} />
							</span>
							<span className="global-search-result-copy">
								<strong>{result.session.title}</strong>
								<small>{result.snippet}</small>
							</span>
							<CornerDownLeft size={14} className="global-search-enter" />
						</button>
					))}
					{results.length === 0 && (
						<div className="global-search-empty">
							<Search size={22} />
							<strong>{t("No matching chats")}</strong>
							<span>{t("Try fewer words or a shorter spelling.")}</span>
						</div>
					)}
				</div>
				<footer>
					<span>
						<kbd>↑</kbd>
						<kbd>↓</kbd> {t("Navigate")}
					</span>
					<span>
						<kbd>Enter</kbd> {t("Open")}
					</span>
					<span>
						<kbd>Esc</kbd> {t("Close")}
					</span>
				</footer>
			</section>
		</div>
	);
}

function buildGlobalResults(
	query: string,
	sessions: SessionNode[],
	turns: Turn[],
): GlobalSearchResult[] {
	const normalizedQuery = normalizeSearchText(query);
	const turnsBySession = new Map<string, Turn[]>();
	for (const turn of turns) {
		const group = turnsBySession.get(turn.sessionId) ?? [];
		group.push(turn);
		turnsBySession.set(turn.sessionId, group);
	}
	const results = sessions
		.map((session): GlobalSearchResult | null => {
			const sessionTurns = turnsBySession.get(session.id) ?? [];
			if (!normalizedQuery) {
				const latest = sessionTurns[sessionTurns.length - 1];
				return {
					session,
					turn: latest,
					snippet: latest ? cleanSnippet(latest.content) : "No messages yet",
					score: latest ? Date.parse(latest.createdAt) : 0,
				};
			}
			let score = fuzzyScore(normalizedQuery, session.title) * 1.4;
			let bestTurn: Turn | undefined;
			for (const turn of sessionTurns) {
				const turnScore = Math.max(
					fuzzyScore(normalizedQuery, turn.content),
					fuzzyScore(normalizedQuery, turn.summary ?? "") * 1.1,
				);
				if (turnScore > score || (!bestTurn && turnScore > 0)) {
					score = Math.max(score, turnScore);
					bestTurn = turn;
				}
			}
			if (score <= 0) return null;
			return {
				session,
				turn: bestTurn,
				snippet: bestTurn ? matchingSnippet(bestTurn.content, normalizedQuery) : session.title,
				score,
			};
		})
		.filter((result): result is GlobalSearchResult => Boolean(result));
	return results.sort((left, right) => right.score - left.score).slice(0, 40);
}

function fuzzyScore(query: string, value: string): number {
	const candidate = normalizeSearchText(value);
	if (!query || !candidate) return 0;
	const exactIndex = candidate.indexOf(query);
	if (exactIndex >= 0)
		return 1000 - Math.min(400, exactIndex) - Math.min(300, candidate.length / 20);
	const terms = query.split(" ").filter(Boolean);
	let total = 0;
	for (const term of terms) {
		let cursor = -1;
		let gaps = 0;
		for (const character of term) {
			const next = candidate.indexOf(character, cursor + 1);
			if (next < 0) return 0;
			if (cursor >= 0) gaps += next - cursor - 1;
			cursor = next;
		}
		total += 120 - Math.min(100, gaps) - Math.min(20, cursor / 10);
	}
	return Math.max(1, total);
}

function matchingSnippet(content: string, query: string): string {
	const cleaned = cleanSnippet(content, 500);
	const index = normalizeSearchText(cleaned).indexOf(query);
	if (index < 0) return cleanSnippet(cleaned);
	const start = Math.max(0, index - 55);
	const end = Math.min(cleaned.length, index + query.length + 85);
	return `${start > 0 ? "…" : ""}${cleaned.slice(start, end)}${end < cleaned.length ? "…" : ""}`;
}

function cleanSnippet(value: string, limit = 150): string {
	const cleaned = value
		.replace(/```[\s\S]*?```/g, " code ")
		.replace(/[#*_`>\[\]()]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned.length > limit
		? `${cleaned.slice(0, limit).trim()}…`
		: cleaned || "No text content";
}

function normalizeSearchText(value: string): string {
	return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}
