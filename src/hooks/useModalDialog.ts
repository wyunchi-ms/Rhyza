import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import "../components/overlays.css";

export function useModalDialog(
	open: boolean,
	onClose: () => void,
	initialFocus?: RefObject<HTMLElement | null>,
) {
	const ref = useRef<HTMLDialogElement>(null);
	const closeRef = useRef(onClose);
	useLayoutEffect(() => {
		closeRef.current = onClose;
	}, [onClose]);
	useEffect(() => {
		if (!open) return;
		const dialog = ref.current;
		if (!dialog) return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const cancel = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
			closeRef.current();
		};
		const escape = (event: KeyboardEvent) => {
			if (
				event.key !== "Escape" ||
				event.defaultPrevented ||
				document.activeElement?.closest("dialog") !== dialog
			)
				return;
			event.preventDefault();
			event.stopImmediatePropagation();
			closeRef.current();
		};
		const backdrop = (event: PointerEvent) => {
			if (event.target !== dialog) return;
			const bounds = dialog.getBoundingClientRect();
			if (
				event.clientX < bounds.left ||
				event.clientX > bounds.right ||
				event.clientY < bounds.top ||
				event.clientY > bounds.bottom
			) {
				closeRef.current();
			}
		};
		dialog.addEventListener("cancel", cancel);
		dialog.addEventListener("pointerdown", backdrop);
		window.addEventListener("keydown", escape);
		if (!dialog.open) dialog.showModal();
		(
			initialFocus?.current ?? dialog.querySelector<HTMLElement>("button, input, [tabindex='0']")
		)?.focus({ preventScroll: true });
		return () => {
			dialog.removeEventListener("cancel", cancel);
			dialog.removeEventListener("pointerdown", backdrop);
			window.removeEventListener("keydown", escape);
			dialog.close();
			if (previous?.isConnected) previous.focus({ preventScroll: true });
		};
	}, [open, initialFocus]);
	return ref;
}
