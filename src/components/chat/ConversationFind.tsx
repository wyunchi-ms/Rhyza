import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Turn } from "../../types";
import { revealMarkdownHeadingEvent } from "../../utils/markdownSections";

interface ConversationMatch {
	turnId: string;
	range: Range;
}

export function ConversationFind({
	turns,
	scrollContainerRef,
}: {
	turns: Turn[];
	scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [matches, setMatches] = useState<ConversationMatch[]>([]);
	const [activeIndex, setActiveIndex] = useState(0);
	const [navigationRequest, setNavigationRequest] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const previousQueryRef = useRef("");
	const handledNavigationRef = useRef(-1);

	const close = () => {
		setOpen(false);
		clearConversationHighlights();
		scrollContainerRef.current?.focus({ preventScroll: true });
	};

	const move = (direction: -1 | 1) => {
		if (!matches.length) return;
		setActiveIndex((current) => (current + direction + matches.length) % matches.length);
		setNavigationRequest((current) => current + 1);
	};

	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			if (
				!(event.ctrlKey || event.metaKey) ||
				event.shiftKey ||
				event.key.toLocaleLowerCase() !== "f"
			)
				return;
			event.preventDefault();
			if (!open) {
				setOpen(true);
				window.requestAnimationFrame(() => inputRef.current?.focus());
				return;
			}
			if (query && matches.length) move(1);
			else inputRef.current?.focus();
		};
		window.addEventListener("keydown", handleShortcut);
		return () => window.removeEventListener("keydown", handleShortcut);
	}, [matches.length, open, query]);

	useEffect(() => {
		if (!open) return;
		const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
		return () => window.cancelAnimationFrame(frame);
	}, [open]);

	useLayoutEffect(() => {
		if (!open || !query) {
			setMatches([]);
			clearConversationHighlights();
			previousQueryRef.current = "";
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			const nextMatches = collectConversationMatches(scrollContainerRef.current, query);
			const isNewQuery = previousQueryRef.current !== query;
			previousQueryRef.current = query;
			setMatches(nextMatches);
			setActiveIndex((current) => Math.min(current, Math.max(0, nextMatches.length - 1)));
			setConversationHighlights(
				nextMatches.map((match) => match.range),
				[],
			);
			if (isNewQuery && nextMatches.length) setNavigationRequest((current) => current + 1);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [open, query, scrollContainerRef, turns]);

	useEffect(() => {
		if (!open || navigationRequest === handledNavigationRef.current || !matches.length) return;
		handledNavigationRef.current = navigationRequest;
		const current = matches[activeIndex];
		if (!current) return;
		setConversationHighlights(
			matches.map((match) => match.range),
			[current.range],
		);
		const target =
			current.range.startContainer.parentElement ??
			document.getElementById(`turn-${current.turnId}`);
		const frame = window.requestAnimationFrame(() => {
			const section = target?.closest<HTMLElement>("[data-markdown-section-id]");
			if (section) {
				section.dispatchEvent(
					new CustomEvent(revealMarkdownHeadingEvent, {
						bubbles: true,
						detail: { headingId: section.dataset.markdownSectionId },
					}),
				);
			}
			scrollMatchIntoView(target, scrollContainerRef.current);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [activeIndex, matches, navigationRequest, open, scrollContainerRef]);

	useEffect(() => () => clearConversationHighlights(), []);

	if (!open) return null;
	const position = matches.length ? activeIndex + 1 : 0;
	return (
		<div className="conversation-find" role="search" aria-label="Find in conversation">
			<Search size={15} aria-hidden="true" />
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
						close();
					}
					if (event.key === "Enter") {
						event.preventDefault();
						move(event.shiftKey ? -1 : 1);
					}
				}}
				placeholder="Find in conversation"
				aria-label="Find in conversation"
			/>
			<span className="conversation-find-count" aria-live="polite">
				{position}/{matches.length}
			</span>
			<button
				type="button"
				onClick={() => move(-1)}
				disabled={!matches.length}
				title="Previous match (Shift+Enter)"
				aria-label="Previous match"
			>
				<ChevronUp size={16} />
			</button>
			<button
				type="button"
				onClick={() => move(1)}
				disabled={!matches.length}
				title="Next match (Enter)"
				aria-label="Next match"
			>
				<ChevronDown size={16} />
			</button>
			<button type="button" onClick={close} title="Close find" aria-label="Close find">
				<X size={16} />
			</button>
		</div>
	);
}

function scrollMatchIntoView(target: HTMLElement | null, container: HTMLDivElement | null): void {
	if (!target || !container) return;
	const targetRect = target.getBoundingClientRect();
	const containerRect = container.getBoundingClientRect();
	const offset = targetRect.top - containerRect.top;
	const centeredTop =
		container.scrollTop + offset - (container.clientHeight - targetRect.height) / 2;
	container.scrollTop = Math.max(0, centeredTop);
}

function collectConversationMatches(
	container: HTMLDivElement | null,
	query: string,
): ConversationMatch[] {
	if (!container || !query) return [];
	const needle = query.toLocaleLowerCase();
	const matches: ConversationMatch[] = [];
	for (const turnElement of container.querySelectorAll<HTMLElement>("[data-turn-id]")) {
		const searchable = turnElement.querySelector<HTMLElement>("[data-turn-search-content]");
		if (!searchable) continue;
		const walker = document.createTreeWalker(searchable, NodeFilter.SHOW_TEXT);
		let node = walker.nextNode();
		while (node) {
			const value = node.textContent ?? "";
			const haystack = value.toLocaleLowerCase();
			let offset = 0;
			while (offset <= haystack.length - needle.length) {
				const index = haystack.indexOf(needle, offset);
				if (index < 0) break;
				const range = document.createRange();
				range.setStart(node, index);
				range.setEnd(node, index + query.length);
				matches.push({ turnId: turnElement.dataset.turnId ?? "", range });
				offset = index + Math.max(1, needle.length);
			}
			node = walker.nextNode();
		}
	}
	return matches;
}

interface HighlightRegistry {
	set(name: string, highlight: unknown): void;
	delete(name: string): void;
}

function setConversationHighlights(all: Range[], active: Range[]): void {
	const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
	const HighlightConstructor = (
		globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
	).Highlight;
	if (!registry || !HighlightConstructor) return;
	registry.set("conversation-search-match", new HighlightConstructor(...all));
	registry.set("conversation-search-active", new HighlightConstructor(...active));
}

function clearConversationHighlights(): void {
	const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
	registry?.delete("conversation-search-match");
	registry?.delete("conversation-search-active");
}
