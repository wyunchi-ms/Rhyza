import clsx from "clsx";
import { Check, Copy, GitFork, Trash2 } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store";
import { useConversationFocus } from "../store/conversationFocus";
import { isSessionRunning } from "../utils/sessionRuntime";
import type { SessionProgressStatus } from "../types";
import { floatingPosition } from "../utils/floatingPosition";
import { progressOptions } from "./ProgressMarker";

export function useSessionContextMenu() {
	const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
	const closeMenu = useCallback(() => setMenu(null), []);
	const openMenu = useCallback((event: MouseEvent, nodeId: string) => {
		event.preventDefault();
		event.stopPropagation();
		const rect = event.currentTarget.getBoundingClientRect();
		const keyboard = event.clientX === 0 && event.clientY === 0;
		setMenu({ x: keyboard ? rect.left : event.clientX, y: keyboard ? rect.bottom : event.clientY, nodeId });
	}, []);
	return { menu, openMenu, closeMenu };
}

export function SessionNodeContextMenu({ anchor, nodeId, turnId, onClose }: {
	anchor: { x: number; y: number };
	nodeId: string;
	turnId?: string;
	onClose: () => void;
}) {
	const session = useAppStore((state) => state.sessions.find((item) => item.id === nodeId));
	const running = useAppStore((state) => isSessionRunning(state.turns,
		(turnId && state.turns.find((turn) => turn.id === turnId)?.sessionId) || nodeId));
	const navigate = useNavigate();
	if (!session) return null;
	const create = (action: "forkNode" | "cloneNode") => {
		const state = useAppStore.getState();
		const targetSessionId = (turnId && state.turns.find((turn) => turn.id === turnId)?.sessionId) || nodeId;
		const id = state[action](targetSessionId, turnId);
		if (!id) return;
		window.sessionStorage.removeItem("rhyza-focus-turn");
		useConversationFocus.getState().setFocus(id, null);
		navigate("/");
	};
	const remove = () => {
		const state = useAppStore.getState();
		const hasChildren = state.sessions.some((item) => item.parentId === nodeId);
		if (window.confirm(`Delete session “${session.title}” and all its messages${hasChildren ? " and branches" : ""}?`)) state.deleteSession(nodeId);
	};
	return <SessionContextMenu anchor={anchor} status={session.progressStatus}
		onSelect={(status) => useAppStore.getState().setSessionProgressStatus(nodeId, status)}
		onFork={() => create("forkNode")} onClone={() => create("cloneNode")} onDelete={remove}
		copyDisabled={running} onClose={onClose} />;
}

export function SessionContextMenu({ anchor, status, onSelect, onFork, onClone, onDelete, copyDisabled, onClose }: {
	anchor: { x: number; y: number };
	status?: SessionProgressStatus;
	onSelect: (status?: SessionProgressStatus) => void;
	onFork: () => void;
	onClone: () => void;
	onDelete: () => void;
	copyDisabled: boolean;
	onClose: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });
	useLayoutEffect(() => {
		const element = ref.current!;
		const measure = () => setPosition(floatingPosition(anchor, element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		const previous = document.activeElement as HTMLElement | null;
		element.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
		const outside = (event: Event) => { if (!element.contains(event.target as Node)) onClose(); };
		window.addEventListener("pointerdown", outside);
		window.addEventListener("scroll", outside, true);
		window.addEventListener("resize", onClose);
		window.addEventListener("blur", onClose);
		return () => {
			observer.disconnect();
			window.removeEventListener("pointerdown", outside);
			window.removeEventListener("scroll", outside, true);
			window.removeEventListener("resize", onClose);
			window.removeEventListener("blur", onClose);
			if (element.contains(document.activeElement) || document.activeElement === document.body) previous?.focus({ preventScroll: true });
		};
	}, [anchor, onClose]);
	return createPortal(<div ref={ref} role="menu" aria-label="Node menu" className="session-status-menu" style={position}
		onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
		onKeyDown={(event) => {
			if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
			const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
			const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
			const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index + buttons.length - 1) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : undefined;
			if (next !== undefined) { event.preventDefault(); event.stopPropagation(); buttons[next]?.focus(); }
		}}>
		<div role="group" aria-label="Node status">
		<div className="session-status-menu-title">Node status</div>
		{progressOptions.map((option) => {
			const Icon = option.icon;
			return <button key={option.value ?? "unmarked"} type="button" role="menuitemradio" aria-checked={status === option.value}
				className={clsx("session-status-option", option.value && `status-${option.value}`)} onClick={() => { onSelect(option.value); onClose(); }}>
				<Icon size={16} className="session-status-option-icon" />
				<span className="min-w-0 flex-1"><span className="block font-semibold text-primary">{option.label}</span><span className="block text-[11px] text-secondary">{option.description}</span></span>
				{status === option.value && <Check size={14} className="text-accent" />}
			</button>;
		})}
		</div>
		<div role="separator" className="session-menu-divider" />
		<div role="group" aria-label="Node actions">
			<div className="session-status-menu-title">Node actions</div>
			{[
				{ label: "Fork", description: "Branch from here", icon: GitFork, action: onFork },
				{ label: "Clone", description: "Copy to an independent chat", icon: Copy, action: onClone },
				{ label: "Delete", description: "Delete session and its branches…", icon: Trash2, action: onDelete },
			].map(({ label, description, icon: Icon, action }) => <button key={label} type="button" role="menuitem"
				className={clsx("session-status-option", label === "Delete" && "session-menu-delete")}
				disabled={label !== "Delete" && copyDisabled} title={label !== "Delete" && copyDisabled ? "Available when this session finishes running" : undefined}
				onClick={() => { onClose(); action(); }}>
				<Icon size={16} className="session-status-option-icon" />
				<span><span className="block font-semibold">{label}</span><span className="block text-[11px] text-secondary">{description}</span></span>
			</button>)}
		</div>
	</div>, document.body);
}
