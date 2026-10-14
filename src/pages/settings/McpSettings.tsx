import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import {
	BookOpen,
	ExternalLink,
	FileInput,
	Files,
	Info,
	List,
	LogIn,
	LogOut,
	Pencil,
	Plus,
	Power,
	RefreshCw,
	Save,
	Server,
	ShieldAlert,
	ShieldCheck,
	ShieldOff,
	Trash2,
	TriangleAlert,
	Wrench,
	X,
} from "lucide-react";
import { getRhyzaBridge } from "../../hooks/useRhyzaBridge";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import { Select } from "../../components/Select";
import { useTranslation } from "../../i18n";
import { useAppStore } from "../../store";
import { errorToMessage, FieldValidationError, isRecord } from "../../shared/value";
import {
	validateMcpConfig,
	validateMcpSave,
	type McpActionRequest,
	type McpOverview,
	type McpPermission,
	type McpSaveRequest,
	type McpServerInfo,
	type McpTarget,
} from "../../shared/mcp";
import "./mcp-settings.css";

const defaultServer: McpSaveRequest = {
	name: "",
	scope: "user",
	config: { command: "", args: [], exposure: "deferred" },
	policy: { tools: {} },
};
const stateLabels = {
	disabled: "Disabled",
	connecting: "Connecting",
	connected: "Connected",
	disconnected: "Disconnected",
	"needs-auth": "Sign-in required",
	failed: "Failed",
} as const;
const exposureLabels = {
	deferred: "Discover on demand",
	direct: "Always available",
	hidden: "Hidden",
} as const;

