import { Maximize2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import JsonView from "react18-json-view";
import "react18-json-view/src/style.css";
import "react18-json-view/src/dark.css";
import { useAppStore } from "../store";
import { useModalDialog } from "../hooks/useModalDialog";

export function JsonText({ value, label }: { value: unknown; label?: string }) {
	const serialized = useMemo(() => JSON.stringify(value, null, 2) ?? "undefined", [value]);
	return (
		<pre className="raw-json-text" aria-label={label ?? "JSON text"} tabIndex={0}>
			{serialized}
		</pre>
	);
}

export function JsonPreviewButton({ value, label }: { value: unknown; label: string }) {
	const [open, setOpen] = useState(false);
	const theme = useAppStore((state) => state.settings.theme);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const closeRef = useRef<HTMLButtonElement | null>(null);

	const dialogRef = useModalDialog(open, () => setOpen(false), closeRef);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				title={`Preview ${label}`}
				aria-label={`Open ${label} preview`}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					setOpen(true);
				}}
			>
				<Maximize2 size={14} />
			</button>
			{open &&
				createPortal(
					<div
						className="json-preview-backdrop"
						role="presentation"
						onMouseDown={() => setOpen(false)}
					>
						<dialog
							ref={dialogRef}
							className="ui-modal-dialog json-preview-dialog"
							aria-modal="true"
							aria-labelledby="json-preview-title"
							onMouseDown={(event) => event.stopPropagation()}
						>
							<header>
								<div>
									<span>JSON preview</span>
									<h2 id="json-preview-title">{label}</h2>
								</div>
								<button
									ref={closeRef}
									type="button"
									title="Close preview"
									aria-label="Close JSON preview"
									onClick={() => setOpen(false)}
								>
									<X size={18} />
								</button>
							</header>
							<div
								className="json-preview-tree"
								role="region"
								aria-label={`${label} JSON tree`}
								tabIndex={0}
							>
								<JsonView
									src={value}
									dark={theme === "dark"}
									theme="vscode"
									displayArrayIndex
									displaySize="collapsed"
									collapseStringsAfterLength={320}
									collapseStringMode="word"
									collapseObjectsAfterLength={100}
									enableClipboard={false}
								/>
							</div>
						</dialog>
					</div>,
					document.body,
				)}
		</>
	);
}
