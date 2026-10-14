import { useId, useLayoutEffect, useRef, useState } from "react";
import { MessageCircle, Sparkles } from "lucide-react";
import { navigateMenu, useFloatingMenu } from "../../hooks/useFloatingMenu";
import { floatingPosition } from "../../utils/floatingPosition";

export interface TextSelectionAnchor {
	turnId: string;
	text: string;
	x: number;
	y: number;
}

export function SelectionAskPopover({
	selection,
	onAsk,
	onClose,
}: {
	selection: TextSelectionAnchor;
	onAsk: (question: string) => void;
	onClose: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [question, setQuestion] = useState("");
	const { ref, position } = useFloatingMenu(selection, !expanded);
	const formRef = useRef<HTMLFormElement>(null);
	const labelId = useId();
	const [formPosition, setFormPosition] = useState(position);
	useLayoutEffect(() => {
		if (!expanded || !formRef.current) return;
		const element = formRef.current;
		const measure = () =>
			setFormPosition(
				floatingPosition(selection, element.getBoundingClientRect(), {
					width: innerWidth,
					height: innerHeight,
				}),
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [expanded, selection]);
	if (!expanded) {
		return (
			<div
				ref={ref}
				className="text-selection-menu"
				role="menu"
				aria-label="所选文本操作"
				style={position}
				onKeyDown={(event) => navigateMenu(event, onClose)}
				onMouseDown={(event) => event.preventDefault()}
			>
				<div className="text-selection-menu-title">已选文本</div>
				<button type="button" role="menuitem" onClick={() => setExpanded(true)}>
					<MessageCircle size={16} />
					<span>
						<strong>围绕此处提问</strong>
						<small>输入后续问题</small>
					</span>
				</button>
				<button type="button" role="menuitem" onClick={() => onAsk("explain")}>
					<Sparkles size={16} />
					<span>
						<strong>解释</strong>
						<small>直接解释所选内容</small>
					</span>
				</button>
			</div>
		);
	}
	return (
		<form
			ref={formRef}
			className="text-selection-popover"
			style={formPosition}
			onSubmit={(event) => {
				event.preventDefault();
				if (question.trim()) onAsk(question.trim());
			}}
		>
			<label htmlFor={labelId} className="text-selection-label">
				针对所选段落提问
			</label>
			<textarea
				id={labelId}
				autoFocus
				rows={2}
				value={question}
				onChange={(event) => setQuestion(event.target.value)}
				placeholder="输入后续问题…"
			/>
			<div className="text-selection-actions">
				<button type="button" onClick={onClose}>
					取消
				</button>
				<button type="submit" disabled={!question.trim()}>
					提问
				</button>
			</div>
		</form>
	);
}
