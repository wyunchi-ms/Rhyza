import { AtSign, Database, ImagePlus, LoaderCircle, Network, Send, X } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentPromptImage } from "../../shared/ipc";
import type { Diagram, Entity } from "../../types";

const maxPromptImageBytes = 4_500_000;
const composerMaxHeight = 192;
const knowledgeReferencePattern = /\[@([^\]]+)\]\(#knowledge\/(entity|diagram)\/([^)]+)\)/g;
export type ComposerImage = AgentPromptImage & { id: string; preview: string };

type KnowledgeMention = { id: string; kind: "entity" | "diagram"; name: string; detail: string; raw: string };
type MentionState = { start: number; end: number; query: string; activeIndex: number };

export function ChatComposer({ input, images, entities, diagrams, isSending, error, runtimeCaption, onInputChange, onImagesChange, onError, onSend }: {
	input: string;
	images: ComposerImage[];
	entities: Entity[];
	diagrams: Diagram[];
	isSending: boolean;
	error: string | null;
	runtimeCaption: string;
	onInputChange: (value: string) => void;
	onImagesChange: (images: ComposerImage[]) => void;
	onError: (error: string | null) => void;
	onSend: () => void;
}) {
	const imageInputRef = useRef<HTMLInputElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [mention, setMention] = useState<MentionState | null>(null);
	const references = useMemo(() => parseReferences(input), [input]);
	const draft = useMemo(() => stripReferences(input), [input]);
	const knowledgeItems = useMemo<KnowledgeMention[]>(() => [
		...entities.filter((entity) => !entity.deletedAt).map((entity) => ({ id: entity.id, kind: "entity" as const, name: entity.name, detail: entity.type, raw: createReference(entity.name, "entity", entity.id) })),
		...diagrams.filter((diagram) => !diagram.deletedAt).map((diagram) => ({ id: diagram.id, kind: "diagram" as const, name: diagram.name, detail: diagram.type, raw: createReference(diagram.name, "diagram", diagram.id) })),
	], [entities, diagrams]);
	const mentionItems = useMemo(() => {
		if (!mention) return [];
		const query = mention.query.toLocaleLowerCase();
		return knowledgeItems.filter((item) => `${item.name} ${item.detail}`.toLocaleLowerCase().includes(query)).slice(0, 8);
	}, [knowledgeItems, mention]);

	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		const nextHeight = Math.min(composerMaxHeight, Math.max(42, textarea.scrollHeight));
		textarea.style.height = `${nextHeight}px`;
		textarea.style.overflowY = textarea.scrollHeight > composerMaxHeight ? "auto" : "hidden";
	}, [draft]);

	const updateMention = (value: string, caret: number) => {
		const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
		setMention(match ? { start: caret - match[2].length - 1, end: caret, query: match[2], activeIndex: 0 } : null);
	};
	const updateDraft = (value: string) => onInputChange(composeInput(value, references));
	const selectMention = (item: KnowledgeMention) => {
		if (!mention) return;
		const nextDraft = `${draft.slice(0, mention.start)}${draft.slice(mention.end)}`;
		const nextReferences = references.some((reference) => reference.raw === item.raw) ? references : [...references, item];
		onInputChange(composeInput(nextDraft, nextReferences));
		setMention(null);
		requestAnimationFrame(() => {
			const textarea = textareaRef.current;
			textarea?.focus();
			textarea?.setSelectionRange(mention.start, mention.start);
		});
	};
	const removeReference = (raw: string) => {
		onInputChange(composeInput(draft, references.filter((reference) => reference.raw !== raw)));
		requestAnimationFrame(() => textareaRef.current?.focus());
	};
	const addFiles = (files: FileList | null) => void readPromptImages(files).then((next) => {
		onError(null);
		onImagesChange([...images, ...next].slice(0, 4));
	}).catch((caught: unknown) => onError(caught instanceof Error ? caught.message : String(caught)));
	return <div className="composer-shell"><div className="composer-frame">
		{mention && <div className="composer-mention-menu" role="listbox" aria-label="Knowledge mentions">
			<div className="composer-mention-heading"><AtSign size={13} /> Reference workspace knowledge</div>
			{mentionItems.length > 0 ? mentionItems.map((item, index) => <button key={`${item.kind}-${item.id}`} type="button" role="option" aria-selected={index === mention.activeIndex} className={index === mention.activeIndex ? "is-active" : ""} onMouseDown={(event) => { event.preventDefault(); selectMention(item); }} onMouseEnter={() => setMention((current) => current ? { ...current, activeIndex: index } : current)}><span className="composer-mention-icon">{item.kind === "entity" ? <Database size={15} /> : <Network size={15} />}</span><span><strong>{item.name}</strong><small>{item.kind === "entity" ? "Entity" : "Diagram"} · {item.detail}</small></span></button>) : <div className="composer-mention-empty">No entities or diagrams match “{mention.query}”.</div>}
		</div>}
		{(references.length > 0 || images.length > 0) && <div className="composer-context-row">
			{references.map((reference) => <span key={reference.raw} className="composer-reference-chip"><span className="composer-reference-icon">{reference.kind === "entity" ? <Database size={13} /> : <Network size={13} />}</span><span>@{reference.name}</span><small>{reference.kind === "entity" ? "Entity" : "Diagram"}</small><button type="button" title={`Remove ${reference.name}`} aria-label={`Remove ${reference.name}`} onClick={() => removeReference(reference.raw)}><X size={12} /></button></span>)}
			{images.map((image) => <div key={image.id} className="composer-attachment"><img src={image.preview} alt="" /><button type="button" title="Remove image" aria-label="Remove image" onClick={() => onImagesChange(images.filter((item) => item.id !== image.id))}><X size={12} /></button></div>)}
		</div>}
		<div className="chat-composer">
			<textarea ref={textareaRef} className="composer-input" placeholder={images.length ? "Add a question about the image" : "Message Rhyza — type @ to reference knowledge"} value={draft} onChange={(event) => { updateDraft(event.target.value); updateMention(event.target.value, event.target.selectionStart); }} onClick={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart)} onBlur={() => window.setTimeout(() => setMention(null), 120)} onPaste={(event) => {
				const imageFiles = [...event.clipboardData.items].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => file !== null);
				if (imageFiles.length === 0) return;
				event.preventDefault();
				const files = new DataTransfer(); imageFiles.forEach((file) => files.items.add(file)); addFiles(files.files);
			}} onKeyDown={(event) => {
				if (mention && mentionItems.length > 0) {
					if (event.key === "Escape") { event.preventDefault(); setMention(null); return; }
					if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const delta = event.key === "ArrowDown" ? 1 : -1; setMention((current) => current ? { ...current, activeIndex: (current.activeIndex + delta + mentionItems.length) % mentionItems.length } : current); return; }
					if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); selectMention(mentionItems[mention.activeIndex]); return; }
				}
				if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); }
			}} rows={1} />
			<button type="button" title="Attach image" aria-label="Attach image" onClick={() => imageInputRef.current?.click()} disabled={isSending} className="composer-attach"><ImagePlus size={17} /></button>
			<input ref={imageInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} />
			<button type="button" title="Send" aria-label="Send" onClick={onSend} disabled={isSending || (!draft.trim() && references.length === 0 && images.length === 0)} className="composer-send">{isSending ? <LoaderCircle size={18} className="animate-spin" /> : <Send size={18} />}</button>
		</div>
	</div><div className="composer-caption">{runtimeCaption}</div>{error && <div className="text-center mt-1 text-xs text-red-600">{error}</div>}</div>;
}

