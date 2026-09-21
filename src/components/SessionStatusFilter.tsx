import clsx from "clsx";
import { Check, ListFilter } from "lucide-react";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LeafStatusFilter } from "../utils/conversationFilter";
import { floatingPosition } from "../utils/floatingPosition";
import { progressOptions } from "./ProgressMarker";

export function SessionStatusFilter({
	statuses,
	onChange,
}: {
	statuses: readonly LeafStatusFilter[];
	onChange: (statuses: LeafStatusFilter[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const menuId = useId();
	const [position, setPosition] = useState({ left: 0, top: 0 });
	const close = useCallback(() => setOpen(false), []);
	useLayoutEffect(() => {
		if (!open) return;
		const menu = menuRef.current;
		const trigger = triggerRef.current;
		if (!menu || !trigger) return;
		const anchor = trigger.getBoundingClientRect();
		setPosition(
			floatingPosition(
				{ x: anchor.right - menu.offsetWidth, y: anchor.bottom + 6 },
				menu.getBoundingClientRect(),
				{ width: window.innerWidth, height: window.innerHeight },
			),
		);
		menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
		const outside = (event: Event) => {
			if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) close();
		};
		window.addEventListener("pointerdown", outside);
		window.addEventListener("scroll", outside, true);
		window.addEventListener("resize", close);
		window.addEventListener("blur", close);
		return () => {
			window.removeEventListener("pointerdown", outside);
			window.removeEventListener("scroll", outside, true);
			window.removeEventListener("resize", close);
			window.removeEventListener("blur", close);
			if (menu.contains(document.activeElement) || document.activeElement === document.body) {
				trigger.focus({ preventScroll: true });
			}
		};
	}, [open, close]);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				className={clsx(
					"sidebar-icon-button session-filter-trigger",
					statuses.length > 0 && "is-active",
				)}
				aria-label="Filter by leaf status"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				title={
					statuses.length
						? `Leaf status filter: ${statuses.length} selected`
						: "Filter by leaf status"
				}
				onClick={() => setOpen((value) => !value)}
			>
				<ListFilter size={16} />
				{statuses.length > 0 && <span className="session-filter-count">{statuses.length}</span>}
			</button>
			{open &&
				createPortal(
					<div
						ref={menuRef}
						id={menuId}
						role="menu"
						aria-label="Filter by leaf status"
						className="session-status-menu session-filter-menu"
						style={position}
						onKeyDown={(event) => {
							if (event.key === "Escape" || event.key === "Tab") {
								event.preventDefault();
								event.stopPropagation();
								close();
								return;
							}
							const buttons = [
								...event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
							];
							const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
							const next =
								event.key === "ArrowDown"
									? (index + 1) % buttons.length
									: event.key === "ArrowUp"
										? (index + buttons.length - 1) % buttons.length
										: event.key === "Home"
											? 0
											: event.key === "End"
												? buttons.length - 1
												: undefined;
							if (next !== undefined) {
								event.preventDefault();
								buttons[next]?.focus();
							}
						}}
					>
						<div className="session-status-menu-title">Leaf status</div>
						<p className="session-filter-hint">Show matching leaves and their paths.</p>
						<button
							type="button"
							role="menuitemcheckbox"
							aria-checked={statuses.length === 0}
							className="session-status-option"
							onClick={() => onChange([])}
						>
							<ListFilter size={16} className="session-status-option-icon" />
							<span className="session-filter-label">All statuses</span>
							{statuses.length === 0 && <Check size={14} />}
						</button>
						<div role="separator" className="session-menu-divider" />
						{progressOptions.map((option) => {
							const value = option.value ?? "unmarked";
							const checked = statuses.includes(value);
							const Icon = option.icon;
							return (
								<button
									key={value}
									type="button"
									role="menuitemcheckbox"
									aria-checked={checked}
									className={clsx(
										"session-status-option",
										option.value && `status-${option.value}`,
									)}
									onClick={() =>
										onChange(
											checked
												? statuses.filter((status) => status !== value)
												: [...statuses, value],
										)
									}
								>
									<Icon size={16} className="session-status-option-icon" />
									<span className="session-filter-label">{option.label}</span>
									{checked && <Check size={14} />}
								</button>
							);
						})}
					</div>,
					document.body,
				)}
		</>
	);
}
