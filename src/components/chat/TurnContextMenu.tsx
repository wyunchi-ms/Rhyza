import { Activity, BarChart3, Braces, Copy, RadioTower } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RightPaneView, Turn } from "../../types";

export interface TurnContextMenuState {
	turnId: string;
	x: number;
	y: number;
}

export function TurnContextMenu({ menu, turn, onSelect, onClose }: {
	menu: TurnContextMenuState;
	turn: Turn;
	onSelect: (view: Exclude<RightPaneView, "todo">) => void;
	onClose: () => void;
}) {
	const menuRef = useRef<HTMLDivElement | null>(null);
	useLayoutEffect(() => { menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, []);
	useEffect(() => {
		const closeFromPointer = (event: PointerEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) onClose();
		};
		const closeFromKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
		window.addEventListener("pointerdown", closeFromPointer);
		window.addEventListener("keydown", closeFromKey);
		window.addEventListener("blur", onClose);
		window.addEventListener("resize", onClose);
		window.addEventListener("scroll", onClose, true);
		return () => {
			window.removeEventListener("pointerdown", closeFromPointer);
			window.removeEventListener("keydown", closeFromKey);
			window.removeEventListener("blur", onClose);
			window.removeEventListener("resize", onClose);
			window.removeEventListener("scroll", onClose, true);
		};
	}, [onClose]);
	const left = Math.max(8, Math.min(menu.x, window.innerWidth - 232));
	const top = Math.max(8, Math.min(menu.y, window.innerHeight - 270));
	return <div ref={menuRef} className="turn-context-menu" role="menu" aria-label="Message actions" style={{ left, top }}>
		<p>Inspect message</p>
		<button type="button" role="menuitem" onClick={() => onSelect("context")}><Activity size={15} /><span><strong>Context analysis</strong><small>Relevance, rot and composition</small></span></button>
		<button type="button" role="menuitem" onClick={() => onSelect("raw_context")}><Braces size={15} /><span><strong>Raw context</strong><small>Provider-neutral request context</small></span></button>
		<button type="button" role="menuitem" onClick={() => onSelect("wire")}><RadioTower size={15} /><span><strong>Wire request</strong><small>Final provider payload</small></span></button>
		<button type="button" role="menuitem" onClick={() => onSelect("usage")}><BarChart3 size={15} /><span><strong>Usage & cost</strong><small>Context growth, tokens and cost</small></span></button>
		<div className="turn-context-menu-separator" />
		<button type="button" role="menuitem" onClick={() => { void navigator.clipboard.writeText(turn.content); onClose(); }}><Copy size={15} /><span><strong>Copy message</strong></span></button>
	</div>;
}