export function McpSettings() {
	const { t } = useTranslation();
	const provider = useAppStore((state) => state.settings.provider);
	const [overview, setOverview] = useState<McpOverview>();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState("");
	const [editor, setEditor] = useState<{ draft: McpSaveRequest; existing: boolean }>();
	const [detail, setDetail] = useState<McpServerInfo>();
	const [confirmation, setConfirmation] = useState<{
		kind: "trust" | "revoke" | "remove";
		target?: McpTarget;
	}>();
	const [authUrl, setAuthUrl] = useState("");
	const mounted = useRef(true);
	const sequence = useRef(0);
	const busyRef = useRef("");
	const workspaceRef = useRef<string | null>(null);
	const loginTarget = useRef<McpTarget | undefined>(undefined);
	const dialogTrigger = useRef<HTMLElement | null>(null);
	const rememberDialogTrigger = () => {
		dialogTrigger.current =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
	};

	const load = useCallback(async () => {
		const bridge = getRhyzaBridge();
		if (!bridge) {
			setError(t("MCP requires the desktop app."));
			return;
		}
		const current = ++sequence.current;
		try {
			const result = await bridge.mcpList();
			if (mounted.current && current === sequence.current) {
				setOverview(result);
				workspaceRef.current = result.workspacePath;
				setDetail(
					(previous) =>
						previous &&
						result.servers.find(
							(server) => server.name === previous.name && server.scope === previous.scope,
						),
				);
			}
		} catch (reason) {
			if (mounted.current && current === sequence.current) setError(errorToMessage(reason));
		}
	}, [t]);

	useEffect(() => {
		mounted.current = true;
		void load();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const unsubscribe = getRhyzaBridge()?.onMcpEvent((event) => {
			if (workspaceRef.current && event.workspacePath !== workspaceRef.current) return;
			if (event.type === "auth") {
				setAuthUrl(event.url ?? "");
				return;
			}
			clearTimeout(timer);
			timer = setTimeout(() => void load(), 150);
		});
		return () => {
			mounted.current = false;
			sequence.current++;
			clearTimeout(timer);
			unsubscribe?.();
			if (loginTarget.current)
				void getRhyzaBridge()
					?.mcpAction({ ...loginTarget.current, action: "cancel-login" })
					.catch((reason) =>
						console.error("Could not cancel MCP sign-in:", errorToMessage(reason)),
					);
		};
	}, [load]);

	const operate = async (label: string, action: () => Promise<unknown>): Promise<boolean> => {
		if (busyRef.current) return false;
		busyRef.current = label;
		setBusy(label);
		setError("");
		try {
			await action();
			await load();
			return true;
		} catch (reason) {
			if (mounted.current) setError(errorToMessage(reason));
			return false;
		} finally {
			busyRef.current = "";
			loginTarget.current = undefined;
			if (mounted.current) {
				setBusy("");
				setAuthUrl("");
			}
		}
	};

	const target = (server: McpServerInfo): McpTarget => {
		if (server.scope === "extension")
			throw new Error("Manage extension servers through their Pi package.");
		return { name: server.name, scope: server.scope };
	};
	const edit = (server: McpServerInfo) => {
		rememberDialogTrigger();
		void operate("edit", async () => {
			const draft = await getRhyzaBridge()!.mcpEdit(target(server));
			setDetail(undefined);
			setEditor({ draft, existing: true });
		});
	};
	const toggle = (server: McpServerInfo) =>
		void operate("toggle", async () => {
			const draft = await getRhyzaBridge()!.mcpEdit(target(server));
			await getRhyzaBridge()!.mcpSave({
				...draft,
				config: { ...draft.config, enabled: !server.enabled },
			});
		});
	const action = (server: McpServerInfo, command: McpActionRequest["action"]) => {
		if (command === "login") loginTarget.current = target(server);
		void operate(command, () =>
			getRhyzaBridge()!.mcpAction({ ...target(server), action: command }),
		);
	};
	const confirm = async () => {
		if (!confirmation) return;
		const succeeded = await operate(confirmation.kind, () =>
			confirmation.kind === "remove"
				? getRhyzaBridge()!.mcpRemove(confirmation.target!)
				: getRhyzaBridge()!.mcpTrust({ trusted: confirmation.kind === "trust" }),
		);
		if (succeeded) setConfirmation(undefined);
	};

	return (
		<div className="mcp-settings" aria-busy={Boolean(busy)}>
			<p className="settings-help">
				{t("MCP works with Pi-based providers. Claude Code does not use these servers.")}
			</p>
			{provider === "claude-code" && (
				<p className="mcp-notice" role="status">
					{t("Choose a Pi-based provider to use MCP in chat.")}
				</p>
			)}
			{error && !editor && !detail && !confirmation && (
				<p className="mcp-error" role="alert">
					{error}
				</p>
			)}
			{overview?.errors.map((message) => (
				<p className="mcp-error" role="alert" key={message}>
					{message}
				</p>
			))}
			{!overview && !error && (
				<div className="mcp-loading" role="status">
					{t("Loading MCP servers…")}
				</div>
			)}
			{overview && !overview.workspacePath && (
				<p className="mcp-notice">{t("Choose a workspace before configuring MCP.")}</p>
			)}
			{overview?.workspacePath && (
				<>
					<div
						className={`settings-panel mcp-trust ${overview.projectTrusted ? "is-trusted" : "is-untrusted"}`}
					>
						{overview.projectTrusted ? (
							<ShieldCheck size={20} aria-hidden="true" />
						) : (
							<ShieldAlert size={20} aria-hidden="true" />
						)}
						<div>
							<strong>{t("Project MCP configuration")}</strong>
							<p className="settings-help">
								{overview.projectTrusted
									? t("This workspace is trusted. Project servers override matching user servers.")
									: t("Project servers are not loaded until you trust this workspace.")}
							</p>
						</div>
						<button
							type="button"
							className="secondary-button mcp-icon-action"
							disabled={Boolean(busy)}
							aria-label={overview.projectTrusted ? t("Revoke trust") : t("Trust project")}
							title={overview.projectTrusted ? t("Revoke trust") : t("Trust project")}
							onClick={() =>
								setConfirmation({ kind: overview.projectTrusted ? "revoke" : "trust" })
							}
						>
							{overview.projectTrusted ? (
								<ShieldOff size={17} aria-hidden="true" />
							) : (
								<ShieldCheck size={17} aria-hidden="true" />
							)}
						</button>
					</div>
					<div className="mcp-toolbar">
						<h2>{t("Servers")}</h2>
						<div className="mcp-actions">
							<button
								type="button"
								className="secondary-button mcp-icon-action"
								aria-label={t("Refresh")}
								title={t("Refresh")}
								onClick={() => {
									setError("");
									void load();
								}}
								disabled={Boolean(busy)}
							>
								<RefreshCw size={17} aria-hidden="true" />
							</button>
							<button
								type="button"
								className="command-button mcp-icon-action"
								aria-label={t("Add server")}
								title={t("Add server")}
								disabled={Boolean(busy)}
								onClick={() => {
									rememberDialogTrigger();
									setDetail(undefined);
									setEditor({ draft: structuredClone(defaultServer), existing: false });
								}}
							>
								<Plus size={18} aria-hidden="true" />
							</button>
						</div>
					</div>
					{overview.servers.length === 0 && (
						<p className="mcp-empty">
							{t("No MCP servers yet. Add a local command or a remote HTTP endpoint.")}
						</p>
					)}
					<div className="mcp-server-list">
						{overview.servers.map((server) => (
							<McpServerCard
								key={`${server.scope}:${server.name}`}
								server={server}
								busy={Boolean(busy)}
								onDetails={() => {
									rememberDialogTrigger();
									setEditor(undefined);
									setDetail(server);
								}}
								onAction={(command) => action(server, command)}
								onToggle={() => toggle(server)}
								onEdit={() => edit(server)}
								onRemove={() => setConfirmation({ kind: "remove", target: target(server) })}
							/>
						))}
					</div>
				</>
			)}
			{busy === "login" && (
				<div className="mcp-notice" role="status">
					<p>{t("Waiting for browser sign-in…")}</p>
					<div className="mcp-actions">
						{authUrl && (
							<button
								type="button"
								className="secondary-button mcp-icon-action"
								aria-label={t("Open sign-in page")}
								title={t("Open sign-in page")}
								onClick={() =>
									void getRhyzaBridge()!
										.openExternal({ url: authUrl })
										.catch((reason) => setError(errorToMessage(reason)))
								}
							>
								<ExternalLink size={17} aria-hidden="true" />
							</button>
						)}
						<button
							type="button"
							className="secondary-button mcp-icon-action"
							aria-label={t("Cancel sign-in")}
							title={t("Cancel sign-in")}
							onClick={() => {
								const server = loginTarget.current;
								if (server)
									void getRhyzaBridge()!
										.mcpAction({ ...server, action: "cancel-login" })
										.catch((reason) => setError(errorToMessage(reason)));
							}}
						>
							<X size={17} aria-hidden="true" />
						</button>
					</div>
				</div>
			)}
			{editor && (
				<McpEditor
					key={`${editor.draft.scope}:${editor.draft.name}`}
					initial={editor.draft}
					existing={editor.existing}
					projectTrusted={overview?.projectTrusted === true}
					busy={Boolean(busy)}
					operationError={error}
					returnFocus={dialogTrigger.current}
					onClose={() => setEditor(undefined)}
					onSave={async (draft) => {
						const saved = await operate("save", () => getRhyzaBridge()!.mcpSave(draft));
						if (saved) setEditor(undefined);
					}}
				/>
			)}
			{detail && (
				<McpDetails
					key={`${detail.scope}:${detail.name}`}
					server={detail}
					busy={Boolean(busy)}
					operationError={error}
					returnFocus={dialogTrigger.current}
					onClose={() => setDetail(undefined)}
					onSave={(draft) => operate("permissions", () => getRhyzaBridge()!.mcpSave(draft))}
				/>
			)}
			{confirmation && (
				<McpConfirmation
					kind={confirmation.kind}
					name={confirmation.target?.name}
					busy={Boolean(busy)}
					error={error}
					onClose={() => setConfirmation(undefined)}
					onConfirm={() => void confirm()}
				/>
			)}
		</div>
	);
}

