import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface PanelResizeHandleProps {
	side: "left" | "right";
	label: string;
	value: number;
	min: number;
	max: number;
	defaultValue: number;
	onChange: (value: number) => void;
	onCommit: (value: number) => void;
}

export function PanelResizeHandle({ side, label, value, min, max, defaultValue, onChange, onCommit }: PanelResizeHandleProps) {
	const dragRef = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null);
	const latestValueRef = useRef(value);
	const resizeFrameRef = useRef<number | null>(null);
	useEffect(() => { latestValueRef.current = value; }, [value]);
	useEffect(() => () => {
		document.body.classList.remove("is-resizing-panel");
		if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
	}, []);

	const resize = (nextValue: number) => {
		const clamped = Math.round(Math.min(max, Math.max(min, nextValue)));
		latestValueRef.current = clamped;
		if (resizeFrameRef.current !== null) return;
		resizeFrameRef.current = window.requestAnimationFrame(() => {
			resizeFrameRef.current = null;
			onChange(latestValueRef.current);
		});
	};
	const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
		if (dragRef.current?.pointerId !== event.pointerId) return;
		dragRef.current = null;
		if (resizeFrameRef.current !== null) {
			window.cancelAnimationFrame(resizeFrameRef.current);
			resizeFrameRef.current = null;
		}
		onChange(latestValueRef.current);
		document.body.classList.remove("is-resizing-panel");
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		onCommit(latestValueRef.current);
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const separatorDirection = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
		if (!separatorDirection) return;
		event.preventDefault();
		const widthDirection = side === "left" ? separatorDirection : -separatorDirection;
		const nextValue = value + widthDirection * (event.shiftKey ? 32 : 8);
		resize(nextValue);
		if (resizeFrameRef.current !== null) {
			window.cancelAnimationFrame(resizeFrameRef.current);
			resizeFrameRef.current = null;
		}
		onChange(latestValueRef.current);
		onCommit(latestValueRef.current);
	};

	return (
		<div
			className="panel-resize-handle"
			role="separator"
			aria-label={label}
			aria-orientation="vertical"
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={value}
			tabIndex={0}
			onDoubleClick={() => { resize(defaultValue); onCommit(defaultValue); }}
			onKeyDown={handleKeyDown}
			onPointerDown={(event) => {
				dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value };
				event.currentTarget.setPointerCapture(event.pointerId);
				document.body.classList.add("is-resizing-panel");
			}}
			onPointerMove={(event) => {
				const drag = dragRef.current;
				if (!drag || drag.pointerId !== event.pointerId) return;
				const delta = event.clientX - drag.startX;
				resize(drag.startValue + (side === "left" ? delta : -delta));
			}}
			onPointerUp={finishDrag}
			onPointerCancel={finishDrag}
		>
			<span />
		</div>
	);
}

export function usePanelSize(storageKey: string, defaultValue: number, min: number, max: number) {
	const [value, setValue] = useState(() => {
		const saved = Number(window.localStorage.getItem(storageKey));
		return Number.isFinite(saved) && saved > 0 ? Math.min(max, Math.max(min, saved)) : defaultValue;
	});
	const commit = useCallback((nextValue: number) => {
		window.localStorage.setItem(storageKey, String(Math.round(nextValue)));
	}, [storageKey]);
	return { value, setValue, commit };
}

export function useViewportWidth(): number {
	const [width, setWidth] = useState(() => window.innerWidth);
	useEffect(() => {
		const update = () => setWidth(window.innerWidth);
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, []);
	return width;
}
