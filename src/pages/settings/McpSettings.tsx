import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Plus, RefreshCw, Server, ShieldAlert, Trash2, X } from "lucide-react";
import { getRhyzaBridge } from "../../hooks/useRhyzaBridge";
import { useTranslation } from "../../i18n";
import { useAppStore } from "../../store";
import { errorToMessage, isRecord } from "../../shared/value";
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
	const edit = (server: McpServerInfo) =>
		void operate("edit", async () => {
			const draft = await getRhyzaBridge()!.mcpEdit(target(server));
			setDetail(undefined);
			setEditor({ draft, existing: true });
		});
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
			{error && (
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
					<div className="settings-panel mcp-trust">
						<ShieldAlert size={18} aria-hidden="true" />
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
							className="secondary-button"
							disabled={Boolean(busy)}
							onClick={() =>
								setConfirmation({ kind: overview.projectTrusted ? "revoke" : "trust" })
							}
						>
							{overview.projectTrusted ? t("Revoke trust") : t("Trust project")}
						</button>
					</div>
					<div className="mcp-toolbar">
						<h2>{t("Servers")}</h2>
						<div className="mcp-actions">
							<button
								type="button"
								className="secondary-button"
								onClick={() => {
									setError("");
									void load();
								}}
								disabled={Boolean(busy)}
							>
								<RefreshCw size={14} aria-hidden="true" />
								{t("Refresh")}
							</button>
							<button
								type="button"
								className="command-button"
								disabled={Boolean(busy)}
								onClick={() => {
									setDetail(undefined);
									setEditor({ draft: structuredClone(defaultServer), existing: false });
								}}
							>
								<Plus size={14} aria-hidden="true" />
								{t("Add server")}
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
							<div className="settings-panel mcp-server" key={`${server.scope}:${server.name}`}>
								<div className="mcp-server-heading">
									<Server size={17} aria-hidden="true" />
									<div>
										<strong>{server.name}</strong>
										<span className="settings-help">
											{server.scope === "user" ? t("User") : t("Project")} /{" "}
											{server.transport === "stdio" ? "stdio" : "Streamable HTTP"}
										</span>
									</div>
									<span className={`mcp-state is-${server.state}`} role="status">
										{t(stateLabels[server.state])}
									</span>
								</div>
								{server.error && (
									<p className="mcp-error" role="alert">
										{server.error}
									</p>
								)}
								<p className="settings-help">
									{server.tools.length} {t("tools")} / {server.connections}{" "}
									{t("active connections")} / {server.exposure}
								</p>
								<div className="mcp-actions">
									<button
										type="button"
										className="secondary-button"
										disabled={Boolean(busy)}
										onClick={() => {
											setEditor(undefined);
											setDetail(server);
										}}
									>
										{t("Tools & resources")}
									</button>
									<button
										type="button"
										className="secondary-button"
										disabled={Boolean(busy) || !server.enabled}
										onClick={() => action(server, "reconnect")}
									>
										{t("Reconnect")}
									</button>
									{server.oauth && (
										<button
											type="button"
											className="secondary-button"
											disabled={Boolean(busy) || !server.enabled}
											onClick={() => action(server, "login")}
										>
											{t("Sign in")}
										</button>
									)}
									{server.oauth && (
										<button
											type="button"
											className="secondary-button"
											disabled={Boolean(busy) || !server.enabled}
											onClick={() => action(server, "logout")}
										>
											{t("Sign out")}
										</button>
									)}
									<button
										type="button"
										className="secondary-button"
										disabled={Boolean(busy)}
										onClick={() => toggle(server)}
									>
										{server.enabled ? t("Disable") : t("Enable")}
									</button>
									<button
										type="button"
										className="icon-button"
										disabled={Boolean(busy)}
										aria-label={`${t("Edit")} ${server.name}`}
										onClick={() => edit(server)}
									>
										<Pencil size={15} aria-hidden="true" />
									</button>
									<button
										type="button"
										className="icon-button"
										disabled={Boolean(busy)}
										aria-label={`${t("Delete")} ${server.name}`}
										onClick={() => setConfirmation({ kind: "remove", target: target(server) })}
									>
										<Trash2 size={15} aria-hidden="true" />
									</button>
								</div>
							</div>
						))}
					</div>
				</>
			)}
			{busy === "login" && (
				<div className="mcp-notice" role="status">
					<p>{t("Waiting for browser sign-in…")}</p>
					{authUrl && (
						<button
							type="button"
							className="secondary-button"
							onClick={() =>
								void getRhyzaBridge()!
									.openExternal({ url: authUrl })
									.catch((reason) => setError(errorToMessage(reason)))
							}
						>
							{t("Open sign-in page")}
						</button>
					)}
					<button
						type="button"
						className="secondary-button"
						onClick={() => {
							const server = loginTarget.current;
							if (server)
								void getRhyzaBridge()!
									.mcpAction({ ...server, action: "cancel-login" })
									.catch((reason) => setError(errorToMessage(reason)));
						}}
					>
						{t("Cancel sign-in")}
					</button>
				</div>
			)}
			{editor && (
				<McpEditor
					key={`${editor.draft.scope}:${editor.draft.name}`}
					initial={editor.draft}
					existing={editor.existing}
					projectTrusted={overview?.projectTrusted === true}
					busy={Boolean(busy)}
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

function McpEditor({
	initial,
	existing,
	projectTrusted,
	busy,
	onClose,
	onSave,
}: {
	initial: McpSaveRequest;
	existing: boolean;
	projectTrusted: boolean;
	busy: boolean;
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
	const formRef = useRef<HTMLFormElement>(null);
	useEffect(() => {
		formRef.current?.scrollIntoView({ block: "nearest" });
	}, []);

	const importConfig = () => {
		try {
			const parsed: unknown = JSON.parse(importText);
			if (!isRecord(parsed) || !isRecord(parsed.mcpServers))
				throw new Error(t("Import a JSON object containing mcpServers."));
			const entries = Object.entries(parsed.mcpServers);
			if (!entries.length) throw new Error(t("The imported configuration has no servers."));
			for (const [key, value] of entries)
				validateMcpSave({ name: key, scope, config: value, policy: { tools: {} } });
			const selected =
				entries.find(([key]) => key === importName) ??
				(entries.length === 1 ? entries[0] : undefined);
			if (!selected) throw new Error(t("Enter the server name to import from this configuration."));
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
			setError(errorToMessage(reason));
		}
	};
	const submit = async () => {
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
					? { ...base, url, headers: JSON.parse(values), oauth: JSON.parse(oauth) }
					: {
							...base,
							command,
							args: JSON.parse(args),
							env: JSON.parse(values),
							cwd: cwd || undefined,
						};
			const draft = validateMcpSave({ name, scope, config: next, policy: initial.policy });
			setError("");
			await onSave(draft);
		} catch (reason) {
			setError(errorToMessage(reason));
		}
	};
	return (
		<form
			ref={formRef}
			className="settings-panel mcp-editor"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<header className="mcp-toolbar">
				<h2>{existing ? t("Edit MCP server") : t("Add MCP server")}</h2>
				<button
					className="icon-button"
					type="button"
					aria-label={t("Close")}
					disabled={busy}
					onClick={onClose}
				>
					<X size={16} />
				</button>
			</header>
			{error && (
				<p className="mcp-error" role="alert">
					{error}
				</p>
			)}
			<fieldset disabled={busy}>
				<div className="mcp-form-grid">
					<label>
						{t("Server name")}
						<input
							className="field"
							value={name}
							autoFocus
							disabled={existing}
							required
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
					<label>
						{t("Configuration scope")}
						<select
							className="field"
							value={scope}
							disabled={existing}
							onChange={(event) => setScope(event.target.value === "project" ? "project" : "user")}
						>
							<option value="user">{t("User")}</option>
							<option value="project" disabled={!projectTrusted}>
								{t("Project")}
							</option>
						</select>
					</label>
					<label>
						{t("Transport")}
						<select
							className="field"
							value={transport}
							onChange={(event) => {
								setTransport(event.target.value);
								setValues("{}");
							}}
						>
							<option value="stdio">stdio</option>
							<option value="http">Streamable HTTP</option>
						</select>
					</label>
					<label>
						{t("Tool exposure")}
						<select
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
						</select>
					</label>
				</div>
				<label>
					{t("Description")}
					<input
						className="field"
						value={description}
						onChange={(event) => setDescription(event.target.value)}
					/>
				</label>
				{transport === "stdio" ? (
					<>
						<label>
							{t("Executable")}
							<input
								className="field"
								required
								value={command}
								onChange={(event) => setCommand(event.target.value)}
							/>
						</label>
						<p className="settings-help">
							{t("Use one executable, not a shell command. Arguments are a JSON array.")}
						</p>
						<label>
							{t("Arguments")}
							<textarea
								className="field"
								rows={3}
								value={args}
								onChange={(event) => setArgs(event.target.value)}
								spellCheck={false}
							/>
						</label>
						<label>
							{t("Working directory")}
							<input
								className="field"
								value={cwd}
								onChange={(event) => setCwd(event.target.value)}
							/>
						</label>
					</>
				) : (
					<label>
						{t("Server URL")}
						<input
							className="field"
							type="url"
							required
							value={url}
							onChange={(event) => setUrl(event.target.value)}
						/>
					</label>
				)}
				<label>
					{transport === "http" ? t("HTTP headers (JSON)") : t("Environment variables (JSON)")}
					<textarea
						className="field"
						rows={3}
						value={values}
						onChange={(event) => setValues(event.target.value)}
						spellCheck={false}
					/>
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
								className="field"
								rows={4}
								value={oauth}
								onChange={(event) => setOauth(event.target.value)}
								spellCheck={false}
							/>
						</label>
					</details>
				)}
				<label>
					{t("Request timeout (seconds)")}
					<input
						className="field"
						type="number"
						min={1}
						max={600}
						value={timeout}
						onChange={(event) => setTimeoutValue(Number(event.target.value))}
					/>
				</label>
				{!existing && (
					<details>
						<summary>{t("Import MCP configuration")}</summary>
						<label>
							{t("Configuration JSON")}
							<textarea
								className="field"
								rows={5}
								value={importText}
								onChange={(event) => setImportText(event.target.value)}
								spellCheck={false}
							/>
						</label>
						<label>
							{t("Server name to import")}
							<input
								className="field"
								value={importName}
								onChange={(event) => setImportName(event.target.value)}
							/>
						</label>
						<p className="settings-help">
							{t(
								"Import one server at a time, review its fields, then save. Imported tools remain blocked until approved.",
							)}
						</p>
						<button type="button" className="secondary-button" onClick={importConfig}>
							{t("Load configuration")}
						</button>
					</details>
				)}
				<p className="mcp-notice">
					{t(
						"A local server runs with your OS account. MCP is not a sandbox. New tools are blocked until you review and approve them.",
					)}
				</p>
				<div className="mcp-actions">
					<button type="button" className="secondary-button" onClick={onClose}>
						{t("Cancel")}
					</button>
					<button className="command-button" type="submit">
						{busy ? t("Saving…") : t("Save")}
					</button>
				</div>
			</fieldset>
		</form>
	);
}