function McpServerCard({
	server,
	busy,
	onDetails,
	onAction,
	onToggle,
	onEdit,
	onRemove,
}: {
	server: McpServerInfo;
	busy: boolean;
	onDetails: () => void;
	onAction: (command: McpActionRequest["action"]) => void;
	onToggle: () => void;
	onEdit: () => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const needsAuth = server.enabled && server.state === "needs-auth";
	const signedIn = server.authenticated && !needsAuth;
	const connected = server.enabled && server.state === "connected";
	const connecting = server.state === "connecting";
	const authLabel = signedIn ? t("Sign out") : t("Sign in");
	const AuthIcon = signedIn ? LogOut : LogIn;
	return (
		<article
			className={`settings-panel mcp-server is-${server.enabled ? server.state : "disabled"}${needsAuth ? " needs-auth" : ""}`}
			aria-label={server.name}
		>
			<header className="mcp-server-heading">
				<span className="mcp-server-icon">
					<Server size={19} aria-hidden="true" />
				</span>
				<div className="mcp-server-identity">
					<h3>{server.name}</h3>
					<div className="mcp-server-meta">
						<span>{server.scope === "user" ? t("User configuration") : t("Project")}</span>
						<span>{server.transport === "stdio" ? "stdio" : "Streamable HTTP"}</span>
					</div>
				</div>
				<span className={`mcp-state is-${server.state}`} role="status">
					{t(stateLabels[server.state])}
				</span>
			</header>
			{needsAuth && (
				<div className="mcp-sign-in-hint" role="status">
					<TriangleAlert size={17} aria-hidden="true" />
					<div>
						<strong>{t("Sign in to discover tools")}</strong>
						<p>{t("Complete authentication in your browser to connect this server.")}</p>
					</div>
				</div>
			)}
			{server.error &&
				(server.state === "needs-auth" ? (
					<details className="mcp-diagnostics">
						<summary>{t("Connection details")}</summary>
						<pre>{server.error}</pre>
					</details>
				) : (
					<p className="mcp-error" role="alert">
						{server.error}
					</p>
				))}
			<footer className="mcp-server-footer">
				<div className="mcp-server-metrics">
					<span>
						{server.tools.length} {t("tools")}
					</span>
					<span>
						{server.connections} {t("active connections")}
					</span>
					<span>{t(exposureLabels[server.exposure])}</span>
				</div>
				<div className="mcp-server-actions" role="group" aria-label={server.name}>
					{server.oauth && (
						<button
							type="button"
							className={`secondary-button mcp-icon-action mcp-auth-action${needsAuth ? " needs-auth" : ""}`}
							aria-label={`${authLabel} ${server.name}`}
							title={authLabel}
							disabled={busy || !server.enabled || connecting}
							onClick={() => onAction(signedIn ? "logout" : "login")}
						>
							<AuthIcon size={17} aria-hidden="true" />
						</button>
					)}
					<button
						type="button"
						className="secondary-button mcp-icon-action mcp-tools-action"
						disabled={busy || !connected}
						aria-label={`${t("Tools & resources")} ${server.name}`}
						title={
							connected
								? t("Tools & resources")
								: needsAuth
									? t("Sign in to view tools and resources.")
									: t("Connect to view tools and resources.")
						}
						onClick={onDetails}
					>
						<Wrench size={17} aria-hidden="true" />
					</button>
					<button
						type="button"
						className="secondary-button mcp-icon-action mcp-reconnect-action"
						aria-label={`${t("Reconnect")} ${server.name}`}
						title={t("Reconnect")}
						disabled={busy || !server.enabled || connecting || needsAuth}
						onClick={() => onAction("reconnect")}
					>
						<RefreshCw size={17} aria-hidden="true" />
					</button>
					<button
						type="button"
						className="secondary-button mcp-icon-action mcp-power-action"
						role="switch"
						aria-checked={server.enabled}
						aria-label={`${t("Server enabled")} ${server.name}`}
						title={server.enabled ? t("Disable") : t("Enable")}
						disabled={busy}
						onClick={onToggle}
					>
						<Power size={17} aria-hidden="true" />
					</button>
					<button
						type="button"
						className="secondary-button mcp-icon-action"
						disabled={busy}
						aria-label={`${t("Edit")} ${server.name}`}
						title={t("Edit")}
						onClick={onEdit}
					>
						<Pencil size={17} aria-hidden="true" />
					</button>
					<button
						type="button"
						className="secondary-button mcp-icon-action mcp-delete-action"
						disabled={busy}
						aria-label={`${t("Delete")} ${server.name}`}
						title={t("Delete")}
						onClick={onRemove}
					>
						<Trash2 size={17} aria-hidden="true" />
					</button>
				</div>
			</footer>
		</article>
	);
}

function McpDialog({
	labelledBy,
	busy,
	onClose,
	children,
	returnFocus,
}: {
	labelledBy: string;
	busy: boolean;
	onClose: () => void;
	children: ReactNode;
	returnFocus: HTMLElement | null;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const previous = returnFocus;
		const dialog = ref.current;
		dialog?.showModal();
		return () => {
			dialog?.close();
			previous?.focus({ preventScroll: true });
		};
	}, []);
	return (
		<dialog
			ref={ref}
			className="mcp-dialog"
			aria-labelledby={labelledBy}
			aria-busy={busy}
			onCancel={(event) => {
				event.preventDefault();
				if (!busy) onClose();
			}}
		>
			{children}
		</dialog>
	);
}

