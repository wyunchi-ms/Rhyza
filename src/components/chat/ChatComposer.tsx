import { AtSign, Brain, Check, ChevronDown, Database, Gauge, ImagePlus, Send, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentModelRequestSnapshot, AgentPromptImage, ModelInfo } from "../../shared/ipc";
import type { Diagram, Entity } from "../../types";
import { composeInput, stripReferences } from "../../utils/composerInput";
import { analyzeContextComposition, residentInputTokens } from "../../utils/contextRot";
import { DiagramTypeIcon } from "../DiagramTypeIcon";
import { getKnowbranchBridge, githubCopilotProviderId } from "../../hooks/useKnowbranchBridge";
import { useAppStore } from "../../store";

const maxPromptImageBytes = 4_500_000;
const composerMaxHeight = 136;
const knowledgeReferencePattern = /\[@([^\]]+)\]\(#knowledge\/(entity|diagram)\/([^)]+)\)/g;
export type ComposerImage = AgentPromptImage & { id: string; preview: string };

type KnowledgeMention = { id: string; kind: "entity" | "diagram"; name: string; detail: string; diagramType?: Diagram["type"]; raw: string };
type MentionState = { start: number; end: number; query: string; activeIndex: number };

export function ChatComposer({ input, images, entities, diagrams, contextRequest, isSending, error, runtimeCaption, onInputChange, onImagesChange, onError, onSend }: {
	input: string;
	images: ComposerImage[];
	entities: Entity[];
	diagrams: Diagram[];
	contextRequest?: AgentModelRequestSnapshot;
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
	const settings = useAppStore((state) => state.settings);
	const updateSettings = useAppStore((state) => state.updateSettings);
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [mention, setMention] = useState<MentionState | null>(null);
	const [multiline, setMultiline] = useState(false);
	const references = useMemo(() => parseReferences(input), [input]);
	const diagramTypes = useMemo(() => new Map(diagrams.map((diagram) => [diagram.id, diagram.type])), [diagrams]);
	const draft = useMemo(() => stripReferences(input), [input]);
	const knowledgeItems = useMemo<KnowledgeMention[]>(() => [
		...entities.filter((entity) => !entity.deletedAt).map((entity) => ({ id: entity.id, kind: "entity" as const, name: entity.name, detail: entity.type, raw: createReference(entity.name, "entity", entity.id) })),
		...diagrams.filter((diagram) => !diagram.deletedAt).map((diagram) => ({ id: diagram.id, kind: "diagram" as const, name: diagram.name, detail: diagram.type, diagramType: diagram.type, raw: createReference(diagram.name, "diagram", diagram.id) })),
	], [entities, diagrams]);
	const mentionItems = useMemo(() => {
		if (!mention) return [];
		const query = mention.query.toLocaleLowerCase();
		return knowledgeItems.filter((item) => `${item.name} ${item.detail}`.toLocaleLowerCase().includes(query)).slice(0, 8);
	}, [knowledgeItems, mention]);
	useEffect(() => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		let cancelled = false;
		void bridge.modelCatalog({ providerId: githubCopilotProviderId }).then((catalog) => {
			if (!cancelled) setModels(catalog.models);
		}).catch((catalogError) => console.warn("Could not load composer model catalog", catalogError));
		return () => { cancelled = true; };
	}, []);

	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		setMultiline(textarea.scrollHeight > 58);
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
			{mentionItems.length > 0 ? mentionItems.map((item, index) => <button key={`${item.kind}-${item.id}`} type="button" role="option" aria-selected={index === mention.activeIndex} className={index === mention.activeIndex ? "is-active" : ""} onMouseDown={(event) => { event.preventDefault(); selectMention(item); }} onMouseEnter={() => setMention((current) => current ? { ...current, activeIndex: index } : current)}><span className="composer-mention-icon">{item.kind === "entity" ? <Database size={15} /> : <DiagramTypeIcon type={item.diagramType ?? "structure"} size={15} />}</span><span><strong>{item.name}</strong><small>{item.kind === "entity" ? "Entity" : "Diagram"} · {item.detail}</small></span></button>) : <div className="composer-mention-empty">No entities or diagrams match “{mention.query}”.</div>}
		</div>}
		<div className={`chat-composer${multiline || references.length > 0 || images.length > 0 ? " is-multiline" : ""}`}>
			{(references.length > 0 || images.length > 0) && <div className="composer-context-row">
				{references.map((reference) => <span key={reference.raw} className="composer-reference-chip"><span className="composer-reference-icon">{reference.kind === "entity" ? <Database size={13} /> : <DiagramTypeIcon type={diagramTypes.get(reference.id) ?? "structure"} size={13} />}</span><span>@{reference.name}</span><small>{reference.kind === "entity" ? "Entity" : "Diagram"}</small><button type="button" title={`Remove ${reference.name}`} aria-label={`Remove ${reference.name}`} onClick={() => removeReference(reference.raw)}><X size={12} /></button></span>)}
				{images.map((image) => <div key={image.id} className="composer-attachment"><img src={image.preview} alt="Attached preview" /><button type="button" title="Remove image" aria-label="Remove image" onClick={() => onImagesChange(images.filter((item) => item.id !== image.id))}><X size={12} /></button></div>)}
			</div>}
			<div className="composer-input-row">
				<div className="composer-main">
				<textarea ref={textareaRef} className="composer-input" placeholder={images.length ? "Add a question about the image" : "Message Rhyza — type @ to reference knowledge"} value={draft} onChange={(event) => { updateDraft(event.target.value); updateMention(event.target.value, event.target.selectionStart); }} onClick={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart)} onBlur={() => window.setTimeout(() => setMention(null), 120)} onPaste={(event) => {
					const imageFiles = [...event.clipboardData.items].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => file !== null);
					if (imageFiles.length === 0) return;
					event.preventDefault();
					const files = new DataTransfer(); imageFiles.forEach((file) => files.items.add(file)); addFiles(files.files);
				}} onKeyDown={(event) => {
					if (event.nativeEvent.isComposing) return;
					if (mention && mentionItems.length > 0) {
						if (event.key === "Escape") { event.preventDefault(); setMention(null); return; }
						if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const delta = event.key === "ArrowDown" ? 1 : -1; setMention((current) => current ? { ...current, activeIndex: (current.activeIndex + delta + mentionItems.length) % mentionItems.length } : current); return; }
						if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); selectMention(mentionItems[mention.activeIndex]); return; }
					}
					if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); }
				}} rows={1} />
				<ComposerRuntimeControls models={models} selectedModel={settings.defaultModel} thinking={settings.thinkingLevel} contextRequest={contextRequest} onModelChange={(defaultModel) => updateSettings({ defaultModel })} onThinkingChange={(thinkingLevel) => updateSettings({ thinkingLevel })} />
				</div>
				<button type="button" title="Attach image" aria-label="Attach image" onClick={() => imageInputRef.current?.click()} className="composer-attach"><ImagePlus size={17} /></button>
				<input ref={imageInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} />
				<button type="button" title={isSending ? "Queue message" : "Send"} aria-label={isSending ? "Queue message" : "Send"} onClick={onSend} disabled={!draft.trim() && references.length === 0 && images.length === 0} className="composer-send"><Send size={18} /></button>
			</div>
		</div>
	</div><div className="composer-caption">{runtimeCaption}</div>{error && <div className="text-center mt-1 text-xs text-red-600">{error}</div>}</div>;
}

