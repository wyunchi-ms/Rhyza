import {
	Check,
	ChevronDown,
	Eye,
	EyeOff,
	Globe,
	Layers,
	LockKeyhole,
	Pencil,
	Search,
	Settings2,
	ShieldCheck,
	Sparkles,
	TriangleAlert,
	Zap,
	type LucideIcon,
} from "lucide-react";
import {
	Children,
	isValidElement,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
	type SelectHTMLAttributes,
	type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import "./overlays.css";

type Option = { value: string; label: string; disabled: boolean };
type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean };
const icons: Record<string, LucideIcon> = {
	blocked: LockKeyhole,
	read: Eye,
	read_only: Eye,
	write: Pencil,
	deferred: Search,
	direct: Zap,
	hidden: EyeOff,
	user: Settings2,
	project: Layers,
	confirmed: ShieldCheck,
	inferred: Sparkles,
	disputed: TriangleAlert,
	automatic: Zap,
	suggest: Pencil,
	hybrid: Layers,
	off: EyeOff,
	en: Globe,
	"zh-CN": Globe,
	"zh-TW": Globe,
};

function optionText(children: ReactNode): string {
	return Children.toArray(children)
		.map((child) =>
			isValidElement<OptionProps>(child) ? optionText(child.props.children) : String(child),
		)
		.join("");
}

function readOptions(children: ReactNode): Option[] {
	return Children.toArray(children).flatMap((child): Option[] => {
		if (!isValidElement<OptionProps>(child)) return [];
		if (child.type !== "option") return readOptions(child.props.children);
		const label = optionText(child.props.children);
		return [
			{ value: String(child.props.value ?? label), label, disabled: Boolean(child.props.disabled) },
		];
	});
}

