import {
	AtSign,
	MessageCircle,
	FolderOpen,
	Package,
	Settings,
	Slash,
	Brain,
	Cloud,
	ChevronDown,
	Database,
	Gauge,
	ImagePlus,
	Send,
	X,
} from "lucide-react";
import {
	type Ref,
	useEffect,
	useId,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { getRhyzaBridge } from "../../hooks/useRhyzaBridge";
import type {
	ComposerSkillInfo,
	AgentModelRequestSnapshot,
	AgentPromptImage,
	ModelInfo,
	ProviderId,
} from "../../shared/ipc";
import type { Diagram, Entity } from "../../types";
import { useTranslation, type MessageKey } from "../../i18n";
import {
	composeInput,
	stripReferences,
	createReference,
	parseReferences,
	type ComposerReference,
} from "../../utils/composerInput";
import {
	getComposerTrigger,
	filterComposerItems,
	type ComposerTrigger,
} from "../../utils/composerMenu";
import { analyzeContextComposition, residentInputTokens } from "../../utils/contextRot";
import { DiagramTypeIcon } from "../DiagramTypeIcon";
import { useProviderModels } from "../../hooks/useProviderModels";
import { getProviderInfo, providers } from "../../shared/providers";
import { useAppStore } from "../../store";
import { CacheStatus } from "./CacheStatus";
import { refreshCacheClock } from "../../hooks/useCacheClock";
import { lastCacheRequest } from "../../utils/cacheStatus";
import { measurePerformance, recordPerformanceTiming } from "../../utils/performanceMarks";
import { createBrowserInputDiagnostics } from "../../utils/inputDiagnostics";
import { Select } from "../Select";
import { navigateMenu, useFloatingMenu } from "../../hooks/useFloatingMenu";

const maxPromptImageBytes = 4_500_000;
export type ComposerImage = AgentPromptImage & { id: string; preview: string };
export type ComposerDraftHandle = {
	getSnapshot: () => { input: string; images: ComposerImage[] };
	clear: () => void;
	setSnapshot: (input: string, images: AgentPromptImage[]) => void;
};

type ComposerItem = {
	id: string;
	name: string;
	detail: string;
	group: string;
	keywords?: string;
	badge?: string;
	kind?: ComposerReference["kind"];
	diagramType?: Diagram["type"];
	reference?: ComposerReference;
	action?: () => void;
};
type RuntimeMenu = "model" | "context" | null;
type MenuState = ComposerTrigger & {
	activeIndex: number;
	page?: "model" | "thinking" | "provider";
};

export function ChatComposer({
	draftRef,
	entities,
	diagrams,
	contextRequest,
	isSending,
	error,
	runtimeCaption,
	onError,
	onSend,
}: {
	draftRef: Ref<ComposerDraftHandle>;
	entities: Entity[];
	diagrams: Diagram[];
	contextRequest?: AgentModelRequestSnapshot;
	isSending: boolean;
	error: string | null;
	runtimeCaption: string;
	onError: (error: string | null) => void;
	onSend: () => void;
}) {
	const { t } = useTranslation();
	const renderStartedAt = performance.now();
	// Keystrokes stay in this subtree; sending reads a committed snapshot once.
	const [input, onInputChange] = useState("");
	const [images, onImagesChange] = useState<ComposerImage[]>([]);
	useImperativeHandle(
		draftRef,
		() => ({
			getSnapshot: () => ({ input, images }),
			clear: () => {
				onInputChange("");
				onImagesChange([]);
			},
			setSnapshot: (text, attachments) => {
				onInputChange(text);
				onImagesChange(
					attachments.map((image) => ({
						...image,
						id: crypto.randomUUID(),
						preview: `data:${image.mimeType};base64,${image.data}`,
					})),
				);
				textareaRef.current?.focus({ preventScroll: true });
			},
		}),
		[input, images],
	);
	const [inputDiagnostics] = useState(createBrowserInputDiagnostics);
	useEffect(() => {
		const reset = () => inputDiagnostics.reset();
		document.addEventListener("visibilitychange", reset);
		return () => {
			document.removeEventListener("visibilitychange", reset);
			reset();
		};
	}, [inputDiagnostics]);
	const navigate = useNavigate();
	const menuId = useId();
	const menuRef = useRef<HTMLDivElement | null>(null);
	const sessions = useAppStore((state) => state.sessions);
	const sources = useAppStore((state) => state.sources);
	const activeSessionId = useAppStore((state) => state.activeSessionId);
	const [skills, setSkills] = useState<ComposerSkillInfo[]>([]);
	const [skillsError, setSkillsError] = useState<string | null>(null);
	const [skillsLoading, setSkillsLoading] = useState(false);
	const [runtimeMenu, setRuntimeMenu] = useState<RuntimeMenu>(null);
	const imageInputRef = useRef<HTMLInputElement | null>(null);
	const send = () => {
		refreshCacheClock();
		onSend();
	};
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const settings = useAppStore((state) => state.settings);
	const cacheRequest = useAppStore((state) =>
		lastCacheRequest(state.turns.filter((turn) => turn.sessionId === state.activeSessionId)),
	);
	const updateSettings = useAppStore((state) => state.updateSettings);
	const provider = getProviderInfo(settings.provider);
	const { models, loading: modelsLoading, error: modelError } = useProviderModels(provider.id);
	// Persisted cache evidence without a request snapshot predates provider selection.
	const cacheMatchesProvider = contextRequest
		? contextRequest.provider === provider.id
		: provider.id === "github-copilot";
	const [mention, setMention] = useState<MenuState | null>(null);
	const [multiline, setMultiline] = useState(false);
	const references = useMemo(
		() => measurePerformance("composer-parse-references", () => parseReferences(input)),
		[input],
	);
	const diagramTypes = useMemo(
		() => new Map(diagrams.map((diagram) => [diagram.id, diagram.type])),
		[diagrams],
	);
	const draft = useMemo(
		() => measurePerformance("composer-strip-references", () => stripReferences(input)),
		[input],
	);
	const menuOpen = mention !== null;
	useEffect(() => {
		if (!menuOpen) return;
		const bridge = getRhyzaBridge();
		setSkills([]);
		setSkillsError(null);
		setSkillsLoading(false);
		if (!bridge?.composerSkills) return;
		let cancelled = false;
		const skillsStartedAt = performance.now();
		setSkillsLoading(true);
		void bridge
			.composerSkills({ providerId: provider.id })
			.then(
				(items) => {
					if (!cancelled) setSkills(items);
				},
				(error: unknown) => {
					if (!cancelled) setSkillsError(error instanceof Error ? error.message : String(error));
				},
			)
			.finally(() => {
				recordPerformanceTiming("composer-skills-request", performance.now() - skillsStartedAt);
				if (!cancelled) setSkillsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [menuOpen, provider.id]);
	useEffect(() => {
		setMention(null);
		setRuntimeMenu(null);
	}, [activeSessionId]);
	const referenceItems = useMemo<ComposerItem[]>(() => {
		return measurePerformance("composer-reference-items", () => {
			const item = (
				name: string,
				kind: ComposerReference["kind"],
				id: string,
				detail: string,
				group: string,
			): ComposerItem => ({
				id: `${kind}:${id}`,
				name,
				kind,
				detail,
				group,
				reference: { name, kind, id, detail, raw: createReference(name, kind, id) },
			});
			return [
				...entities
					.filter((entry) => !entry.deletedAt)
					.map((entry) => ({
						...item(entry.name, "entity", entry.id, entry.type, "知识库"),
						keywords: entry.aliases.join(" "),
					})),
				...diagrams
					.filter((entry) => !entry.deletedAt)
					.map((entry) => ({
						...item(entry.name, "diagram", entry.id, entry.type, "Diagrams"),
						diagramType: entry.type,
					})),
				...sessions.map((entry) =>
					item(
						entry.title,
						"session",
						entry.id,
						entry.id === activeSessionId ? "Current conversation" : "Rhyza conversation",
						"Conversations",
					),
				),
				...sources
					.filter((entry) => entry.status !== "archived")
					.map((entry) => item(entry.name, "source", entry.id, entry.path, "资料来源")),
				...skills.map((entry) => ({
					...item(entry.name, "skill", entry.path, entry.description, "Skills"),
					badge: entry.scope,
				})),
			];
		});
	}, [entities, diagrams, sessions, sources, skills, activeSessionId]);
	const openPage = (page: NonNullable<MenuState["page"]>) => {
		if (!mention) return;
		const token = `/${page === "thinking" ? "reasoning" : page} `;
		updateDraft(`${draft.slice(0, mention.start)}${token}${draft.slice(mention.end)}`);
		const end = mention.start + token.length;
		setMention({ ...mention, page, end, query: "", activeIndex: 0 });
		requestAnimationFrame(() => {
			textareaRef.current?.focus();
			textareaRef.current?.setSelectionRange(end, end);
		});
	};
	const commands: ComposerItem[] = [
		{
			id: "image",
			name: "Attach images",
			detail: "Add images to your message",
			keywords: "image photo 图片 附件",
			group: "Add",
			action: () => imageInputRef.current?.click(),
		},
		{
			id: "model",
			name: "Model",
			detail: settings.defaultModel || "Provider default",
			keywords: "模型",
			group: "Commands",
			action: () => openPage("model"),
		},
		{
			id: "thinking",
			name: "Reasoning",
			detail: settings.thinkingLevel,
			keywords: "thinking 推理",
			group: "Commands",
			action: () => openPage("thinking"),
		},
		{
			id: "provider",
			name: "Provider",
			detail: provider.label,
			keywords: "服务商",
			group: "Commands",
			action: () => openPage("provider"),
		},
		{
			id: "status",
			name: "Status",
			detail: "View context window usage",
			keywords: "context 状态 上下文",
			group: "Commands",
			action: () => setRuntimeMenu("context"),
		},
		{
			id: "knowledge",
			name: "知识工具",
			detail: settings.knowledgeTools
				? "On · turn off for new messages"
				: "Off · turn on for new messages",
			keywords: "知识",
			group: "Commands",
			action: () => updateSettings({ knowledgeTools: !settings.knowledgeTools }),
		},
		{
			id: "plugins",
			name: "Plugins",
			detail: "Manage installed Pi packages",
			keywords: "extensions 插件",
			group: "Commands",
			action: () => navigate("/settings"),
		},
		{
			id: "settings",
			name: "设置",
			detail: "打开应用设置",
			keywords: "设置",
			group: "Commands",
			action: () => navigate("/settings"),
		},
		...referenceItems.filter((item) => item.kind === "skill"),
	];
	const pageItems: ComposerItem[] =
		mention?.page === "model"
			? [
					{
						id: "default-model",
						name: "Provider default",
						detail: `Let ${provider.label} choose`,
						group: "Model",
						action: () => updateSettings({ defaultModel: "" }),
					},
					...models.map((model) => ({
						id: model.id,
						name: model.name,
						detail: `${formatCompactTokens(model.contextWindow)} context`,
						group: "Model",
						keywords: model.id,
						action: () => updateSettings({ defaultModel: model.id }),
					})),
				]
			: mention?.page === "thinking"
				? (["off", "low", "medium", "high"] as const).map((thinkingLevel) => ({
						id: thinkingLevel,
						name: thinkingLevel[0].toUpperCase() + thinkingLevel.slice(1),
						detail:
							settings.thinkingLevel === thinkingLevel
								? "Current reasoning effort"
								: "Set reasoning effort for new messages",
						group: "Reasoning",
						action: () => updateSettings({ thinkingLevel }),
					}))
				: providers.map((entry) => ({
						id: entry.id,
						name: entry.label,
						detail: entry.id === provider.id ? "Current provider" : entry.runtimeLabel,
						group: "Provider",
						action: () => updateSettings({ provider: entry.id }),
					}));
	const mentionItems = mention
		? measurePerformance("composer-menu-filter", () =>
				filterComposerItems(
					mention.page ? pageItems : mention.kind === "mention" ? referenceItems : commands,
					mention.query,
				),
			)
		: [];
	const activeIndex = Math.min(mention?.activeIndex ?? 0, Math.max(0, mentionItems.length - 1));
	useLayoutEffect(() => {
		measurePerformance("composer-menu-scroll", () => {
			menuRef.current
				?.querySelector('[aria-selected="true"]')
				?.scrollIntoView({ block: "nearest" });
		});
	}, [activeIndex, mention?.query, mention?.page, mentionItems.length]);
	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		const startedAt = performance.now();
		textarea.style.height = "auto";
		const scrollHeight = textarea.scrollHeight;
		const style = getComputedStyle(textarea);
		const singleLineHeight =
			parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
		const maxHeight = parseFloat(style.maxHeight);
		setMultiline(scrollHeight > singleLineHeight + 1);
		const nextHeight = Math.min(maxHeight, Math.max(singleLineHeight, scrollHeight));
		textarea.style.height = `${nextHeight}px`;
		textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
		recordPerformanceTiming("composer-textarea-layout", performance.now() - startedAt);
	}, [draft]);
	useLayoutEffect(() => {
		recordPerformanceTiming("composer-render-commit", performance.now() - renderStartedAt);
		inputDiagnostics.commit();
	});

	const updateMention = (value: string, caret: number) => {
		const trigger = measurePerformance("composer-menu-trigger", () =>
			getComposerTrigger(value, caret),
		);
		setMention(trigger ? { ...trigger, activeIndex: 0 } : null);
		if (trigger) setRuntimeMenu(null);
	};
	const updateDraft = (value: string) =>
		measurePerformance("composer-update-draft", () => {
			onInputChange(composeInput(value, references));
		});
	const selectMention = (item: ComposerItem) => {
		if (!mention) return;
		if (!mention.page && ["model", "thinking", "provider"].includes(item.id) && !item.reference) {
			item.action?.();
			return;
		}
		const nextDraft = `${draft.slice(0, mention.start)}${draft.slice(mention.end)}`;
		const nextReferences =
			item.reference && !references.some((reference) => reference.raw === item.reference?.raw)
				? [...references, item.reference]
				: references;
		onInputChange(composeInput(nextDraft, nextReferences));
		setMention(null);
		item.action?.();
		requestAnimationFrame(() => {
			textareaRef.current?.focus();
			textareaRef.current?.setSelectionRange(mention.start, mention.start);
		});
	};
	const removeReference = (raw: string) => {
		onInputChange(
			composeInput(
				draft,
				references.filter((reference) => reference.raw !== raw),
			),
		);
		requestAnimationFrame(() => textareaRef.current?.focus());
	};
	const addFiles = (files: FileList | null) =>
		void readPromptImages(files)
			.then((next) => {
				onError(null);
				onImagesChange([...images, ...next].slice(0, 4));
			})
			.catch((caught: unknown) =>
				onError(caught instanceof Error ? caught.message : String(caught)),
			);
	return (
		<div className="composer-shell">
			<div className="composer-frame">
				{mention && (
					<div className="composer-mention-menu" ref={menuRef}>
						<div
							className="composer-mention-scroll"
							id={menuId}
							role="listbox"
							aria-label={mention.kind === "mention" ? t("References") : t("Commands")}
						>
							{mentionItems.map((item, index) => (
								<div key={item.id} role="presentation">
									{(index === 0 || mentionItems[index - 1].group !== item.group) && (
										<div className="composer-mention-heading" role="presentation">
											{item.group}
										</div>
									)}
									<button
										type="button"
										role="option"
										id={`${menuId}-${index}`}
										aria-selected={index === activeIndex}
										className={index === activeIndex ? "is-active" : ""}
										onPointerDown={(event) => event.preventDefault()}
										onClick={() => selectMention(item)}
										onMouseEnter={() =>
											setMention((current) =>
												current ? { ...current, activeIndex: index } : current,
											)
										}
									>
										<span className="composer-mention-icon">
											<ComposerItemIcon item={item} />
										</span>
										<span className="composer-mention-label">
											<strong>{item.name}</strong>
											<small>{item.detail}</small>
										</span>
										{item.badge && <span className="composer-mention-badge">{item.badge}</span>}
									</button>
								</div>
							))}
							{mentionItems.length === 0 && (
								<div className="composer-mention-empty">
									{t("No results for “")}
									{mention.query}
									{t("”. Try another name.")}
								</div>
							)}
							{skillsLoading && !mention.page && (
								<div className="composer-mention-empty" role="status">
									{t("Loading skills…")}
								</div>
							)}
							{skillsError && !mention.page && (
								<div className="composer-mention-empty" role="status">
									{t("Skills unavailable: ")}
									{skillsError}
								</div>
							)}
							{mention.page === "model" && (modelsLoading || modelError) && (
								<div className="composer-mention-empty" role="status">
									{modelError || t("Loading models…")}
								</div>
							)}
						</div>
						<div className="composer-mention-footer">
							<span>{t("↑ ↓ Navigate · Enter / Tab Select")}</span>
							<span>Esc {mention.page ? t("Back") : t("Close")}</span>
						</div>
					</div>
				)}
				<div
					className={`chat-composer${multiline || references.length > 0 || images.length > 0 ? " is-multiline" : ""}`}
				>
					{(references.length > 0 || images.length > 0) && (
						<div className="composer-context-row">
							{references.map((reference) => (
								<span key={reference.raw} className="composer-reference-chip">
									<span className="composer-reference-icon">
										<ComposerItemIcon
											item={{
												id: reference.id,
												name: reference.name,
												detail: "",
												group: "",
												kind: reference.kind,
												diagramType: diagramTypes.get(reference.id),
											}}
										/>
									</span>
									<span>@{reference.name}</span>
									<small>{reference.kind}</small>
									<button
										type="button"
										title={`Remove ${reference.name}`}
										aria-label={`Remove ${reference.name}`}
										onClick={() => removeReference(reference.raw)}
									>
										<X size={12} />
									</button>
								</span>
							))}
							{images.map((image) => (
								<div key={image.id} className="composer-attachment">
									<img src={image.preview} alt={t("Attached preview")} />
									<button
										type="button"
										title={t("Remove image")}
										aria-label={t("Remove image")}
										onClick={() => onImagesChange(images.filter((item) => item.id !== image.id))}
									>
										<X size={12} />
									</button>
								</div>
							))}
						</div>
					)}
					<div className="composer-input-row">
						<div className="composer-main">
							<textarea
								ref={textareaRef}
								className="composer-input"
								placeholder={
									images.length
										? t("Add a question about the image")
										: t("Message Rhyza — @ to reference, / for commands")
								}
								aria-label={t("Message Rhyza")}
								aria-autocomplete="list"
								aria-haspopup="listbox"
								aria-expanded={mention !== null}
								aria-controls={mention ? menuId : undefined}
								aria-activedescendant={
									mention && mentionItems.length ? `${menuId}-${activeIndex}` : undefined
								}
								value={draft}
								onChange={(event) => {
									const finish = inputDiagnostics.begin(event.nativeEvent as InputEvent);
									try {
										updateDraft(event.target.value);
										if (!(event.nativeEvent as InputEvent).isComposing)
											updateMention(event.target.value, event.target.selectionStart);
									} finally {
										finish();
									}
								}}
								onClick={(event) =>
									updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
								}
								onBlur={() => setMention(null)}
								onCompositionStart={() => setMention(null)}
								onCompositionEnd={(event) =>
									updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
								}
								onPaste={(event) => {
									const imageFiles = [...event.clipboardData.items]
										.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
										.map((item) => item.getAsFile())
										.filter((file): file is File => file !== null);
									if (imageFiles.length === 0) return;
									event.preventDefault();
									const files = new DataTransfer();
									imageFiles.forEach((file) => files.items.add(file));
									addFiles(files.files);
								}}
								onKeyDown={(event) => {
									if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
									if (mention) {
										if (event.key === "Escape") {
											event.preventDefault();
											event.stopPropagation();
											if (mention.page) {
												const end = mention.start + 1;
												updateDraft(`${draft.slice(0, mention.start)}/${draft.slice(mention.end)}`);
												setMention({ ...mention, page: undefined, query: "", end, activeIndex: 0 });
												requestAnimationFrame(() =>
													textareaRef.current?.setSelectionRange(end, end),
												);
											} else setMention(null);
											return;
										}
										if (
											(event.key === "ArrowDown" || event.key === "ArrowUp") &&
											mentionItems.length
										) {
											event.preventDefault();
											const delta = event.key === "ArrowDown" ? 1 : -1;
											setMention({
												...mention,
												activeIndex:
													(activeIndex + delta + mentionItems.length) % mentionItems.length,
											});
											return;
										}
										if (
											(event.key === "Enter" || (event.key === "Tab" && mentionItems.length > 0)) &&
											!event.shiftKey
										) {
											event.preventDefault();
											if (mentionItems[activeIndex]) selectMention(mentionItems[activeIndex]);
											return;
										}
									}
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										send();
									}
								}}
								onKeyUp={(event) => {
									if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
										updateMention(event.currentTarget.value, event.currentTarget.selectionStart);
								}}
								rows={1}
							/>
							<ComposerRuntimeControls
								key={provider.id}
								openMenu={runtimeMenu}
								setOpenMenu={setRuntimeMenu}
								providerId={provider.id}
								models={models}
								modelsLoading={modelsLoading}
								modelError={modelError}
								selectedModel={settings.defaultModel}
								thinking={settings.thinkingLevel}
								contextRequest={
									contextRequest?.provider === provider.id ? contextRequest : undefined
								}
								onProviderChange={(provider) => updateSettings({ provider })}
								onModelChange={(defaultModel) => updateSettings({ defaultModel })}
								onThinkingChange={(thinkingLevel) => updateSettings({ thinkingLevel })}
							/>
						</div>
						<button
							type="button"
							title={t("Attach image")}
							aria-label={t("Attach image")}
							onClick={() => imageInputRef.current?.click()}
							className="composer-attach"
						>
							<ImagePlus size={17} />
						</button>
						<input
							ref={imageInputRef}
							className="sr-only"
							type="file"
							accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
							multiple
							onChange={(event) => {
								addFiles(event.target.files);
								event.currentTarget.value = "";
							}}
						/>
						<button
							type="button"
							title={isSending ? t("Queue message") : t("Send")}
							aria-label={isSending ? t("Queue message") : t("Send")}
							onClick={send}
							disabled={!draft.trim() && references.length === 0 && images.length === 0}
							className="composer-send"
						>
							<Send size={18} />
						</button>
					</div>
				</div>
			</div>
			<CacheStatus
				request={cacheMatchesProvider ? cacheRequest : undefined}
				selectedModel={settings.defaultModel}
			/>
			<div className="composer-caption">{runtimeCaption}</div>
			{error && <div className="text-center mt-1 text-xs text-red-600">{error}</div>}
		</div>
	);
}

function ComposerRuntimeControls({
	openMenu,
	setOpenMenu,
	providerId,
	models,
	modelsLoading,
	modelError,
	selectedModel,
	thinking,
	contextRequest,
	onProviderChange,
	onModelChange,
	onThinkingChange,
}: {
	openMenu: RuntimeMenu;
	setOpenMenu: React.Dispatch<React.SetStateAction<RuntimeMenu>>;
	providerId: ProviderId;
	models: ModelInfo[];
	modelsLoading: boolean;
	modelError: string | null;
	selectedModel: string;
	thinking: "off" | "low" | "medium" | "high";
	contextRequest?: AgentModelRequestSnapshot;
	onProviderChange: (provider: ProviderId) => void;
	onModelChange: (model: string) => void;
	onThinkingChange: (thinking: "off" | "low" | "medium" | "high") => void;
}) {
	const { t } = useTranslation();
	const controlsRef = useRef<HTMLDivElement | null>(null);
	const [contextAnchor, setContextAnchor] = useState({ x: 0, y: 0 });
	const [contextOpen, setContextOpen] = useState(false);
	const contextRing = useRef<HTMLButtonElement>(null);
	const contextHovered = useRef(false);
	const contextCloseTimer = useRef<number | undefined>(undefined);
	const contextTooltipId = useId();
	const [modelAnchor, setModelAnchor] = useState({ x: 0, y: 0 });
	const modelMenuId = useId();
	const provider = getProviderInfo(providerId);
	const model = models.find((item) => item.id === selectedModel);
	const selectedModelLabel = (model?.name ?? selectedModel) || t("Provider default");
	const thinkingLabel = t(
		thinking === "off"
			? "Off"
			: thinking === "low"
				? "Low"
				: thinking === "high"
					? "High"
					: "Medium",
	);
	const estimated = contextRequest ? analyzeContextComposition(contextRequest).total : 0;
	const used = contextRequest ? (residentInputTokens(contextRequest.usage) ?? estimated) : 0;
	const windowSize = model?.contextWindow ?? contextRequest?.contextWindow ?? 0;
	const percent = windowSize > 0 ? Math.min(100, Math.round((used / windowSize) * 100)) : 0;
	const usageKnown = Boolean(contextRequest) && windowSize > 0;
	const keepContextOpen = () => {
		if (contextCloseTimer.current !== undefined) {
			window.clearTimeout(contextCloseTimer.current);
			contextCloseTimer.current = undefined;
		}
	};
	const showContext = () => {
		if (openMenu === "model" || !contextRing.current) return;
		keepContextOpen();
		const bounds = contextRing.current.getBoundingClientRect();
		setContextAnchor({ x: bounds.left + bounds.width / 2, y: bounds.top });
		setContextOpen(true);
	};
	const scheduleContextClose = () => {
		keepContextOpen();
		contextCloseTimer.current = window.setTimeout(() => {
			contextCloseTimer.current = undefined;
			if (!contextHovered.current && document.activeElement !== contextRing.current)
				setContextOpen(false);
		}, 100);
	};
	useEffect(() => {
		return () => {
			if (contextCloseTimer.current !== undefined) window.clearTimeout(contextCloseTimer.current);
		};
	}, []);
	useEffect(() => {
		if (openMenu === "model") setContextOpen(false);
		if (openMenu === "context") {
			showContext();
			setOpenMenu(null);
		}
	}, [openMenu]);
	useEffect(() => {
		if (!openMenu && !contextOpen) return;
		const close = (event: MouseEvent | KeyboardEvent) => {
			if (event instanceof KeyboardEvent && event.key === "Escape" && !event.defaultPrevented) {
				setOpenMenu(null);
				setContextOpen(false);
			}
			if (
				event instanceof MouseEvent &&
				!controlsRef.current?.contains(event.target as Node) &&
				!(
					event.target instanceof Element &&
					event.target.closest(
						".composer-model-settings, .composer-model-menu, .composer-context-popover",
					)
				)
			) {
				setOpenMenu(null);
				setContextOpen(false);
			}
		};
		document.addEventListener("mousedown", close);
		document.addEventListener("keydown", close);
		return () => {
			document.removeEventListener("mousedown", close);
			document.removeEventListener("keydown", close);
		};
	}, [openMenu, contextOpen]);
	return (
		<div className="composer-runtime-controls flex-wrap" ref={controlsRef}>
			<div className="composer-runtime-control" onPointerDownCapture={() => setOpenMenu(null)}>
				<Select
					showIcon={false}
					showOptionIcons={false}
					triggerClassName="composer-runtime-trigger"
					popupClassName="composer-runtime-menu"
					title="选择服务提供方"
					aria-label={`Provider: ${provider.label}`}
					value={providerId}
					onChange={(event) => {
						const selected = providers.find((item) => item.id === event.target.value);
						if (selected) onProviderChange(selected.id);
						setOpenMenu(null);
					}}
				>
					{providers.map((item) => (
						<option
							key={item.id}
							value={item.id}
							title={item.externalAuth ? "Uses local CLI sign-in" : "Uses Pi"}
						>
							{item.label}
						</option>
					))}
				</Select>
			</div>
			<div className="composer-runtime-control">
				<button
					type="button"
					className="composer-runtime-trigger composer-model-trigger"
					title={t("Model and thinking")}
					aria-label={`${t("Model and thinking")}: ${selectedModelLabel}, ${thinkingLabel}`}
					aria-busy={modelsLoading}
					aria-haspopup="menu"
					aria-expanded={openMenu === "model"}
					aria-controls={openMenu === "model" ? modelMenuId : undefined}
					onClick={(event) => {
						const bounds = event.currentTarget.getBoundingClientRect();
						setModelAnchor({ x: bounds.left, y: bounds.top });
						setOpenMenu((current) => (current === "model" ? null : "model"));
					}}
					onKeyDown={(event) => {
						if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
						event.preventDefault();
						const bounds = event.currentTarget.getBoundingClientRect();
						setModelAnchor({ x: bounds.left, y: bounds.top });
						setOpenMenu("model");
					}}
				>
					<span className="composer-model-name">{selectedModelLabel}</span>
					<span className="composer-effort-label" data-effort={thinking}>
						{thinkingLabel}
					</span>
					<ChevronDown size={12} aria-hidden="true" />
				</button>
				{openMenu === "model" && (
					<ComposerModelPopover
						id={modelMenuId}
						anchor={modelAnchor}
						models={models}
						selectedModel={selectedModel}
						selectedModelLabel={selectedModelLabel}
						providerLabel={provider.label}
						thinking={thinking}
						onModelChange={onModelChange}
						onThinkingChange={onThinkingChange}
						onClose={() => setOpenMenu(null)}
					/>
				)}
				{modelsLoading && (
					<span className="sr-only" role="status">
						Loading models…
					</span>
				)}
				{modelError && (
					<p role="alert" className="field-error text-xs">
						{modelError}
					</p>
				)}
			</div>
			<div className="composer-context-window">
				<button
					ref={contextRing}
					type="button"
					className="composer-context-ring"
					aria-label={`${t("Context window")}: ${usageKnown ? `${percent}%` : t("Not recorded")}`}
					aria-describedby={contextOpen ? contextTooltipId : undefined}
					onPointerEnter={(event) => {
						if (event.pointerType === "touch") return;
						contextHovered.current = true;
						showContext();
					}}
					onPointerLeave={() => {
						contextHovered.current = false;
						scheduleContextClose();
					}}
					onFocus={showContext}
					onBlur={scheduleContextClose}
					onClick={showContext}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<circle className="composer-context-ring-track" cx="12" cy="12" r="8.5" />
						<circle
							className="composer-context-ring-value"
							cx="12"
							cy="12"
							r="8.5"
							pathLength="100"
							strokeDasharray={`${percent} 100`}
						/>
					</svg>
				</button>
				{contextOpen && (
					<ComposerContextPopover
						id={contextTooltipId}
						anchor={contextAnchor}
						onPointerEnter={() => {
							contextHovered.current = true;
							keepContextOpen();
						}}
						onPointerLeave={() => {
							contextHovered.current = false;
							scheduleContextClose();
						}}
					>
						<header>
							<div>
								<strong>{t("Context window")}</strong>
								<span>{t("Most recent request")}</span>
							</div>
							<b>{usageKnown ? `${percent}%` : t("Not recorded")}</b>
						</header>
						<div className="composer-context-progress">
							<span style={{ width: `${percent}%` }} />
						</div>
						<dl>
							<div>
								<dt>{t("Current input")}</dt>
								<dd>{contextRequest ? formatComposerTokens(used) : t("Not recorded")}</dd>
							</div>
							<div>
								<dt>{t("Window size")}</dt>
								<dd>{windowSize ? formatComposerTokens(windowSize) : t("Unknown")}</dd>
							</div>
							<div>
								<dt>{t("Measurement")}</dt>
								<dd>
									{contextRequest?.usage
										? t("API reported")
										: contextRequest
											? t("Estimated")
											: t("No request")}
								</dd>
							</div>
						</dl>
					</ComposerContextPopover>
				)}
			</div>
		</div>
	);
}

function ComposerModelPopover({
	id,
	anchor,
	models,
	selectedModel,
	selectedModelLabel,
	providerLabel,
	thinking,
	onModelChange,
	onThinkingChange,
	onClose,
}: {
	id: string;
	anchor: { x: number; y: number };
	models: ModelInfo[];
	selectedModel: string;
	selectedModelLabel: string;
	providerLabel: string;
	thinking: "off" | "low" | "medium" | "high";
	onModelChange: (model: string) => void;
	onThinkingChange: (thinking: "off" | "low" | "medium" | "high") => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const { ref, position } = useFloatingMenu(anchor, true, "above");
	const levels: { value: typeof thinking; label: MessageKey; detail: MessageKey }[] = [
		{ value: "off", label: "Off", detail: "Fastest · no extended reasoning" },
		{ value: "low", label: "Low", detail: "Quick reasoning for simple tasks" },
		{ value: "medium", label: "Medium", detail: "Balanced speed and depth" },
		{ value: "high", label: "High", detail: "Deeper reasoning for hard tasks" },
	];
	return createPortal(
		<div
			ref={ref}
			id={id}
			style={position}
			className="composer-model-settings"
			role="menu"
			aria-label={t("Model and thinking")}
			onKeyDown={(event) => {
				if (!event.defaultPrevented) navigateMenu(event, onClose);
			}}
		>
			<div className="composer-model-picker" role="none">
				<span className="composer-model-picker-label">{t("Select model")}</span>
				<Select
					showIcon={false}
					showOptionIcons={false}
					triggerClassName="composer-model-entry"
					popupClassName="composer-runtime-menu composer-model-menu"
					aria-label={`${t("Select model")}: ${selectedModelLabel}`}
					value={selectedModel}
					onChange={(event) => {
						onModelChange(event.target.value);
						onClose();
					}}
				>
					<option value="" title={`${t("Provider default")} · ${providerLabel}`}>
						{t("Provider default")}
					</option>
					{selectedModel && !models.some((model) => model.id === selectedModel) && (
						<option value={selectedModel}>{selectedModel}</option>
					)}
					{models.map((model) => (
						<option
							key={model.id}
							value={model.id}
							title={`${formatCompactTokens(model.contextWindow)} ${t("context")}${model.reasoning ? ` · ${t("reasoning")}` : ""}`}
						>
							{model.name}
						</option>
					))}
				</Select>
			</div>
			<div role="group" aria-label={t("Thinking level")}>
				<span className="composer-model-picker-label">{t("Thinking level")}</span>
				<div className="composer-effort-options">
					{levels.map((level) => (
						<button
							key={level.value}
							type="button"
							role="menuitemradio"
							aria-checked={thinking === level.value}
							data-effort={level.value}
							title={t(level.detail)}
							onClick={() => {
								onThinkingChange(level.value);
								onClose();
							}}
						>
							{t(level.label)}
						</button>
					))}
				</div>
			</div>
		</div>,
		document.body,
	);
}

function ComposerContextPopover({
	id,
	anchor,
	onPointerEnter,
	onPointerLeave,
	children,
}: {
	id: string;
	anchor: { x: number; y: number };
	onPointerEnter: () => void;
	onPointerLeave: () => void;
	children: React.ReactNode;
}) {
	const { ref, position } = useFloatingMenu(anchor, false, "above-center");
	return createPortal(
		<div
			ref={ref}
			id={id}
			style={position}
			className="composer-context-popover"
			role="tooltip"
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
		>
			{children}
		</div>,
		document.body,
	);
}

function formatCompactTokens(value: number): string {
	if (value < 1_000) return `${value.toLocaleString()}`;
	return `${Math.round(value / 1_000)}k`;
}

function formatComposerTokens(value: number): string {
	if (value < 1_000) return `${Math.round(value).toLocaleString()} tokens`;
	return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k tokens`;
}

function ComposerItemIcon({ item }: { item: ComposerItem }) {
	if (item.kind === "diagram")
		return <DiagramTypeIcon type={item.diagramType ?? "structure"} size={15} />;
	if (item.kind === "entity" || item.id === "knowledge") return <Database size={15} />;
	if (item.kind === "session") return <MessageCircle size={15} />;
	if (item.kind === "source") return <FolderOpen size={15} />;
	if (item.kind === "skill" || item.id === "plugins") return <Package size={15} />;
	if (item.id === "model" || item.id === "status") return <Gauge size={15} />;
	if (item.id === "thinking") return <Brain size={15} />;
	if (item.id === "provider") return <Cloud size={15} />;
	if (item.id === "image") return <ImagePlus size={15} />;
	if (item.id === "settings") return <Settings size={15} />;
	return item.reference ? <AtSign size={15} /> : <Slash size={15} />;
}

async function readPromptImages(files: FileList | null): Promise<ComposerImage[]> {
	if (!files) return [];
	return Promise.all(
		[...files].slice(0, 4).map(async (file) => {
			if (
				!new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]).has(file.type)
			)
				throw new Error(`${file.name} is not a supported image type.`);
			if (file.size > maxPromptImageBytes)
				throw new Error(`${file.name} exceeds the 4.5 MB image limit.`);
			const preview = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
				reader.onload = () => resolve(String(reader.result));
				reader.readAsDataURL(file);
			});
			const separator = preview.indexOf(",");
			if (separator < 0) throw new Error("Invalid image data.");
			return {
				id: crypto.randomUUID(),
				preview,
				mimeType: file.type as AgentPromptImage["mimeType"],
				data: preview.slice(separator + 1),
			};
		}),
	);
}