function ComposerRuntimeControls({ models, selectedModel, thinking, contextRequest, onModelChange, onThinkingChange }: {
	models: ModelInfo[];
	selectedModel: string;
	thinking: "off" | "low" | "medium" | "high";
	contextRequest?: AgentModelRequestSnapshot;
	onModelChange: (model: string) => void;
	onThinkingChange: (thinking: "off" | "low" | "medium" | "high") => void;
}) {
	const [openMenu, setOpenMenu] = useState<"model" | "thinking" | "context" | null>(null);
	const controlsRef = useRef<HTMLDivElement | null>(null);
	const model = models.find((item) => item.id === selectedModel);
	const selectedModelLabel = (model?.name ?? selectedModel) || "Provider default";
	const estimated = contextRequest ? analyzeContextComposition(contextRequest).total : 0;
	const used = contextRequest ? residentInputTokens(contextRequest.usage) ?? estimated : 0;
	const windowSize = model?.contextWindow ?? contextRequest?.contextWindow ?? 0;
	const percent = windowSize > 0 ? Math.min(100, Math.round(used / windowSize * 100)) : 0;
	useEffect(() => {
		if (!openMenu) return;
		const close = (event: MouseEvent | KeyboardEvent) => {
			if (event instanceof KeyboardEvent && event.key === "Escape") setOpenMenu(null);
			if (event instanceof MouseEvent && !controlsRef.current?.contains(event.target as Node)) setOpenMenu(null);
		};
		document.addEventListener("mousedown", close);
		document.addEventListener("keydown", close);
		return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
	}, [openMenu]);
	const thinkingOptions = [
		{ value: "off" as const, label: "Off", detail: "Fastest · no extended reasoning" },
		{ value: "low" as const, label: "Low", detail: "Quick reasoning for simple tasks" },
		{ value: "medium" as const, label: "Medium", detail: "Balanced speed and depth" },
		{ value: "high" as const, label: "High", detail: "Deeper reasoning for hard tasks" },
	];
	return <div className="composer-runtime-controls" ref={controlsRef}>
		<div className="composer-runtime-control">
			<button type="button" className="composer-runtime-trigger" title="Choose model" aria-haspopup="listbox" aria-expanded={openMenu === "model"} onClick={() => setOpenMenu((current) => current === "model" ? null : "model")}><Gauge size={13} aria-hidden="true" /><span>{selectedModelLabel}</span><ChevronDown size={12} aria-hidden="true" /></button>
			{openMenu === "model" && <div className="composer-runtime-menu composer-model-menu" role="listbox" aria-label="Model used for new messages">
				<header><div><strong>Model</strong><span>Used for new messages</span></div><small>{models.length || 1} available</small></header>
				<div className="composer-runtime-menu-scroll">
					<button type="button" role="option" aria-selected={!selectedModel} className={!selectedModel ? "is-selected" : ""} onClick={() => { onModelChange(""); setOpenMenu(null); }}><span className="composer-menu-check">{!selectedModel && <Check size={13} />}</span><span><strong>Provider default</strong><small>Let GitHub Copilot choose</small></span></button>
					{selectedModel && !model && <button type="button" role="option" aria-selected="true" className="is-selected" onClick={() => setOpenMenu(null)}><span className="composer-menu-check"><Check size={13} /></span><span><strong>{selectedModel}</strong><small>Current model</small></span></button>}
					{models.map((item) => <button type="button" role="option" aria-selected={item.id === selectedModel} className={item.id === selectedModel ? "is-selected" : ""} key={item.id} onClick={() => { onModelChange(item.id); setOpenMenu(null); }}><span className="composer-menu-check">{item.id === selectedModel && <Check size={13} />}</span><span><strong>{item.name}</strong><small>{formatCompactTokens(item.contextWindow)} context{item.reasoning ? " · reasoning" : ""}</small></span></button>)}
				</div>
			</div>}
		</div>
		<div className="composer-runtime-control">
			<button type="button" className="composer-runtime-trigger" title="Choose thinking level" aria-haspopup="listbox" aria-expanded={openMenu === "thinking"} onClick={() => setOpenMenu((current) => current === "thinking" ? null : "thinking")}><Brain size={13} aria-hidden="true" /><span>Thinking {thinking}</span><ChevronDown size={12} aria-hidden="true" /></button>
			{openMenu === "thinking" && <div className="composer-runtime-menu composer-thinking-menu" role="listbox" aria-label="Thinking level used for new messages">
				<header><div><strong>Thinking</strong><span>Reasoning effort for new messages</span></div></header>
				<div className="composer-runtime-menu-scroll">{thinkingOptions.map((item) => <button type="button" role="option" aria-selected={item.value === thinking} className={item.value === thinking ? "is-selected" : ""} key={item.value} onClick={() => { onThinkingChange(item.value); setOpenMenu(null); }}><span className="composer-menu-check">{item.value === thinking && <Check size={13} />}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</div>
			</div>}
		</div>
		<div className="composer-context-window">
			<button type="button" className="composer-context-ring" title={`Context window: ${percent}% used`} aria-label={`View context window usage, ${percent}% used`} aria-haspopup="dialog" aria-expanded={openMenu === "context"} onClick={() => setOpenMenu((current) => current === "context" ? null : "context")}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle className="composer-context-ring-track" cx="12" cy="12" r="8.5" /><circle className="composer-context-ring-value" cx="12" cy="12" r="8.5" pathLength="100" strokeDasharray={`${percent} 100`} /></svg>
			</button>
			{openMenu === "context" && <div className="composer-context-popover" role="dialog" aria-label="Context window usage"><header><div><strong>Context window</strong><span>Latest request</span></div><b>{percent}%</b></header><div className="composer-context-progress"><span style={{ width: `${percent}%` }} /></div><dl><div><dt>Resident input</dt><dd>{formatComposerTokens(used)}</dd></div><div><dt>Window size</dt><dd>{windowSize ? formatComposerTokens(windowSize) : "Unknown"}</dd></div><div><dt>Measurement</dt><dd>{contextRequest?.usage ? "API reported" : contextRequest ? "Estimated" : "No request yet"}</dd></div></dl><p>Based on the latest model request in this conversation.</p></div>}
		</div>
	</div>;
}

function formatCompactTokens(value: number): string {
	if (value < 1_000) return `${value.toLocaleString()}`;
	return `${Math.round(value / 1_000)}k`;
}

function formatComposerTokens(value: number): string {
	if (value < 1_000) return `${Math.round(value).toLocaleString()} tokens`;
	return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k tokens`;
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