function McpEditor({
	initial,
	existing,
	projectTrusted,
	busy,
	operationError,
	returnFocus,
	onClose,
	onSave,
}: {
	initial: McpSaveRequest;
	existing: boolean;
	projectTrusted: boolean;
	busy: boolean;
	operationError: string;
	returnFocus: HTMLElement | null;
	onClose: () => void;
	onSave: (draft: McpSaveRequest) => Promise<void>;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState(initial.name);
	const [scope, setScope] = useState(initial.scope);
	const [transport, setTransport] = useState("url" in initial.config ? "http" : "stdio");
	const [config, setConfig] = useState(initial.config);
	const [command, setCommand] = useState("command" in initial.config ? initial.config.command : "");
	const [args, setArgs] = useState(
		"command" in initial.config ? JSON.stringify(initial.config.args ?? [], null, 2) : "[]",
	);
	const [cwd, setCwd] = useState("command" in initial.config ? (initial.config.cwd ?? "") : "");
	const [url, setUrl] = useState("url" in initial.config ? initial.config.url : "");
	const [values, setValues] = useState(
		JSON.stringify(
			"url" in initial.config ? (initial.config.headers ?? {}) : (initial.config.env ?? {}),
			null,
			2,
		),
	);
	const [oauth, setOauth] = useState(
		JSON.stringify("url" in initial.config ? (initial.config.oauth ?? {}) : {}, null, 2),
	);
	const [description, setDescription] = useState(initial.config.description ?? "");
	const [exposure, setExposure] = useState(initial.config.exposure ?? "deferred");
	const [timeout, setTimeoutValue] = useState(initial.config.timeout ?? 60);
	const [importText, setImportText] = useState("");
	const [importName, setImportName] = useState("");
	const [error, setError] = useState("");
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const fieldProps = (field: string) => ({
		id: `mcp-editor-${field}`,
		"data-field": field,
		"aria-invalid": Boolean(fieldErrors[field]),
		"aria-describedby": fieldErrors[field] ? `mcp-editor-${field}-error` : undefined,
	});
	const fieldError = (field: string) =>
		fieldErrors[field] ? (
			<span id={`mcp-editor-${field}-error`} className="field-error" role="alert">
				{fieldErrors[field]}
			</span>
		) : null;
	const readJson = (field: string, text: string): unknown => {
		try {
			return JSON.parse(text);
		} catch (reason) {
			throw new FieldValidationError(field, errorToMessage(reason));
		}
	};
	const errorRef = useRef<HTMLParagraphElement>(null);
	useEffect(() => {
		if (error || operationError) errorRef.current?.scrollIntoView({ block: "nearest" });
	}, [error, operationError]);

	const importConfig = () => {
		setFieldErrors({});
		setError("");
		try {
			const parsed = readJson("importText", importText);
			if (!isRecord(parsed) || !isRecord(parsed.mcpServers))
				throw new FieldValidationError(
					"importText",
					t("Import a JSON object containing mcpServers."),
				);
			const entries = Object.entries(parsed.mcpServers);
			if (!entries.length)
				throw new FieldValidationError(
					"importText",
					t("The imported configuration has no servers."),
				);
			const selected =
				entries.find(([key]) => key === importName) ??
				(entries.length === 1 ? entries[0] : undefined);
			if (!selected)
				throw new FieldValidationError(
					"importName",
					t("Enter the server name to import from this configuration."),
				);
			for (const [key, value] of entries) {
				try {
					validateMcpSave({ name: key, scope, config: value, policy: { tools: {} } });
				} catch (reason) {
					throw new FieldValidationError("importText", `${key}: ${errorToMessage(reason)}`);
				}
			}
			const loaded = validateMcpConfig(selected[1]);
			setName(selected[0]);
			setConfig(loaded);
			setTransport("url" in loaded ? "http" : "stdio");
			setCommand("command" in loaded ? loaded.command : "");
			setArgs("command" in loaded ? JSON.stringify(loaded.args ?? [], null, 2) : "[]");
			setCwd("command" in loaded ? (loaded.cwd ?? "") : "");
			setUrl("url" in loaded ? loaded.url : "");
			setValues(
				JSON.stringify("url" in loaded ? (loaded.headers ?? {}) : (loaded.env ?? {}), null, 2),
			);
			setOauth(JSON.stringify("url" in loaded ? (loaded.oauth ?? {}) : {}, null, 2));
			setDescription(loaded.description ?? "");
			setExposure(loaded.exposure ?? "deferred");
			setTimeoutValue(loaded.timeout ?? 60);
			setError("");
		} catch (reason) {
			if (reason instanceof FieldValidationError) {
				setFieldErrors({ [reason.field]: errorToMessage(reason) });
				document.getElementById(`mcp-editor-${reason.field}`)?.focus();
			} else {
				setError(errorToMessage(reason));
			}
		}
	};
	const submit = async () => {
		if (busy) return;
		setFieldErrors({});
		try {
			const base = {
				description: description || undefined,
				exposure,
				timeout,
				enabled: config.enabled,
				toolExposure: config.toolExposure,
			};
			const next =
				transport === "http"
					? { ...base, url, headers: readJson("values", values), oauth: readJson("oauth", oauth) }
					: {
							...base,
							command,
							args: readJson("args", args),
							env: readJson("values", values),
							cwd: cwd || undefined,
						};
			const draft = validateMcpSave({ name, scope, config: next, policy: initial.policy });
			setError("");
			await onSave(draft);
		} catch (reason) {
			if (reason instanceof FieldValidationError) {
				const aliases: Record<string, string> = {
					server: "url",
					environment: "values",
					headers: "values",
					"working directory": "cwd",
					callback: "oauth",
				};
				const field = reason.field.startsWith("OAuth")
					? "oauth"
					: (aliases[reason.field] ?? reason.field);
				setFieldErrors({ [field]: errorToMessage(reason) });
				setError("");
				requestAnimationFrame(() => {
					const input = document.getElementById(`mcp-editor-${field}`);
					const details = input?.closest("details");
					if (details) details.open = true;
					input?.focus();
				});
			} else setError(errorToMessage(reason));
		}
	};
	return (
		<McpDialog
			labelledBy="mcp-editor-heading"
			busy={busy}
			onClose={onClose}
			returnFocus={returnFocus}
		>
			<form
				className="settings-panel mcp-editor"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<header className="mcp-toolbar">
					<h2 id="mcp-editor-heading">{existing ? t("Edit MCP server") : t("Add MCP server")}</h2>
					<button
						className="icon-button"
						type="button"
						aria-label={t("Close")}
						title={t("Close")}
						disabled={busy}
						onClick={onClose}
					>
						<X size={16} />
					</button>
				</header>
				{(error || operationError) && (
					<p ref={errorRef} className="mcp-error" role="alert">
						{error || operationError}
					</p>
				)}
				<fieldset
					disabled={busy}
					onChange={(event) => {
						const field = (event.target as HTMLElement).getAttribute("data-field");
						if (field) setFieldErrors((current) => ({ ...current, [field]: "" }));
					}}
				>
					<div className="mcp-form-grid">
						<label>
							{t("Server name")}
							<input
								{...fieldProps("name")}
								className="field"
								value={name}
								autoFocus={!existing}
								disabled={existing}
								required
								onChange={(event) => setName(event.target.value)}
							/>
							{fieldError("name")}
						</label>
						<label>
							{t("Configuration scope")}
							<Select
								{...fieldProps("scope")}
								className="field"
								value={scope}
								disabled={existing}
								onChange={(event) =>
									setScope(event.target.value === "project" ? "project" : "user")
								}
							>
								<option value="user">{t("User")}</option>
								<option value="project" disabled={!projectTrusted}>
									{t("Project")}
								</option>
							</Select>
							{fieldError("scope")}
						</label>
						<label>
							{t("Transport")}
							<Select
								className="field"
								value={transport}
								onChange={(event) => {
									setTransport(event.target.value);
									setValues("{}");
								}}
							>
								<option value="stdio">stdio</option>
								<option value="http">Streamable HTTP</option>
							</Select>
						</label>
						<label>
							{t("Tool exposure")}
							<Select
								className="field"
								value={exposure}
								onChange={(event) =>
									setExposure(
										event.target.value === "direct"
											? "direct"
											: event.target.value === "hidden"
												? "hidden"
												: "deferred",
									)
								}
							>
								<option value="deferred">{t("Discover on demand")}</option>
								<option value="direct">{t("Always available")}</option>
								<option value="hidden">{t("Hidden")}</option>
							</Select>
						</label>
					</div>
					<label>
						{t("Description")}
						<input
							{...fieldProps("description")}
							className="field"
							value={description}
							autoFocus={existing}
							onChange={(event) => setDescription(event.target.value)}
						/>
						{fieldError("description")}
					</label>
					{transport === "stdio" ? (
						<>
							<label>
								{t("Executable")}
								<input
									{...fieldProps("command")}
									className="field"
									required
									value={command}
									onChange={(event) => setCommand(event.target.value)}
								/>
								{fieldError("command")}
							</label>
							<p className="settings-help">
								{t("Use one executable, not a shell command. Arguments are a JSON array.")}
							</p>
							<label>
								{t("Arguments")}
								<textarea
									{...fieldProps("args")}
									className="field"
									rows={3}
									value={args}
									onChange={(event) => setArgs(event.target.value)}
									spellCheck={false}
								/>
								{fieldError("args")}
							</label>
							<label>
								{t("Working directory")}
								<input
									{...fieldProps("cwd")}
									className="field"
									value={cwd}
									onChange={(event) => setCwd(event.target.value)}
								/>
								{fieldError("cwd")}
							</label>
						</>
					) : (
						<label>
							{t("Server URL")}
							<input
								{...fieldProps("url")}
								className="field"
								type="url"
								required
								value={url}
								onChange={(event) => setUrl(event.target.value)}
							/>
							{fieldError("url")}
						</label>
					)}
					<label>
						{transport === "http" ? t("HTTP headers (JSON)") : t("Environment variables (JSON)")}
						<textarea
							{...fieldProps("values")}
							className="field"
							rows={3}
							value={values}
							onChange={(event) => setValues(event.target.value)}
							spellCheck={false}
						/>
						{fieldError("values")}
					</label>
					<p className="settings-help">
						{t(
							"Prefer ${ENVIRONMENT_VARIABLE} references. Stored secrets are masked and preserved when unchanged.",
						)}
					</p>
					{transport === "http" && (
						<details>
							<summary>{t("OAuth settings")}</summary>
							<p className="settings-help">
								{t(
									"OAuth is automatic when no Authorization header is supplied. Configure a registered client here if required.",
								)}
							</p>
							<label>
								{t("OAuth configuration (JSON)")}
								<textarea
									{...fieldProps("oauth")}
									className="field"
									rows={4}
									value={oauth}
									onChange={(event) => setOauth(event.target.value)}
									spellCheck={false}
								/>
								{fieldError("oauth")}
							</label>
						</details>
					)}
					<label>
						{t("Request timeout (seconds)")}
						<input
							{...fieldProps("timeout")}
							className="field"
							type="number"
							min={1}
							max={600}
							value={timeout}
							onChange={(event) => setTimeoutValue(Number(event.target.value))}
						/>
						{fieldError("timeout")}
					</label>
					{!existing && (
						<details>
							<summary>{t("Import MCP configuration")}</summary>
							<label>
								{t("Configuration JSON")}
								<textarea
									{...fieldProps("importText")}
									className="field"
									rows={5}
									value={importText}
									onChange={(event) => setImportText(event.target.value)}
									spellCheck={false}
								/>
								{fieldError("importText")}
							</label>
							<label>
								{t("Server name to import")}
								<input
									{...fieldProps("importName")}
									className="field"
									value={importName}
									onChange={(event) => setImportName(event.target.value)}
								/>
								{fieldError("importName")}
							</label>
							<p className="settings-help">
								{t(
									"Import one server at a time, review its fields, then save. Imported tools remain blocked until approved.",
								)}
							</p>
							<button
								type="button"
								className="secondary-button mcp-icon-action"
								aria-label={t("Load configuration")}
								title={t("Load configuration")}
								onClick={importConfig}
							>
								<FileInput size={17} aria-hidden="true" />
							</button>
						</details>
					)}
					<p className="mcp-notice">
						{t(
							"A local server runs with your OS account. MCP is not a sandbox. New tools are blocked until you review and approve them.",
						)}
					</p>
					<div className="mcp-actions">
						<button
							type="button"
							className="secondary-button mcp-icon-action"
							aria-label={t("Cancel")}
							title={t("Cancel")}
							onClick={onClose}
						>
							<X size={17} aria-hidden="true" />
						</button>
						<button
							className="command-button"
							type="submit"
							aria-label={busy ? t("Saving…") : t("Save")}
							title={busy ? t("Saving…") : t("Save")}
						>
							{busy ? (
								<RefreshCw size={17} className="animate-spin" aria-hidden="true" />
							) : (
								<Save size={17} aria-hidden="true" />
							)}
							<span>{busy ? t("Saving…") : t("Save")}</span>
						</button>
					</div>
				</fieldset>
			</form>
		</McpDialog>
	);
}

function ToolDescription({ name, description }: { name: string; description: string }) {
	const { t } = useTranslation();
	const id = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const anchor = `--mcp-description-${id.replace(/:/g, "")}`;
	const dismiss = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== "Escape" || !panel.current?.matches(":popover-open")) return;
		event.preventDefault();
		event.stopPropagation();
		panel.current.hidePopover();
		trigger.current?.focus({ preventScroll: true });
	};
	return (
		<span className="mcp-tool-description">
			<button
				ref={trigger}
				type="button"
				className="mcp-description-trigger"
				popoverTarget={id}
				style={{ anchorName: anchor }}
				aria-label={`${name} ${t("Description")}`}
				title={t("Description")}
				onKeyDown={dismiss}
			>
				<Info size={16} aria-hidden="true" />
			</button>
			<div
				id={id}
				ref={panel}
				tabIndex={-1}
				popover="auto"
				className="mcp-tool-description-panel"
				style={{ positionAnchor: anchor }}
				onKeyDown={dismiss}
				onToggle={(event) => {
					if (event.newState === "open") panel.current?.focus({ preventScroll: true });
				}}
			>
				<strong>{name}</strong>
				<p>{description}</p>
			</div>
		</span>
	);
}

