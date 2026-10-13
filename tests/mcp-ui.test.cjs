const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const projectRoot = path.resolve(__dirname, "..");

if (!process.versions.electron) {
	const { spawn } = require("node:child_process");
	const test = require("node:test");
	test(
		"MCP desktop settings manage servers, permissions, trust and resource previews in both themes",
		{ timeout: 120_000 },
		async () => {
			const root = await mkdtemp(path.join(os.tmpdir(), "rhyza-mcp-ui-"));
			const env = {
				...process.env,
				RHYZA_MCP_UI_ROOT: root,
				RHYZA_TEST_NODE: process.execPath,
				PI_CODING_AGENT_DIR: path.join(root, "agent"),
				ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
			};
			delete env.ELECTRON_RUN_AS_NODE;
			try {
				const child = spawn(require("electron"), [__filename], { cwd: projectRoot, env });
				let output = "";
				child.stdout.on("data", (data) => {
					output += data;
				});
				child.stderr.on("data", (data) => {
					output += data;
				});
				const timeout = setTimeout(() => child.kill(), 110_000);
				try {
					const code = await new Promise((resolve, reject) => {
						child.on("error", reject);
						child.on("close", resolve);
					});
					assert.equal(code, 0, output);
				} finally {
					clearTimeout(timeout);
				}
			} finally {
				await rm(root, { recursive: true, force: true, maxRetries: 5 });
			}
		},
	);
} else {
	const { app, BrowserWindow, ipcMain } = require("electron");
	const root = process.env.RHYZA_MCP_UI_ROOT;
	app.setPath("userData", path.join(root, "profile"));
	app.on("window-all-closed", () => {});
	let browser;
	let vite;
	let service;
	const errors = [];
	const host = async (code) => {
		try {
			return await browser.webContents.executeJavaScript(code);
		} catch (error) {
			throw new Error(`Renderer script failed: ${code}\n${errors.join("\n")}`, { cause: error });
		}
	};
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const until = async (code, label) => {
		for (let index = 0; index < 200; index++) {
			if (await host(code)) return;
			await sleep(30);
		}
		throw new Error(
			`Timed out: ${label}\n${await host('document.querySelector(".mcp-settings")?.textContent')}`,
		);
	};
	const click = async (selector) => {
		await until(
			`document.querySelector(${JSON.stringify(selector)})?.checkVisibility({ visibilityProperty: true }) && !document.querySelector(${JSON.stringify(selector)}).matches(":disabled")`,
			`visible and enabled ${selector}`,
		);
		await host(`(() => {
			const element = document.querySelector(${JSON.stringify(selector)});
			element.focus();
			element.click();
		})()`);
		await sleep(50);
	};
	const field = async (label, value) => {
		await until(
			`[...document.querySelectorAll(".mcp-settings label")].some(item => item.childNodes[0]?.textContent.trim() === ${JSON.stringify(label)} && item.querySelector(".ui-select-trigger,input,textarea")?.checkVisibility({ visibilityProperty: true }) && !item.querySelector(".ui-select-trigger,input,textarea").matches(":disabled"))`,
			`editable ${label}`,
		);
		const dropdown = await host(`(() => {
			const label = [...document.querySelectorAll(".mcp-settings label")].find(item => item.childNodes[0]?.textContent.trim() === ${JSON.stringify(label)});
			const trigger = label.querySelector(".ui-select-trigger");
			if (trigger) { trigger.click(); return true; }
			const input = label.querySelector("input,textarea,select");
			const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
			Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ${JSON.stringify(value)});
			input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
			return false;
		})()`);
		if (dropdown) await click(`.ui-select-popup [role="option"][data-value="${value}"]`);
		await sleep(40);
	};
	const textButton = async (text, scope = ".mcp-settings") => {
		const match = `item => (item.textContent.trim() === ${JSON.stringify(text)} || item.title === ${JSON.stringify(text)}) && item.checkVisibility({ visibilityProperty: true }) && !item.matches(":disabled")`;
		await until(
			`[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].some(${match})`,
			`visible and enabled ${text}`,
		);
		await host(
			`(() => { const button = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(${match}); if (!button) throw new Error("Missing button"); button.focus(); button.click(); })()`,
		);
		await sleep(50);
	};
	const checkAppearance = async (label) => {
		await sleep(180);
		assert(
			await host(`(() => {
				const root = document.querySelector(".mcp-settings");
				const card = document.querySelector(".mcp-server");
				const heading = card.querySelector(".mcp-server-heading");
				return getComputedStyle(root).borderTopWidth === "0px"
					&& parseFloat(getComputedStyle(card).paddingTop) >= 16
					&& heading.getBoundingClientRect().left - card.getBoundingClientRect().left >= 16;
			})()`),
			`${label}: each server has its own padded card, not an unpadded outer frame.`,
		);
		assert(
			await host(`(() => {
				const selectors = ".mcp-icon-action";
				return [...document.querySelectorAll(selectors)].every(element => {
					const rect = element.getBoundingClientRect();
					return element.title && element.getAttribute("aria-label")
						&& !element.textContent.trim() && element.querySelector("svg")
						&& (!element.checkVisibility({ visibilityProperty: true }) || (rect.width >= (element.closest(".mcp-server-actions") ? 32 : 40) && rect.height >= 40));
				});
			})()`),
			`${label}: icon actions have names, tooltips and usable targets.`,
		);
		assert(
			await host(`(() => {
				const group = document.querySelector(".mcp-server-actions");
				const rects = [...group.querySelectorAll("button")].map(button => button.getBoundingClientRect());
				return rects.every((rect, index) => !index || (
					Math.abs(rect.top - rects[0].top) < 1
					&& rect.left - rects[index - 1].right >= 7.9
				)) && Math.abs(rects.at(-1).right - group.getBoundingClientRect().right) < 1;
			})()`),
			`${label}: all server actions share one right-aligned row with at least 8px spacing.`,
		);
		const contrasts = await host(`(() => {
			const rgb = color => color.match(/[\\d.]+/g)?.map(Number) ?? [];
			const luminance = color => rgb(color).slice(0, 3)
				.map(value => value / 255)
				.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
				.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
			return [...document.querySelectorAll(
				".mcp-server h3, .mcp-server-meta, .mcp-server-metrics, .mcp-state, .mcp-sign-in-hint strong, .mcp-sign-in-hint p, .mcp-icon-action, .mcp-hint, .ui-select-trigger"
			)].filter(element => element.checkVisibility({ visibilityProperty: true }) && !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true").map(element => {
				let background = element;
				while (background.parentElement && (!rgb(getComputedStyle(background).backgroundColor).length || rgb(getComputedStyle(background).backgroundColor)[3] === 0))
					background = background.parentElement;
				const foreground = luminance(getComputedStyle(element).color);
				const behind = luminance(getComputedStyle(background).backgroundColor);
				return {
					label: element.getAttribute("aria-label") || element.textContent.trim(),
					ratio: (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05),
				};
			});
		})()`);
		for (const { label: text, ratio } of contrasts) {
			assert(ratio >= 4.5, `${label}: ${text} contrast ${ratio.toFixed(2)} >= 4.5.`);
		}
		assert(
			await host(`(() => {
				const content = document.querySelector(".settings-content");
				return content.scrollWidth <= content.clientWidth + 1
					&& document.documentElement.scrollWidth <= innerWidth + 1;
			})()`),
			`${label}: no horizontal overflow in settings.`,
		);
	};
	const checkDialog = async () => {
		const result = await host(`(() => {
				const dialog = document.querySelector(".mcp-dialog");
				const rect = dialog.getBoundingClientRect();
				const header = dialog.querySelector("header").getBoundingClientRect();
				return { valid: dialog.open && dialog.matches(":modal")
					&& document.getElementById(dialog.getAttribute("aria-labelledby"))
					&& dialog.scrollWidth <= dialog.clientWidth + 1
					&& rect.left >= 15 && rect.right <= innerWidth - 15
					&& rect.top >= 15 && rect.bottom <= innerHeight - 15
					&& header.top >= rect.top && header.bottom <= rect.bottom,
					bounds: rect.toJSON(), viewport: [innerWidth, innerHeight],
					scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth };
			})()`);
		assert(
			result.valid,
			`Editor and inspector are labelled, responsive native modal dialogs: ${JSON.stringify(result)}`,
		);
	};
	const screenshot = async (name) => {
		if (!process.env.RHYZA_UI_SCREENSHOT_DIR) return;
		await sleep(180);
		await writeFile(
			path.join(process.env.RHYZA_UI_SCREENSHOT_DIR, `${name}.png`),
			(await browser.webContents.capturePage()).toPNG(),
		);
	};
	async function run() {
		await app.whenReady();
		const load = (...segments) =>
			import(pathToFileURL(path.join(projectRoot, "dist-electron", ...segments)).href);
		const { McpService } = await load("electron", "main", "mcp-service.js");
		const { ipcChannels } = await load("src", "shared", "ipc.js");
		const { validateMcpSave, validateMcpTarget, validateMcpAction, validateMcpResource } =
			await load("src", "shared", "mcp.js");
		const workspace = root;
		service = new McpService(path.join(root, "agent"), path.join(root, "data"), (event) =>
			browser?.webContents.send(ipcChannels.mcpEvent, event),
		);
		let saveFailure = false;
		let removeFailure = false;
		let previewServer;
		let finishPreviewLogin;
		let previewLoginCancelled = false;
		const authError = "MCP OAuth authorization requires user interaction";
		const previewActions = [];
		const openedUrls = [];
		const longToolDescription =
			"Review this tool before approving it. Its description must remain available without changing the row height. ".repeat(
				30,
			);
		ipcMain.handle(ipcChannels.mcpList, async () => {
			const overview = await service.overview(workspace);
			return previewServer
				? { ...overview, servers: [previewServer] }
				: {
						...overview,
						servers: overview.servers.map((server) => ({
							...server,
							tools: server.tools.map((tool) =>
								tool.name === "echo" ? { ...tool, description: longToolDescription } : tool,
							),
						})),
					};
		});
		ipcMain.handle(ipcChannels.mcpEdit, (_event, request) =>
			service.edit(workspace, validateMcpTarget(request)),
		);
		ipcMain.handle(ipcChannels.mcpSave, async (_event, request) => {
			if (saveFailure) throw new Error("Fixture save failure");
			await service.save(workspace, validateMcpSave(request));
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.mcpRemove, async (_event, request) => {
			if (removeFailure) throw new Error("Fixture remove failure");
			await service.remove(workspace, validateMcpTarget(request));
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.mcpTrust, async (_event, request) => {
			await service.trust(workspace, request.trusted);
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.mcpAction, async (_event, request) => {
			const action = validateMcpAction(request);
			if (previewServer && action.name === previewServer.name) {
				previewActions.push(action);
				if (action.action === "login") {
					previewLoginCancelled = false;
					await new Promise((resolve) => {
						finishPreviewLogin = resolve;
						browser.webContents.send(ipcChannels.mcpEvent, {
							workspacePath: workspace,
							type: "auth",
							name: previewServer.name,
							url: "https://example.invalid/authorize",
						});
					});
					if (!previewLoginCancelled) {
						previewServer = {
							...previewServer,
							authenticated: true,
							state: "connected",
							error: undefined,
							connections: 1,
						};
					}
				} else if (action.action === "cancel-login") {
					previewLoginCancelled = true;
					finishPreviewLogin?.();
					finishPreviewLogin = undefined;
				} else if (action.action === "logout") {
					previewServer = {
						...previewServer,
						authenticated: false,
						state: "needs-auth",
						error: authError,
						connections: 0,
					};
				}
			} else {
				await service.action(workspace, action);
			}
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.openExternal, (_event, request) => {
			openedUrls.push(request.url);
			return { ok: true };
		});
		ipcMain.handle(ipcChannels.mcpResources, (_event, request) =>
			service.resources(workspace, validateMcpResource(request)),
		);
		ipcMain.handle(ipcChannels.getWorkspace, () => ({ path: workspace }));
		ipcMain.handle(ipcChannels.sourceList, () => []);
		ipcMain.handle(ipcChannels.providerStatus, (_event, request) => ({
			providerId: request.providerId,
			configured: false,
		}));
		ipcMain.handle(ipcChannels.modelCatalog, () => ({ models: [], configured: false }));
		ipcMain.handle(ipcChannels.pluginList, () => []);
		ipcMain.handle(ipcChannels.composerSkills, () => []);
		ipcMain.handle(ipcChannels.diagnosticReport, () => ({ ok: true }));
		ipcMain.handle(ipcChannels.appStateLoad, () => null);
		ipcMain.handle(ipcChannels.appStateSave, () => ({ ok: true }));
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		vite = await createServer({
			root: projectRoot,
			logLevel: "error",
			server: { host: "127.0.0.1", port: 0, watch: null },
		});
		await vite.listen();
		browser = new BrowserWindow({
			show: false,
			width: 1280,
			height: 860,
			useContentSize: true,
			webPreferences: {
				preload: path.join(projectRoot, "electron", "preload.cjs"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false,
				offscreen: true,
			},
		});
		browser.webContents.on("console-message", (event) => {
			if (event.level === "error") errors.push(event.message);
		});
		await browser.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/#/settings`);
		await until(
			'Boolean(document.querySelector("[data-section=mcp-heading]"))',
			"MCP settings navigation",
		);
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; window.uiStore.getState().updateSettings({ language: "en", theme: "light", reduceMotion: true }); })',
		);
		await click("[data-section=mcp-heading]");
		await until('document.querySelector(".mcp-empty")', "empty state");
		await textButton("Add server");
		await until('document.querySelector(".mcp-dialog")?.open', "add form opens modally");
		await checkDialog();
		await field("Server name", "fixture");
		await field("Executable", process.env.RHYZA_TEST_NODE);
		await field(
			"Arguments",
			JSON.stringify([path.join(projectRoot, "tests", "fixtures", "mcp-server.mjs")]),
		);
		saveFailure = true;
		await textButton("Save", ".mcp-editor");
		await until(
			'document.querySelector(".mcp-editor .mcp-error")?.textContent.includes("Fixture save failure")',
			"save failure visible inside the modal",
		);
		await until(
			`(() => {
			const dialog = document.querySelector(".mcp-dialog");
			const error = dialog.querySelector(".mcp-error").getBoundingClientRect();
			const header = dialog.querySelector("header").getBoundingClientRect();
			return error.top >= header.bottom && error.bottom <= dialog.getBoundingClientRect().bottom;
		})()`,
			"save failure scrolls into view below the persistent modal header",
		);
		assert.equal(
			await host('document.querySelector(".mcp-editor input").value'),
			"fixture",
			"Save failure retains draft.",
		);
		service.changed(workspace);
		await sleep(300);
		assert(
			await host(
				'document.querySelector(".mcp-error")?.textContent.includes("Fixture save failure")',
			),
			"A background refresh must not clear operation errors.",
		);
		saveFailure = false;
		await textButton("Save", ".mcp-editor");
		await until(
			'document.querySelector(".mcp-state")?.textContent === "Connected"',
			"server connection",
		);
		assert.equal(await host('document.querySelector(".mcp-editor") === null'), true);
		const fixtureInfo = (await service.overview(workspace)).servers[0];
		assert.equal(fixtureInfo.authenticated, false, "Connection is not the same as OAuth sign-in.");
		assert.equal(
			await host(
				"document.querySelector('[aria-label=\"Delete fixture\"]').checkVisibility({ visibilityProperty: true })",
			),
			true,
			"All server actions are directly visible.",
		);
		await click('[aria-label="Edit fixture"]');
		await until(
			'document.querySelector(".mcp-editor") && document.querySelector(".mcp-dialog")?.open',
			"edit opens retained configuration in a modal form",
		);
		await checkDialog();
		assert.equal(await host('document.querySelector(".mcp-editor input").value'), "fixture");
		await screenshot("mcp-editor-light");
		for (let index = 0; index < 8; index++) {
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
			await sleep(30);
			assert(
				await host('document.querySelector(".mcp-dialog").contains(document.activeElement)'),
				"Tab stays inside the modal form.",
			);
		}
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
		await until(
			'!document.querySelector(".mcp-dialog") && document.activeElement?.getAttribute("aria-label") === "Edit fixture"',
			"escape closes editor and restores the edit button",
		);
		await click('[aria-label="Edit fixture"]');
		await until('document.querySelector(".mcp-dialog")?.open', "editor reopens");
		await textButton("Cancel", ".mcp-editor");
		await textButton("Tools & resources");
		await until('document.querySelector(".mcp-dialog")?.open', "tool inspector opens modally");
		await checkDialog();
		await until('document.querySelectorAll(".mcp-tool").length === 5', "tool discovery");
		const collapsedHeight = await host(
			'document.querySelector(".mcp-tool").getBoundingClientRect().height',
		);
		await click('[aria-label="echo Description"]');
		assert.equal(
			await host(
				'document.querySelector(".mcp-tool-description-panel:popover-open p").textContent',
			),
			longToolDescription,
			"The full description is available in the popover.",
		);
		assert.equal(
			await host('document.querySelector(".mcp-tool").getBoundingClientRect().height'),
			collapsedHeight,
			"Opening a long description does not resize the tool row.",
		);
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
		await until(
			'!document.querySelector(".mcp-tool-description-panel:popover-open")',
			"Escape dismisses the description",
		);
		assert(
			await host('document.querySelector(".mcp-dialog").open'),
			"Description dismissal keeps the tools modal open.",
		);
		assert.equal(
			await host(
				'[...document.querySelectorAll(".mcp-tool select[aria-label$=Permission]")].every(input => input.value === "blocked")',
			),
			true,
			"Read-only annotations do not approve tools.",
		);
		await click('button[aria-label="echo Permission"]');
		assert.equal(
			await host(
				'document.querySelector(".ui-select-popup").closest("dialog") === document.querySelector(".mcp-dialog")',
			),
			true,
			"Dropdown is in the native modal top layer.",
		);
		await click('.ui-select-popup [role="option"][data-value="read"]');
		await textButton("Save tool settings");
		await until(
			'document.querySelector(\'select[aria-label="echo Permission"]\')?.value === "read" && document.querySelector(".mcp-state")?.textContent === "Connected"',
			"approval persisted",
		);
		assert.equal(
			service.config.get(workspace, { name: "fixture", scope: "user" }).policy.tools.echo,
			"read",
		);
		await field("Tool exposure", "direct");
		await textButton("Save tool settings");
		await until(
			'document.querySelector(\'select[aria-label="echo Tool exposure"]\')?.value === "direct" && document.querySelector(".mcp-state")?.textContent === "Connected"',
			"direct exposure saved",
		);
		assert.equal(
			service.config.get(workspace, { name: "fixture", scope: "user" }).config.toolExposure.echo,
			"direct",
		);
		await click(".mcp-resources summary");
		await textButton("List resources");
		await until(
			'document.querySelector(".mcp-resource-preview")?.textContent.includes("fixture://guide")',
			"resource list",
		);
		await field("Resource URI", "fixture://guide");
		await textButton("Read resource");
		await until(
			'document.querySelector(".mcp-resource-preview")?.textContent.includes("fixture resource text")',
			"resource preview",
		);
		await screenshot("mcp-inspector-light");
		for (const theme of ["light", "dark"]) {
			await host(`window.uiStore.getState().updateSettings({ theme: ${JSON.stringify(theme)} })`);
			await until(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, theme);
			for (const width of [375, 768, 1024, 1440]) {
				browser.setContentSize(width, 720);
				await until(
					`innerWidth === ${width} && document.querySelector(".mcp-dialog").getBoundingClientRect().width <= ${width} - 30`,
					"modal layout settles after resize",
				);
				await sleep(80);
				await checkAppearance(`Connected ${theme} ${width}px`);
				await checkDialog();
				assert(
					await host('document.querySelector(".mcp-tools").getBoundingClientRect().width > 0'),
				);
				const rows = await host(`(() => {
					const tools = [...document.querySelectorAll(".mcp-tool")];
					return {
						heights: tools.map(tool => tool.getBoundingClientRect().height),
						controls: tools.flatMap(tool => [...tool.querySelectorAll(".ui-select-trigger")].map(item => item.getBoundingClientRect().height)),
						descriptions: tools.map(tool => tool.querySelector(".mcp-tool-description-panel")?.checkVisibility() ?? false)
					};
				})()`);
				assert(
					rows.heights.every((height) => Math.abs(height - rows.heights[0]) < 1),
					`${theme} ${width}: equal-height tool rows`,
				);
				assert(
					rows.controls.every((height) => height >= 40 && height <= 48),
					`${theme} ${width}: compact selectors`,
				);
				assert(
					rows.descriptions.every((visible) => !visible),
					"Descriptions are collapsed by default.",
				);
				await click('button[aria-label="echo Permission"]');
				const popup = await host(`(() => {
					const list = document.querySelector(".ui-select-popup");
					const rect = list.getBoundingClientRect();
					return { bounds: rect.toJSON(), topLayer: list.closest("dialog")?.matches(":modal"),
						icons: [...list.querySelectorAll("[role=option]")].every(item => item.firstElementChild.tagName === "svg"),
						selected: list.querySelector('[aria-selected=true]')?.dataset.value };
				})()`);
				assert(
					popup.topLayer && popup.icons,
					"Every dropdown item has a leading icon in the modal layer.",
				);
				assert.equal(popup.selected, "read");
				await screenshot(`mcp-dropdown-${theme}-${width}`);
				assert(
					popup.bounds.left >= 0 &&
						popup.bounds.right <= width + 1 &&
						popup.bounds.top >= 0 &&
						popup.bounds.bottom <= 721,
					`${theme} ${width}: popup remains inside the viewport ${JSON.stringify(popup.bounds)}`,
				);
				browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
				await until(
					'!document.querySelector(".ui-select-popup") && document.activeElement?.getAttribute("aria-label") === "echo Permission"',
					"Escape closes only the dropdown and restores focus",
				);
				assert(
					await host('document.querySelector(".mcp-dialog").open'),
					"Escape does not dismiss the enclosing modal.",
				);
				await click('[aria-label="echo Description"]');
				const description = await host(
					'document.querySelector(".mcp-tool-description-panel:popover-open").getBoundingClientRect().toJSON()',
				);
				assert(
					description.left >= 0 &&
						description.right <= width + 1 &&
						description.top >= 0 &&
						description.bottom <= 721,
					`${theme} ${width}: long description is visible inside the viewport ${JSON.stringify(description)}`,
				);
				await screenshot(`mcp-description-${theme}-${width}`);
				browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
				await until(
					'!document.querySelector(".mcp-tool-description-panel:popover-open")',
					"description dismisses without resizing its row",
				);
			}
		}
		await textButton("Close", ".mcp-details");
		await until(
			'!document.querySelector(".mcp-dialog") && document.activeElement?.getAttribute("aria-label") === "Tools & resources fixture"',
			"inspector closes and restores its action",
		);
		await host('document.querySelector(".mcp-trust button").focus()');
		await textButton("Trust project");
		await until('document.querySelector(".mcp-confirmation")?.open', "trust dialog");
		await textButton("Cancel", ".mcp-confirmation");
		assert.equal(service.config.snapshot(workspace).trusted, false);
		await until('document.activeElement?.title === "Trust project"', "confirmation restores focus");
		await textButton("Trust project");
		await textButton("Trust project", ".mcp-confirmation");
		await until(
			'document.querySelector(".mcp-trust button")?.title === "Revoke trust"',
			"trust applied",
		);
		await textButton("Disable");
		await until('document.querySelector(".mcp-state")?.textContent === "Disabled"', "disabled");
		assert(
			await host(
				`getComputedStyle(document.querySelector(".mcp-server")).backgroundColor === getComputedStyle(document.documentElement).getPropertyValue("--ui-surface-muted").trim().replace(/^#([0-9a-f]{6})$/i, (_, hex) => "rgb(" + [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16)).join(", ") + ")")`,
			),
			"Disabled server has a muted card background.",
		);
		await textButton("Enable");
		await until(
			'document.querySelector(".mcp-state")?.textContent === "Connected"',
			"enabled again",
		);
		await click('[aria-label="Delete fixture"]');
		await until('document.querySelector(".mcp-confirmation")?.open', "remove dialog");
		removeFailure = true;
		await textButton("Delete", ".mcp-confirmation");
		await until(
			'document.querySelector(".mcp-confirmation .mcp-error")?.textContent.includes("Fixture remove failure")',
			"delete error retains dialog",
		);
		assert.equal((await service.overview(workspace)).servers.length, 1);
		removeFailure = false;
		await textButton("Delete", ".mcp-confirmation");
		await until(
			'document.querySelector(".mcp-empty") && !document.querySelector(".mcp-confirmation")',
			"removed and persisted",
		);
		assert.equal((await service.overview(workspace)).servers.length, 0);
		await textButton("Add server");
		await click(".mcp-editor details summary");
		await field("Configuration JSON", "{invalid");
		await textButton("Load configuration");
		await until('document.querySelector(".mcp-editor .mcp-error")', "invalid import");
		await field(
			"Configuration JSON",
			JSON.stringify({
				mcpServers: {
					imported: {
						command: process.env.RHYZA_TEST_NODE,
						args: [path.join(projectRoot, "tests", "fixtures", "mcp-server.mjs")],
					},
					another: { command: "not-loaded" },
				},
			}),
		);
		await textButton("Load configuration");
		await until(
			'document.querySelector(".mcp-editor .mcp-error")?.textContent.includes("Enter the server name")',
			"multiple server import requires selection",
		);
		await field("Server name to import", "imported");
		await textButton("Load configuration");
		await field("Configuration scope", "project");
		await textButton("Save", ".mcp-editor");
		await until(
			'document.querySelector(".mcp-state")?.textContent === "Connected"',
			"imported project server",
		);
		assert.equal(
			service.config.get(workspace, { name: "imported", scope: "project" }).config.command,
			process.env.RHYZA_TEST_NODE,
		);
		await textButton("Revoke trust");
		await textButton("Revoke trust", ".mcp-confirmation");
		await until(
			'document.querySelector(".mcp-empty")',
			"project servers disconnected after trust revocation",
		);
		assert.equal((await service.overview(workspace)).projectTrusted, false);
		previewServer = {
			...fixtureInfo,
			name: "remote-demo",
			transport: "http",
			oauth: true,
			authenticated: false,
			connections: 0,
			tools: [],
			state: "needs-auth",
			error: authError,
		};
		service.changed(workspace);
		await until('document.querySelector(".mcp-sign-in-hint")', "localized sign-in guidance");
		assert.equal(
			await host('document.querySelector(".mcp-server [role=alert]") === null'),
			true,
			"An expected authentication step is not styled as an error.",
		);
		assert.equal(
			await host('document.querySelector(".mcp-server-metrics").textContent.includes("deferred")'),
			false,
			"Exposure is a readable localized label, not a raw configuration ID.",
		);
		assert.equal(await host('document.querySelector(".mcp-diagnostics").open'), false);
		await click(".mcp-diagnostics summary");
		assert.equal(
			await host('document.querySelector(".mcp-diagnostics pre").textContent'),
			authError,
		);
		await click(".mcp-diagnostics summary");
		for (const language of ["zh-CN", "zh-TW", "en"]) {
			await host(
				`window.uiStore.getState().updateSettings({ language: ${JSON.stringify(language)} })`,
			);
			await until(
				`document.querySelector(".mcp-auth-action")?.title === ${JSON.stringify(language === "zh-CN" ? "登录" : language === "zh-TW" ? "登入" : "Sign in")}`,
				`localized ${language} icon action`,
			);
			assert(
				await host(`(() => {
					const hint = document.querySelector(".mcp-sign-in-hint");
					return hint.textContent.trim() && !hint.textContent.includes("undefined")
						&& document.querySelector(".mcp-diagnostics summary").textContent.trim();
				})()`),
			);
		}
		for (const theme of ["light", "dark"]) {
			await host(`window.uiStore.getState().updateSettings({ theme: ${JSON.stringify(theme)} })`);
			await until(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, theme);
			for (const width of [375, 768, 1024, 1440]) {
				browser.setContentSize(width, 720);
				await sleep(80);
				await checkAppearance(`Sign-in ${theme} ${width}px`);
				assert(
					await host(`(() => {
						const badge = getComputedStyle(document.querySelector(".mcp-state"));
						const auth = getComputedStyle(document.querySelector(".mcp-auth-action"));
						const [red, green, blue] = badge.color.match(/[\\d.]+/g).map(Number);
						return red > green && green > blue && auth.color === badge.color
							&& auth.backgroundColor === badge.backgroundColor
							&& document.querySelector(".mcp-tools-action").disabled
							&& document.querySelector(".mcp-reconnect-action").disabled;
					})()`),
					`${theme}: sign-in uses warning yellow and unavailable actions are disabled.`,
				);
				if (width === 1440) await screenshot(`mcp-sign-in-${theme}`);
			}
		}
		for (const [state, enabled, authenticated] of [
			["connecting", true, false],
			["connected", true, true],
			["connected", true, false],
			["disconnected", true, true],
			["failed", true, true],
			["disabled", false, false],
			["needs-auth", true, false],
		]) {
			previewServer = {
				...previewServer,
				state,
				enabled,
				authenticated,
				error:
					state === "failed"
						? "Fixture permission denied"
						: state === "needs-auth"
							? authError
							: undefined,
			};
			service.changed(workspace);
			await until(
				`document.querySelector(".mcp-state").classList.contains(${JSON.stringify(`is-${state}`)}) && document.querySelector(".mcp-auth-action").title === ${JSON.stringify(authenticated ? "Sign out" : "Sign in")} && document.querySelector(".mcp-power-action").getAttribute("aria-checked") === ${JSON.stringify(String(enabled))}`,
				`${state} has authentication and enabled-state actions`,
			);
			assert.equal(
				await host('document.querySelector(".mcp-auth-action").disabled'),
				state === "connecting" || !enabled,
			);
			assert.equal(
				await host('document.querySelector(".mcp-tools-action").disabled'),
				state !== "connected" || !enabled,
			);
			assert.equal(
				await host('document.querySelectorAll(".mcp-auth-action").length'),
				1,
				"Sign in and sign out occupy the same action, not separate buttons.",
			);
			if (state === "failed") {
				assert.equal(
					await host('document.querySelector(".mcp-server [role=alert]").textContent.trim()'),
					"Fixture permission denied",
					"Real policy or permission failures remain explicit.",
				);
				await textButton("Reconnect");
			}
		}
		await textButton("Sign in");
		await until(
			'document.querySelector(\'[aria-label="Open sign-in page"]\') && document.querySelector(".mcp-settings").getAttribute("aria-busy") === "true"',
			"browser sign-in offers reopen and cancellation",
		);
		assert.equal(await host('document.querySelector(".mcp-auth-action").disabled'), true);
		await textButton("Open sign-in page");
		assert.deepEqual(openedUrls, ["https://example.invalid/authorize"]);
		await textButton("Cancel sign-in");
		await until(
			'!document.querySelector(\'[aria-label="Cancel sign-in"]\') && !document.querySelector(".mcp-auth-action").disabled',
			"cancel restores server actions",
		);
		await textButton("Sign in");
		await until(
			'document.querySelector(\'[aria-label="Cancel sign-in"]\') && document.querySelector(".mcp-auth-action").disabled',
			"sign-in can be retried after cancellation",
		);
		finishPreviewLogin();
		finishPreviewLogin = undefined;
		await until(
			'document.querySelector(".mcp-auth-action")?.title === "Sign out" && !document.querySelector(".mcp-auth-action").disabled && !document.querySelector(".mcp-tools-action").disabled',
			"successful sign-in switches the same button to sign out and enables inspection",
		);
		await textButton("Sign out");
		await until(
			'document.querySelector(".mcp-auth-action")?.title === "Sign in" && document.querySelector(".mcp-tools-action").disabled',
			"sign-out restores the warning and disabled inspection state",
		);
		assert.deepEqual(
			previewActions.map(({ name, scope, action }) => [name, scope, action]),
			[
				["remote-demo", "user", "reconnect"],
				["remote-demo", "user", "login"],
				["remote-demo", "user", "cancel-login"],
				["remote-demo", "user", "login"],
				["remote-demo", "user", "logout"],
			],
			"Icon actions dispatch the exact original target without changing permission semantics.",
		);
		assert.deepEqual(errors, []);
		console.log(
			"MCP_UI verified spaced right-aligned icon rows, modal editor/inspector and keyboard focus, authentication switching, warning colors, browser sign-in/cancel, responsive contrast, permissions, resources and confirmation errors.",
		);
	}
	run()
		.then(async () => {
			await service.dispose();
			browser?.destroy();
			await vite?.close();
			app.exit(0);
		})
		.catch(async (error) => {
			console.error(error);
			if (browser) await screenshot("mcp-failure");
			await service?.dispose();
			browser?.destroy();
			await vite?.close();
			app.exit(1);
		});
}
