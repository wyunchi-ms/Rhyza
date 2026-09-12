import { Info, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function IconSwitch({ checked, onChange, icon: Icon, label, description }: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	icon: LucideIcon;
	label: string;
	description: string;
}) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const tooltipId = useId();
	useEffect(() => {
		if (!open) return;
		const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
		const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
		window.addEventListener("pointerdown", close);
		window.addEventListener("keydown", escape);
		return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
	}, [open]);
	return <div className="icon-switch-group" ref={root}>
		<button type="button" role="switch" aria-checked={checked} aria-label={label} title={label}
			className="icon-switch" onClick={() => onChange(!checked)}>
			<Icon size={16} aria-hidden="true" />
			<span className="icon-switch-track" aria-hidden="true"><span /></span>
		</button>
		<div className="icon-switch-help" data-open={open || undefined}>
			<button type="button" className="icon-switch-info" aria-label={`About ${label}`} aria-expanded={open}
				aria-describedby={tooltipId} onClick={() => setOpen((value) => !value)}><Info size={14} /></button>
			<div id={tooltipId} role="tooltip" className="icon-switch-tooltip"><strong>{label}</strong><span>{description}</span></div>
		</div>
	</div>;
}