function McpDetails({
	server,
	busy,
	onClose,
	onSave,
}: {
	server: McpServerInfo;
	busy: boolean;
	onClose: () => void;
	onSave: (draft: McpSaveRequest) => Promise<boolean>;
}) {
	const { t } = useTranslation();
	const [permissions, setPermissions] = useState<Record<string, McpPermission>>({});
	const [exposures, setExposures] = useState<Record<string, "deferred" | "direct" | "hidden">>({});
	const [error, setError] = useState("");
	const [resource, setResource] = useState("");
	const [uri, setUri] = useState("");
	const [cursor, setCursor] = useState("");
	const [reading, setReading] = useState(false);
	const target: McpTarget = {
		name: server.name,
		scope: server.scope === "project" ? "project" : "user",
	};
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		ref.current?.scrollIntoView({ block: "nearest" });
	}, []);
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
		<div ref={ref} className="settings-panel mcp-details">
			<header className="mcp-toolbar">
				<h2>
					{server.name}: {t("Tools & resources")}
				</h2>
				<button
					type="button"
					className="icon-button"
					disabled={busy || reading}
					onClick={onClose}
					aria-label={t("Close")}
				>
					<X size={16} />
				</button>
			</header>
			{error && (
				<p className="mcp-error" role="alert">
					{error}
				</p>
			)}
			<p className="mcp-notice">
				{t(
					"Server annotations are hints, not permissions. Approve only tools you have reviewed. Read access can expose local or remote data; write access requires a writable isolated chat, but remote changes are not isolated.",
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
						<div>
							<strong>{tool.name}</strong>
							<p className="settings-help">{tool.description}</p>
							{tool.readOnlyHint !== undefined && (
								<small>
									{t("Server read-only hint")}: {String(tool.readOnlyHint)}
								</small>
							)}
							{tool.destructiveHint && <small>{t("Server marks this tool as destructive.")}</small>}
						</div>
						<label>
							{t("Permission")}
							<select
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
							</select>
						</label>
						<label>
							{t("Tool exposure")}
							<select
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
							</select>
						</label>
					</div>
				))}
			</div>
			<button
				type="button"
				className="command-button"
				disabled={busy || (!Object.keys(permissions).length && !Object.keys(exposures).length)}
				onClick={() => void save()}
			>
				{t("Save tool settings")}
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
						className="secondary-button"
						type="button"
						disabled={busy || reading}
						onClick={() => void read("list")}
					>
						{t("List resources")}
					</button>
					<button
						className="secondary-button"
						type="button"
						disabled={busy || reading}
						onClick={() => void read("templates")}
					>
						{t("List templates")}
					</button>
				</div>
				<label>
					{t("Resource URI")}
					<input className="field" value={uri} onChange={(event) => setUri(event.target.value)} />
				</label>
				<button
					className="secondary-button"
					type="button"
					disabled={busy || reading || !uri.trim()}
					onClick={() => void read("read")}
				>
					{reading ? t("Loading…") : t("Read resource")}
				</button>
				{resource && <pre className="mcp-resource-preview">{resource}</pre>}
			</details>
		</div>
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
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const dialog = ref.current;
		dialog?.showModal();
		return () => {
			dialog?.close();
			previous?.focus();
		};
	}, []);
	return (
		<dialog
			ref={ref}
			className="mcp-confirmation"
			aria-labelledby="mcp-confirmation-heading"
			aria-describedby="mcp-confirmation-copy"
			onCancel={(event) => {
				event.preventDefault();
				if (!busy) onClose();
			}}
		>
			<h2 id="mcp-confirmation-heading">
				{kind === "trust"
					? t("Trust project MCP?")
					: kind === "revoke"
						? t("Revoke project trust?")
						: `${t("Delete MCP server?")} ${name}`}
			</h2>
			<p id="mcp-confirmation-copy">
				{kind === "trust"
					? t(
							"Project configuration can launch programs and contact external services using your OS account. Trust only repositories you have reviewed. Tool permissions still require separate approval.",
						)
					: kind === "revoke"
						? t(
								"Project servers will disconnect and saved tool approvals for this workspace will be cleared. Chats are kept.",
							)
						: t(
								"This removes the server configuration and disconnects it. Files, chats and knowledge are kept.",
							)}
			</p>
			{error && (
				<p className="mcp-error" role="alert">
					{error}
				</p>
			)}
			<div className="mcp-actions">
				<button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
					{t("Cancel")}
				</button>
				<button type="button" className="command-button" disabled={busy} onClick={onConfirm}>
					{kind === "trust"
						? t("Trust project")
						: kind === "revoke"
							? t("Revoke trust")
							: t("Delete")}
				</button>
			</div>
		</dialog>
	);
}
