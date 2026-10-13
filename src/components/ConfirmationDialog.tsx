import { ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "../i18n";
import "./overlays.css";

type ConfirmationOptions = {
	title: string;
	description: string;
	confirmLabel: string;
	tone?: "danger" | "warning" | "accent";
};

export function ConfirmationDialog({
	title,
	description,
	confirmLabel,
	tone = "danger",
	busy = false,
	error,
	className = "",
	onClose,
	onConfirm,
}: ConfirmationOptions & {
	busy?: boolean;
	error?: string;
	className?: string;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const { t } = useTranslation();
	const ref = useRef<HTMLDialogElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const id = useId();
	const Icon = tone === "accent" ? ShieldCheck : tone === "warning" ? TriangleAlert : Trash2;
	useEffect(() => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const dialog = ref.current;
		dialog?.showModal();
		cancelRef.current?.focus({ preventScroll: true });
		return () => {
			dialog?.close();
			if (previous?.isConnected) previous.focus({ preventScroll: true });
		};
	}, []);
	return (
		<dialog
			ref={ref}
			className={`confirmation-dialog ${className}`}
			data-tone={tone}
			aria-labelledby={`${id}-title`}
			aria-describedby={`${id}-description`}
			aria-busy={busy}
			onCancel={(event) => {
				event.preventDefault();
				if (!busy) onClose();
			}}
		>
			<header className="confirmation-header">
				<span className="confirmation-icon">
					<Icon size={21} aria-hidden="true" />
				</span>
				<h2 id={`${id}-title`}>{title}</h2>
				<button
					type="button"
					className="icon-button"
					aria-label={t("Close")}
					disabled={busy}
					onClick={onClose}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</header>
			<div className="confirmation-body">
				<p id={`${id}-description`}>{description}</p>
				{error && (
					<p className="mcp-error confirmation-error" role="alert">
						{error}
					</p>
				)}
			</div>
			<footer className="confirmation-footer">
				<button
					ref={cancelRef}
					type="button"
					className="secondary-button"
					disabled={busy}
					onClick={onClose}
				>
					{t("Cancel")}
				</button>
				<button
					type="button"
					className="command-button confirmation-submit"
					disabled={busy}
					onClick={onConfirm}
				>
					{busy ? t("Loading…") : confirmLabel}
				</button>
			</footer>
		</dialog>
	);
}

type PendingConfirmation = ConfirmationOptions & {
	id: number;
	resolve: (confirmed: boolean) => void;
};
let nextId = 0;
let pending: PendingConfirmation[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
const snapshot = () => pending[0];

export function confirmAction(options: ConfirmationOptions): Promise<boolean> {
	return new Promise((resolve) => {
		pending = [...pending, { ...options, id: ++nextId, resolve }];
		notify();
	});
}

export function ConfirmationHost() {
	const current = useSyncExternalStore(subscribe, snapshot);
	useEffect(
		() => () => {
			const abandoned = pending;
			pending = [];
			abandoned.forEach((item) => item.resolve(false));
		},
		[],
	);
	if (!current) return null;
	const finish = (confirmed: boolean) => {
		pending = pending.slice(1);
		current.resolve(confirmed);
		notify();
	};
	return (
		<ConfirmationDialog
			key={current.id}
			{...current}
			onClose={() => finish(false)}
			onConfirm={() => finish(true)}
		/>
	);
}
