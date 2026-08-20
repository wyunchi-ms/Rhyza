import { useState } from "react";
import { MessageCircle, Sparkles } from "lucide-react";

export interface TextSelectionAnchor {
	turnId: string;
	text: string;
	x: number;
	y: number;
}

export function SelectionAskPopover({ selection, onAsk, onClose }: {
	selection: TextSelectionAnchor;
	onAsk: (question: string) => void;
	onClose: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [question, setQuestion] = useState("");
	if (!expanded) {
		return <div className="text-selection-menu" role="menu" aria-label="Actions for selected text" style={{ left: selection.x, top: selection.y }} onMouseDown={(event) => event.preventDefault()}><div className="text-selection-menu-title">Selected text</div><button type="button" role="menuitem" onClick={() => setExpanded(true)}><MessageCircle size={16} /><span><strong>Ask about this</strong><small>Write a follow-up question</small></span></button><button type="button" role="menuitem" onClick={() => onAsk("explain")}><Sparkles size={16} /><span><strong>Explain</strong><small>Explain the selection directly</small></span></button></div>;
	}
	return (
		<form className="text-selection-popover" style={{ left: selection.x, top: selection.y }} onSubmit={(event) => { event.preventDefault(); if (question.trim()) onAsk(question.trim()); }}>
			<div className="text-selection-label">Ask about the selected passage</div>
			<textarea autoFocus rows={2} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a follow-up question…" />
			<div className="text-selection-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!question.trim()}>Ask</button></div>
		</form>
	);
}
