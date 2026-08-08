import clsx from "clsx";
import { ListTree } from "lucide-react";
import { useEffect, useMemo, useState, type RefObject } from "react";
import type { Turn } from "../types";

export function TurnNavigator({ turns, scrollContainerRef }: { turns: Turn[]; scrollContainerRef: RefObject<HTMLDivElement | null> }) {
	const userTurns = useMemo(() => turns.filter((turn) => turn.role === "user"), [turns]);
	const [expanded, setExpanded] = useState(false);
	const [activeId, setActiveId] = useState(userTurns[userTurns.length - 1]?.id ?? "");

	useEffect(() => {
		if (!userTurns.some((turn) => turn.id === activeId)) {
			setActiveId(userTurns[userTurns.length - 1]?.id ?? "");
		}
	}, [activeId, userTurns]);

	useEffect(() => {
		const container = scrollContainerRef.current;
		if (!container || userTurns.length === 0) return;
		let animationFrame = 0;
		const updateActiveTurn = () => {
			animationFrame = 0;
			if (container.scrollTop + container.clientHeight >= container.scrollHeight - 8) {
				setActiveId(userTurns[userTurns.length - 1].id);
				return;
			}
			const containerRect = container.getBoundingClientRect();
			const readingLine = containerRect.top + Math.min(containerRect.height * 0.28, 180);
			let selectedId = userTurns[0].id;
			let nearestTop = Number.NEGATIVE_INFINITY;
			for (const turn of userTurns) {
				const element = document.getElementById(`turn-${turn.id}`);
				if (!element) continue;
				const top = element.getBoundingClientRect().top;
				if (top <= readingLine && top > nearestTop) {
					nearestTop = top;
					selectedId = turn.id;
				}
			}
			setActiveId(selectedId);
		};
		const scheduleUpdate = () => {
			if (!animationFrame) animationFrame = window.requestAnimationFrame(updateActiveTurn);
		};
		const resizeObserver = new ResizeObserver(scheduleUpdate);
		resizeObserver.observe(container);
		for (const turn of userTurns) {
			const element = document.getElementById(`turn-${turn.id}`);
			if (element) resizeObserver.observe(element);
		}
		container.addEventListener("scroll", scheduleUpdate, { passive: true });
		window.addEventListener("resize", scheduleUpdate);
		scheduleUpdate();
		return () => {
			container.removeEventListener("scroll", scheduleUpdate);
			window.removeEventListener("resize", scheduleUpdate);
			resizeObserver.disconnect();
			if (animationFrame) window.cancelAnimationFrame(animationFrame);
		};
	}, [scrollContainerRef, userTurns]);

	const navigate = (turn: Turn) => {
		setActiveId(turn.id);
		const container = scrollContainerRef.current;
		const element = document.getElementById(`turn-${turn.id}`);
		if (container && element) {
			const containerRect = container.getBoundingClientRect();
			const elementRect = element.getBoundingClientRect();
			container.scrollTo({
				top: container.scrollTop + elementRect.top - containerRect.top - container.clientHeight * 0.2,
				behavior: "smooth",
			});
		}
		element?.classList.add("turn-target");
		window.setTimeout(() => element?.classList.remove("turn-target"), 700);
	};

	if (userTurns.length <= 1) return null;

	return (
		<div
			className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex items-center"
			onMouseEnter={() => setExpanded(true)}
			onMouseLeave={() => setExpanded(false)}
		>
			{expanded && (
				<div className="mr-2 w-56 max-h-[60vh] overflow-y-auto border border-gray-200 bg-white shadow-xl p-2 rounded-lg">
					<div className="flex items-center gap-2 px-2 py-1 text-xs font-bold text-gray-500 uppercase">
						<ListTree size={14} /> Turns
					</div>
					{userTurns.map((turn, index) => (
						<button
							type="button"
							key={turn.id}
							onClick={() => navigate(turn)}
							aria-current={activeId === turn.id ? "step" : undefined}
							className={clsx(
								"w-full text-left px-2 py-2 text-xs rounded-md flex gap-2",
								activeId === turn.id ? "bg-accent/10 text-accent" : "hover:bg-gray-50 text-secondary",
							)}
						>
							<span className="font-bold tabular-nums">{index + 1}</span>
							<span className="truncate">{turn.summary || turn.content}</span>
						</button>
					))}
				</div>
			)}
			<button
				type="button"
				onClick={() => setExpanded((value) => !value)}
				aria-label="Open turn navigator"
				className="w-4 py-2 flex flex-col items-center gap-1 focus:outline-none"
			>
				{userTurns.map((turn) => (
					<span
						key={turn.id}
						className={clsx("block h-0.5 rounded bg-gray-400 transition-all", activeId === turn.id ? "w-4 bg-accent" : "w-2")}
					/>
				))}
			</button>
		</div>
	);
}