function McpDetails({
	server,
	busy,
	operationError,
	returnFocus,
	onClose,
	onSave,
}: {
	server: McpServerInfo;
	busy: boolean;
	operationError: string;
	returnFocus: HTMLElement | null;
	onClose: () => void;
	onSave: (draft: McpSaveRequest) => Promise<boolean>;
}) {
	const { t } = useTranslation();
	const [permissions, setPermissions] = useState<Record<string, McpPermission>>({});
	const [exposures, setExposures] = useState<Record<string, "deferred" | "direct" | "hidden">>({});
	const [error, setError] = useState("");
	const errorRef = useRef<HTMLParagraphElement>(null);
	useEffect(() => {
		if (error || operationError) errorRef.current?.scrollIntoView({ block: "nearest" });
	}, [error, operationError]);
	const [resource, setResource] = useState("");
	const [uri, setUri] = useState("");
	const [cursor, setCursor] = useState("");
	const [reading, setReading] = useState(false);
	const target: McpTarget = {
		name: server.name,
		scope: server.scope === "project" ? "project" : "user",
	};
	const save = async () => {
		try {
			const draft = await getRhyzaBridge()!.mcpEdit(target);
			draft.policy.tools = { ...draft.policy.tools, ...permissions };
			draft.config.toolExposure = { ...draft.config.toolExposure, ...exposures };
			if (await onSave(draft)) {
				setPermissions({});
				setExposures({});
			}
		} catch (reason) {
			setError(errorToMessage(reason));
		}
	};
	const read = async (action: "list" | "templates" | "read") => {
		setReading(true);
		setError("");
		try {
			setResource(
				await getRhyzaBridge()!.mcpResources({
					...target,
					action,
					...(action === "read" ? { uri } : cursor ? { cursor } : {}),
				}),
			);
		} catch (reason) {
			setError(errorToMessage(reason));
		} finally {
			setReading(false);
		}
	};
	return (
		<McpDialog
			labelledBy="mcp-details-heading"
			busy={busy || reading}
			onClose={onClose}
			returnFocus={returnFocus}
		>
			<div className="settings-panel mcp-details">
				<header className="mcp-toolbar">
					<h2 id="mcp-details-heading">
						{server.name}: {t("Tools & resources")}
					</h2>
					<button
						type="button"
						className="icon-button"
						disabled={busy || reading}
						onClick={onClose}
						aria-label={t("Close")}
						title={t("Close")}
					>
						<X size={16} />
					</button>
				</header>
				{(error || operationError) && (
					<p ref={errorRef} className="mcp-error" role="alert">
						{error || operationError}
					</p>
				)}
				<p className="mcp-notice">
					{t(
						"Server annotations are hints, not permissions. Approve only tools you have reviewed. Read access can expose local or remote data; write access requires a writable chat. Git workspaces must be isolated; non-Git folders are edited directly. Remote changes are not isolated.",
					)}
				</p>
				{server.tools.length === 0 && (
					<p className="settings-help">
						{t("No tools discovered. Connect or sign in to this server first.")}
					</p>
				)}
				<div className="mcp-tools">
					{server.tools.map((tool) => (
						<div className="mcp-tool" key={tool.name}>
							<div className="mcp-tool-identity">
								<div className="mcp-tool-name">
									<strong title={tool.name}>{tool.name}</strong>
									{tool.description && (
										<ToolDescription name={tool.name} description={tool.description} />
									)}
								</div>
								<div className="mcp-tool-hints">
									{tool.readOnlyHint !== undefined && (
										<small className={`mcp-hint ${tool.readOnlyHint ? "is-read" : "is-write"}`}>
											{tool.readOnlyHint ? (
												<BookOpen size={12} aria-hidden="true" />
											) : (
												<Pencil size={12} aria-hidden="true" />
											)}
											{t("Server read-only hint")}: {String(tool.readOnlyHint)}
										</small>
									)}
									{tool.destructiveHint && (
										<small className="mcp-hint is-destructive">
											<TriangleAlert size={12} aria-hidden="true" />
											{t("Server marks this tool as destructive.")}
										</small>
									)}
								</div>
							</div>
							<label>
								{t("Permission")}
								<Select
									className="field"
									aria-label={`${tool.name} ${t("Permission")}`}
									disabled={busy}
									value={permissions[tool.name] ?? tool.permission}
									onChange={(event) =>
										setPermissions({
											...permissions,
											[tool.name]:
												event.target.value === "read"
													? "read"
													: event.target.value === "write"
														? "write"
														: "blocked",
										})
									}
								>
									<option value="blocked">{t("Blocked")}</option>
									<option value="read">{t("Approved read")}</option>
									<option value="write">{t("Approved write")}</option>
								</Select>
							</label>
							<label>
								{t("Tool exposure")}
								<Select
									className="field"
									aria-label={`${tool.name} ${t("Tool exposure")}`}
									disabled={busy}
									value={exposures[tool.name] ?? tool.exposure}
									onChange={(event) =>
										setExposures({
											...exposures,
											[tool.name]:
												event.target.value === "direct"
													? "direct"
													: event.target.value === "hidden"
														? "hidden"
														: "deferred",
										})
									}
								>
									<option value="deferred">{t("Discover on demand")}</option>
									<option value="direct">{t("Always available")}</option>
									<option value="hidden">{t("Hidden")}</option>
								</Select>
							</label>
						</div>
					))}
				</div>
				<button
					type="button"
					className="command-button"
					aria-label={busy ? t("Saving…") : t("Save tool settings")}
					title={busy ? t("Saving…") : t("Save tool settings")}
					disabled={busy || (!Object.keys(permissions).length && !Object.keys(exposures).length)}
					onClick={() => void save()}
				>
					{busy ? (
						<RefreshCw size={17} className="animate-spin" aria-hidden="true" />
					) : (
						<Save size={17} aria-hidden="true" />
					)}
					<span>{busy ? t("Saving…") : t("Save")}</span>
				</button>
				<details className="mcp-resources">
					<summary>{t("Resources")}</summary>
					<p className="settings-help">
						{t(
							"List resources or URI templates, then read a text preview. Paste nextCursor to continue a list.",
						)}
					</p>
					<label>
						{t("Resource cursor")}
						<input
							className="field"
							value={cursor}
							onChange={(event) => setCursor(event.target.value)}
						/>
					</label>
					<div className="mcp-actions">
						<button
							className="secondary-button mcp-icon-action"
							type="button"
							aria-label={t("List resources")}
							title={t("List resources")}
							disabled={busy || reading || server.state !== "connected"}
							onClick={() => void read("list")}
						>
							<List size={17} aria-hidden="true" />
						</button>
						<button
							className="secondary-button mcp-icon-action"
							type="button"
							aria-label={t("List templates")}
							title={t("List templates")}
							disabled={busy || reading || server.state !== "connected"}
							onClick={() => void read("templates")}
						>
							<Files size={17} aria-hidden="true" />
						</button>
					</div>
					<label>
						{t("Resource URI")}
						<input className="field" value={uri} onChange={(event) => setUri(event.target.value)} />
					</label>
					<button
						className="secondary-button mcp-icon-action"
						type="button"
						aria-label={reading ? t("Loading…") : t("Read resource")}
						title={reading ? t("Loading…") : t("Read resource")}
						disabled={busy || reading || server.state !== "connected" || !uri.trim()}
						onClick={() => void read("read")}
					>
						<BookOpen size={17} aria-hidden="true" />
					</button>
					{resource && <pre className="mcp-resource-preview">{resource}</pre>}
				</details>
			</div>
		</McpDialog>
	);
}

