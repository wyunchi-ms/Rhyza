import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRhyzaBridge } from "../hooks/useRhyzaBridge";
import { useTranslation } from "../i18n";
import type { SourceInfo } from "../shared/ipc";
import { errorToMessage } from "../shared/value";

export function SourceRemovalDialog({
	source,
	onRemoved,
	onClose,
}: {
	source: SourceInfo;
	onRemoved: (id: string) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const removingRef = useRef(false);
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const previousFocus =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const dialog = dialogRef.current;
		dialog?.showModal();
		return () => {
			dialog?.close();
			previousFocus?.focus();
		};
	}, []);

	const close = () => {
		if (!removingRef.current) onClose();
	};

	const remove = async () => {
		if (removingRef.current) return;
		const bridge = getRhyzaBridge();
		if (!bridge) {
			setError(t("The desktop app is required to remove sources."));
			return;
		}
		removingRef.current = true;
		setRemoving(true);
		setError(null);
		try {
			await bridge.sourceRemove({ id: source.id });
			onRemoved(source.id);
			onClose();
		} catch (reason) {
			setError(errorToMessage(reason));
		} finally {
			removingRef.current = false;
			setRemoving(false);
		}
	};

	return (
		<dialog
			ref={dialogRef}
			className="source-removal-dialog"
			aria-labelledby="source-removal-title"
			aria-describedby="source-removal-description"
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
		>
			<header className="source-removal-header">
				<h2 id="source-removal-title">{t("Delete source?")}</h2>
				<button
					type="button"
					className="icon-button"
					aria-label={t("Close")}
					disabled={removing}
					onClick={close}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</header>
			<div className="source-removal-body" aria-busy={removing}>
				<div className="source-removal-target">
					<strong>{source.name}</strong>
					<span>{source.path}</span>
				</div>
				<p id="source-removal-description">
					{t(
						"This only removes the source from this workspace. Files on disk will not be deleted.",
					)}
				</p>
				<p>{t("Existing chats and knowledge are kept.")}</p>
				{error && (
					<p className="source-removal-error" role="alert">
						{error}
					</p>
				)}
			</div>
			<footer className="source-removal-footer">
				<button type="button" className="secondary-button" disabled={removing} onClick={close}>
					{t("Cancel")}
				</button>
				<button
					type="button"
					className="command-button"
					disabled={removing}
					onClick={() => void remove()}
				>
					{removing ? t("Removing…") : t("Delete source")}
				</button>
			</footer>
		</dialog>
	);
}