function createReference(name: string, kind: KnowledgeMention["kind"], id: string): string { return `[@${name}](#knowledge/${kind}/${encodeURIComponent(id)})`; }
function parseReferences(input: string): KnowledgeMention[] {
	const references: KnowledgeMention[] = [];
	knowledgeReferencePattern.lastIndex = 0;
	for (const match of input.matchAll(knowledgeReferencePattern)) {
		try { references.push({ name: match[1], kind: match[2] as KnowledgeMention["kind"], id: decodeURIComponent(match[3]), detail: "", raw: match[0] }); }
		catch { /* Ignore malformed user-entered reference syntax. */ }
	}
	return references;
}
function stripReferences(input: string): string {
	knowledgeReferencePattern.lastIndex = 0;
	return input.replace(knowledgeReferencePattern, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trimStart();
}
function composeInput(draft: string, references: KnowledgeMention[]): string { return `${draft.replace(/\s+$/, "")}${references.length ? `${draft.trimEnd() ? "\n\n" : ""}${references.map((reference) => reference.raw).join(" ")}` : ""}`; }

async function readPromptImages(files: FileList | null): Promise<ComposerImage[]> {
	if (!files) return [];
	return Promise.all([...files].slice(0, 4).map(async (file) => {
		if (!(new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"])).has(file.type)) throw new Error(`${file.name} is not a supported image type.`);
		if (file.size > maxPromptImageBytes) throw new Error(`${file.name} exceeds the 4.5 MB image limit.`);
		const preview = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error(`Could not read ${file.name}.`)); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
		const separator = preview.indexOf(",");
		if (separator < 0) throw new Error("Invalid image data.");
		return { id: crypto.randomUUID(), preview, mimeType: file.type as AgentPromptImage["mimeType"], data: preview.slice(separator + 1) };
	}));
}