function McpConfirmation({
	kind,
	name,
	busy,
	error,
	onClose,
	onConfirm,
}: {
	kind: "trust" | "revoke" | "remove";
	name?: string;
	busy: boolean;
	error: string;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const { t } = useTranslation();
	return (
		<ConfirmationDialog
			className="mcp-confirmation"
			tone={kind === "trust" ? "accent" : kind === "revoke" ? "warning" : "danger"}
			busy={busy}
			error={error}
			onClose={onClose}
			onConfirm={onConfirm}
			title={
				kind === "trust"
					? t("Trust project MCP?")
					: kind === "revoke"
						? t("Revoke project trust?")
						: `${t("Delete MCP server?")} ${name}`
			}
			description={
				kind === "trust"
					? t(
							"Project configuration can launch programs and contact external services using your OS account. Trust only repositories you have reviewed. Tool permissions still require separate approval.",
						)
					: kind === "revoke"
						? t(
								"Project servers will disconnect and saved tool approvals for this workspace will be cleared. Chats are kept.",
							)
						: t(
								"This removes the server configuration and disconnects it. Files, chats and knowledge are kept.",
							)
			}
			confirmLabel={
				kind === "trust" ? t("Trust project") : kind === "revoke" ? t("Revoke trust") : t("Delete")
			}
		/>
	);
}
