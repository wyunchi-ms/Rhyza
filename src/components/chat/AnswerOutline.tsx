import { ListTree } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { markdownHeadingSelector, revealMarkdownHeadingEvent } from "../../utils/markdownSections";
import "./answerOutline.css";

interface OutlineHeading {
	id: string;
	level: number;
	text: string;
}

interface OutlinePlacement {
	left: number;
	top: number;
	width: number;
	maxHeight: number;
}

export function AnswerOutline({
	turnId,
	scrollContainerRef,
	reduceMotion,
}: {
	turnId: string | null;
	scrollContainerRef: RefObject<HTMLDivElement | null>;
	reduceMotion: boolean;
}) {
	const [headings, setHeadings] = useState<OutlineHeading[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [placement, setPlacement] = useState<OutlinePlacement | null>(null);
	const listRef = useRef<HTMLOListElement>(null);
	const navigationFrame = useRef(0);

	useLayoutEffect(() => {
		const container = scrollContainerRef.current;
		const answer = turnId ? document.getElementById(`turn-${turnId}`) : null;
		const pane = container?.closest<HTMLElement>(".chat-pane");
		if (!container || !answer || !pane) {
			setHeadings([]);
			setPlacement(null);
			return;
		}
		let frame = 0;
		let headingElements: HTMLElement[] = [];
		const updateActiveHeading = () => {
			const bounds = container.getBoundingClientRect();
			const readingLine = bounds.top + Math.min(120, bounds.height * 0.25);
			const visible = headingElements.filter((heading) => heading.getClientRects().length > 0);
			let current = visible[0];
			for (const heading of visible) {
				if (heading.getBoundingClientRect().top > readingLine) break;
				current = heading;
			}
			setActiveId(current?.dataset.markdownHeadingId ?? null);
		};
		const measure = () => {
			const paneBounds = pane.getBoundingClientRect();
			const scrollBounds = container.getBoundingClientRect();
			const gutter = answer.getBoundingClientRect().left - paneBounds.left;
			const width = Math.min(256, gutter - 40);
			const next =
				width >= 180
					? {
							left: gutter - width - 24,
							top: scrollBounds.top - paneBounds.top + 20,
							width,
							maxHeight: Math.max(0, scrollBounds.height - 40),
						}
					: null;
			setPlacement((current) =>
				current?.left === next?.left &&
				current?.top === next?.top &&
				current?.width === next?.width &&
				current?.maxHeight === next?.maxHeight
					? current
					: next,
			);
		};
		const readHeadings = () => {
			headingElements = [...answer.querySelectorAll<HTMLElement>(markdownHeadingSelector)];
			const next = headingElements
				.map((heading) => ({
					id: heading.dataset.markdownHeadingId ?? "",
					level: Number(heading.dataset.markdownHeadingLevel),
					text: heading.dataset.markdownHeadingText?.trim() ?? "",
				}))
				.filter(
					(heading) =>
						heading.id &&
						heading.text &&
						Number.isInteger(heading.level) &&
						heading.level >= 1 &&
						heading.level <= 6,
				);
			setHeadings((current) =>
				current.length === next.length &&
				current.every(
					(heading, index) =>
						heading.id === next[index].id &&
						heading.level === next[index].level &&
						heading.text === next[index].text,
				)
					? current
					: next,
			);
			measure();
			updateActiveHeading();
		};
		const schedule = () => {
			if (frame) return;
			frame = window.requestAnimationFrame(() => {
				frame = 0;
				readHeadings();
			});
		};
		const mutations = new MutationObserver(schedule);
		mutations.observe(answer, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
			attributeFilter: [
				"hidden",
				"data-markdown-heading-id",
				"data-markdown-heading-level",
				"data-markdown-heading-text",
			],
		});
		const resize = new ResizeObserver(schedule);
		resize.observe(pane);
		resize.observe(container);
		resize.observe(answer);
		container.addEventListener("scroll", schedule, { passive: true });
		readHeadings();
		return () => {
			mutations.disconnect();
			resize.disconnect();
			container.removeEventListener("scroll", schedule);
			window.cancelAnimationFrame(frame);
			window.cancelAnimationFrame(navigationFrame.current);
		};
	}, [turnId, scrollContainerRef]);

	useEffect(() => {
		const list = listRef.current;
		const active = [...(list?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
			(button) => button.dataset.headingId === activeId,
		);
		if (!list || !active) return;
		const listBounds = list.getBoundingClientRect();
		const bounds = active.getBoundingClientRect();
		if (bounds.top < listBounds.top) list.scrollTop += bounds.top - listBounds.top;
		else if (bounds.bottom > listBounds.bottom) list.scrollTop += bounds.bottom - listBounds.bottom;
	}, [activeId, placement]);

	const navigate = (id: string) => {
		const container = scrollContainerRef.current;
		const heading = document.getElementById(id);
		if (!container || !heading || !container.contains(heading)) return;
		heading.dispatchEvent(
			new CustomEvent(revealMarkdownHeadingEvent, {
				bubbles: true,
				detail: { headingId: id },
			}),
		);
		window.cancelAnimationFrame(navigationFrame.current);
		navigationFrame.current = window.requestAnimationFrame(() => {
			if (!heading.isConnected) return;
			const top =
				container.scrollTop +
				heading.getBoundingClientRect().top -
				container.getBoundingClientRect().top -
				32;
			const prefersReducedMotion =
				reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			container.scrollTo({ top, behavior: prefersReducedMotion ? "auto" : "smooth" });
			setActiveId(id);
		});
	};

	if (!placement || headings.length === 0) return null;
	const minimumLevel = Math.min(...headings.map((heading) => heading.level));
	return (
		<nav
			className="answer-outline"
			aria-label="Answer contents"
			data-outline-turn-id={turnId}
			style={placement}
		>
			<div className="answer-outline-title">
				<ListTree size={14} aria-hidden="true" />
				<span>In this answer</span>
			</div>
			<ol ref={listRef} className="answer-outline-list">
				{headings.map((heading) => (
					<li key={heading.id}>
						<button
							type="button"
							data-heading-id={heading.id}
							aria-current={heading.id === activeId ? "location" : undefined}
							title={heading.text}
							style={{ paddingInlineStart: 12 + (heading.level - minimumLevel) * 12 }}
							onClick={() => navigate(heading.id)}
						>
							{heading.text}
						</button>
					</li>
				))}
			</ol>
		</nav>
	);
}