export function Select({
	children,
	className = "",
	style,
	id,
	value,
	defaultValue,
	disabled,
	onChange,
	...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size">) {
	const native = useRef<HTMLSelectElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const popup = useRef<HTMLDivElement>(null);
	const listId = useId();
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
	const [position, setPosition] = useState<CSSProperties>({});
	const typeahead = useRef({ text: "", time: 0 });
	const options = readOptions(children);
	const selectedValue = String(value ?? uncontrolledValue ?? options[0]?.value ?? "");
	const selected = options.find((option) => option.value === selectedValue);
	const Icon = icons[selectedValue] ?? Settings2;

	const close = (restoreFocus = true) => {
		setOpen(false);
		if (restoreFocus) trigger.current?.focus({ preventScroll: true });
	};
	const choose = (option: Option) => {
		if (option.disabled || !native.current || trigger.current?.matches(":disabled")) return;
		native.current.value = option.value;
		native.current.dispatchEvent(new Event("change", { bubbles: true }));
		close();
	};
	const show = () => {
		if (trigger.current?.matches(":disabled")) return;
		trigger.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
		const index = options.findIndex((option) => option.value === selectedValue && !option.disabled);
		setActive(
			index >= 0
				? index
				: Math.max(
						0,
						options.findIndex((option) => !option.disabled),
					),
		);
		setOpen(true);
	};
	useLayoutEffect(() => {
		if (!open) return;
		const update = () => {
			const rect = trigger.current!.getBoundingClientRect();
			const anchorTop = Math.max(8, Math.min(rect.top, window.innerHeight - 8));
			const anchorBottom = Math.max(8, Math.min(rect.bottom, window.innerHeight - 8));
			const availableBelow = window.innerHeight - anchorBottom - 8;
			const availableAbove = anchorTop - 8;
			const above = availableBelow < 180 && availableAbove > availableBelow;
			const maxHeight = Math.max(40, Math.min(320, above ? availableAbove : availableBelow));
			const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 16);
			setPosition({
				position: "fixed",
				inset: "auto",
				width,
				maxHeight,
				left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
				...(above ? { bottom: window.innerHeight - anchorTop + 5 } : { top: anchorBottom + 5 }),
			});
		};
		update();
		popup.current?.showPopover();
		popup.current?.focus({ preventScroll: true });
		const outside = (event: PointerEvent) => {
			if (
				!popup.current?.contains(event.target as Node) &&
				!trigger.current?.contains(event.target as Node)
			)
				setOpen(false);
		};
		const blur = () => setOpen(false);
		window.addEventListener("pointerdown", outside);
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		window.addEventListener("blur", blur);
		return () => {
			window.removeEventListener("pointerdown", outside);
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
			window.removeEventListener("blur", blur);
		};
	}, [open]);
	useEffect(() => {
		if (open)
			popup.current
				?.querySelector<HTMLElement>(`[data-index="${active}"]`)
				?.scrollIntoView({ block: "nearest" });
	}, [open, active]);
	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);

	return (
		<span className="ui-select" style={style}>
			<button
				ref={trigger}
				id={id ?? `${listId}-trigger`}
				type="button"
				disabled={disabled}
				className={`ui-select-trigger ${className}`}
				aria-label={props["aria-label"]}
				aria-labelledby={props["aria-labelledby"]}
				aria-describedby={props["aria-describedby"]}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				data-value={selectedValue}
				onClick={() => (open ? close() : show())}
				onKeyDown={(event) => {
					if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
						event.preventDefault();
						show();
					}
				}}
			>
				<Icon size={15} aria-hidden="true" />
				<span>{selected?.label ?? ""}</span>
				<ChevronDown size={15} className="ui-select-chevron" aria-hidden="true" />
			</button>
			<select
				{...props}
				ref={native}
				id={id ? `${id}-native` : undefined}
				className="ui-select-native"
				aria-hidden="true"
				tabIndex={-1}
				disabled={disabled}
				value={value}
				defaultValue={defaultValue}
				onChange={(event) => {
					setUncontrolledValue(event.target.value);
					onChange?.(event);
				}}
				onInvalid={() => trigger.current?.focus()}
			>
				{children}
			</select>
			{open &&
				createPortal(
					<div
						ref={popup}
						id={listId}
						className="ui-select-popup"
						popover="manual"
						style={position}
						role="listbox"
						tabIndex={-1}
						aria-labelledby={id ?? `${listId}-trigger`}
						aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								close();
								return;
							}
							if (event.key === "Tab") {
								close();
								return;
							}
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								if (options[active]) choose(options[active]);
								return;
							}
							const enabled = options
								.map((option, index) => (option.disabled ? -1 : index))
								.filter((index) => index >= 0);
							if (!enabled.length) return;
							const current = enabled.indexOf(active);
							let next: number | undefined;
							if (event.key === "ArrowDown") next = enabled[(current + 1) % enabled.length];
							if (event.key === "ArrowUp")
								next = enabled[(current - 1 + enabled.length) % enabled.length];
							if (event.key === "Home") next = enabled[0];
							if (event.key === "End") next = enabled[enabled.length - 1];
							if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
								const now = Date.now();
								const text =
									(now - typeahead.current.time < 700 ? typeahead.current.text : "") +
									event.key.toLocaleLowerCase();
								typeahead.current = { text, time: now };
								const ordered = [
									...enabled.filter((index) => index > active),
									...enabled.filter((index) => index <= active),
								];
								next = ordered.find((index) =>
									options[index].label.toLocaleLowerCase().startsWith(text),
								);
							}
							if (next !== undefined) {
								event.preventDefault();
								setActive(next);
							}
						}}
					>
						{options.map((option, index) => {
							const OptionIcon = icons[option.value] ?? Settings2;
							return (
								<div
									key={`${option.value}-${index}`}
									id={`${listId}-${index}`}
									data-index={index}
									role="option"
									aria-selected={option.value === selectedValue}
									aria-disabled={option.disabled}
									className={`ui-select-option${active === index ? " is-active" : ""}`}
									data-value={option.value}
									onPointerMove={() => !option.disabled && setActive(index)}
									onClick={() => choose(option)}
								>
									<OptionIcon size={16} aria-hidden="true" />
									<span>{option.label}</span>
									{option.value === selectedValue && <Check size={15} aria-hidden="true" />}
								</div>
							);
						})}
					</div>,
					trigger.current?.closest("dialog") ?? document.body,
				)}
		</span>
	);
}
