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
		"all product routes retain readable, responsive light and dark interfaces",
		{
			timeout: 180_000,
		},
		async () => {
			const userData = await mkdtemp(path.join(os.tmpdir(), "rhyza-ui-test-"));
			const env = {
				...process.env,
				RHYZA_UI_TEST_DATA: userData,
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
				const timeout = setTimeout(() => child.kill(), 170_000);
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
				await rm(userData, { recursive: true, force: true, maxRetries: 5 });
			}
		},
	);
} else {
	const { app, BrowserWindow } = require("electron");
	app.setPath("userData", process.env.RHYZA_UI_TEST_DATA);
	app.on("window-all-closed", () => {});
	let server;
	let browser;
	const rendererErrors = [];
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const host = async (code) => {
		try {
			return await browser.webContents.executeJavaScript(code);
		} catch (error) {
			throw new Error(`${error.message}\nScript: ${code}\n${rendererErrors.join("\n")}`, {
				cause: error,
			});
		}
	};
	const until = async (code, label) => {
		for (let attempt = 0; attempt < 300; attempt++) {
			if (await host(code)) return;
			await sleep(50);
		}
		throw new Error(`Timed out: ${label}\n${rendererErrors.join("\n")}`);
	};
	const settle = async () => {
		await host(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
		await sleep(40);
	};
	const routes = [
		["/", ".chat-topbar h1"],
		["/knowledge", ".knowledge-page-header h1"],
		["/sources", ".page-title"],
		["/changes", ".page-title"],
		["/settings", ".settings-section:not([hidden]) .settings-section-header h1"],
	];

	async function navigate(route, heading) {
		await host(`location.hash = ${JSON.stringify(`#${route}`)}`);
		await until(`Boolean(document.querySelector(${JSON.stringify(heading)}))`, `route ${route}`);
		await settle();
	}

	async function setAppearance(theme, extra = {}) {
		await host(`window.uiStore.getState().updateSettings(${JSON.stringify({ theme, ...extra })})`);
		await until(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, theme);
		await settle();
	}

	async function setInput(selector, value) {
		await host(`(() => {
			const input = document.querySelector(${JSON.stringify(selector)});
			const prototype = input instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
			Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ${JSON.stringify(value)});
			input.dispatchEvent(new Event("input", { bubbles: true }));
		})()`);
		await settle();
	}

	async function checkOverlayControls() {
		browser.setContentSize(1024, 800);
		await navigate("/settings", ".settings-section:not([hidden]) .settings-section-header h1");
		await host('document.querySelector("[data-section=language-heading]").click()');
		await settle();
		await host('document.querySelector("#language-select").click()');
		await until('Boolean(document.querySelector(".ui-select-popup"))', "styled language dropdown");
		assert.equal(await host('document.activeElement?.getAttribute("role")'), "listbox");
		assert(
			await host('document.querySelector(".ui-select-popup [aria-selected=true] svg") !== null'),
			"Selected option has a leading icon.",
		);
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "End" });
		await settle();
		assert(
			await host(`(() => {
			const popup = document.querySelector(".ui-select-popup");
			return popup.getAttribute("aria-activedescendant") === popup.lastElementChild.id;
		})()`),
			"End navigates to the last enabled option.",
		);
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Home" });
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
		await until('!document.querySelector(".ui-select-popup")', "keyboard selects language");
		assert.equal(
			await host("document.activeElement?.id"),
			"language-select",
			"Selection restores focus.",
		);
		await host('window.uiStore.getState().updateSettings({ language: "en" })');
		await navigate("/", ".chat-topbar h1");
		const deletion = '.session-node-actions button[title="删除对话"]';
		await host(`window.confirm = () => { throw new Error("Native confirmation must not be used."); };
			document.querySelector(${JSON.stringify(deletion)}).focus();
			document.querySelector(${JSON.stringify(deletion)}).click();`);
		await until(
			'document.querySelector(".confirmation-dialog")?.open',
			"in-app delete confirmation",
		);
		assert(
			await host('document.querySelector(".confirmation-dialog").matches(":modal")'),
			"Confirmation traps focus in a native modal.",
		);
		assert.equal(
			await host("document.activeElement?.textContent"),
			"Cancel",
			"Destructive confirmation starts on cancel.",
		);
		await checkContrast("delete confirmation");
		await screenshot("confirmation-delete");
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
		await until('!document.querySelector(".confirmation-dialog")', "Escape cancels deletion");
		assert(
			await host('window.uiStore.getState().sessions.some(item => item.id === "ui-session")'),
			"Cancelling preserves the session.",
		);
		assert.equal(
			await host("document.activeElement?.title"),
			"删除对话",
			"Cancellation restores the delete trigger.",
		);
		await host(`document.querySelector(${JSON.stringify(deletion)}).click()`);
		await until(
			'document.querySelector(".confirmation-dialog")?.open',
			"delete confirmation reopens",
		);
		await host('document.querySelector(".confirmation-submit").click()');
		await until(
			'!document.querySelector(".confirmation-dialog")',
			"confirmed deletion closes dialog",
		);
		assert.equal(
			await host('window.uiStore.getState().sessions.some(item => item.id === "ui-session")'),
			false,
			"Deletion executes only after confirmation.",
		);
		await seedContent();
		await host(`(() => {
			const state = window.uiStore.getState();
			const related = {
				...state.entities[0],
				id: "ui-related-entity",
				name: "Shared context",
				type: "concept"
			};
			window.uiStore.setState({
				entities: [...state.entities, related],
				relations: [{
					id: "ui-relation",
					sourceEntityId: "ui-entity",
					targetEntityId: related.id,
					type: "related_to",
					description: "A related entity for theme verification.",
					confidence: "confirmed",
					sourceRefs: [],
					version: 1
				}]
			});
		})()`);
		await navigate("/knowledge", ".knowledge-page-header h1");
		const themeColors = {};
		for (const theme of ["light", "dark"]) {
			await setAppearance(theme);
			themeColors[theme] = await host(`(() => {
				const styles = selectors => selectors.map(selector => {
					const element = document.querySelector(selector);
					const style = getComputedStyle(element);
					return [style.backgroundColor, style.color, style.borderColor];
				});
				return {
					badges: styles([".entity-preview-heading .status-progress", ".entity-preview-heading .status-success"]),
					relation: styles([".entity-relation-heading small", ".entity-relation-item"]),
					surfaces: styles([".knowledge-resource-pane", ".knowledge-primary-detail"])
				};
			})()`);
			await screenshot(`knowledge-theme-${theme}`);
		}
		assert.notDeepEqual(
			themeColors.light.badges,
			themeColors.dark.badges,
			"Entity type and confidence badges use distinct light and dark semantic colors.",
		);
		assert.notDeepEqual(
			themeColors.light.relation,
			themeColors.dark.relation,
			"Relation tags and cards use distinct light and dark semantic colors.",
		);
		assert.notDeepEqual(
			themeColors.light.surfaces,
			themeColors.dark.surfaces,
			"Knowledge surfaces adapt to the active theme.",
		);
		await seedContent();
	}

	async function checkStackedFields(selector, label) {
		const fields = await host(`(() => [...document.querySelectorAll(${JSON.stringify(selector)})]
			.flatMap(field => {
				const control = field.querySelector(":scope > .field, :scope > .ui-select > .ui-select-trigger");
				if (!control || !control.getClientRects().length) return [];
				const caption = [...field.childNodes].find(node =>
					node.nodeType === Node.TEXT_NODE && node.textContent.trim()
					|| node.nodeType === Node.ELEMENT_NODE && !node.classList.contains("ui-select"));
				const range = document.createRange();
				range.selectNodeContents(caption);
				const captionRect = range.getBoundingClientRect();
				const fieldRect = field.getBoundingClientRect();
				const rect = control.getBoundingClientRect();
				return [{
					caption: caption.textContent.trim(),
					left: Math.abs(rect.left - fieldRect.left),
					width: Math.abs(rect.width - fieldRect.width),
					gap: rect.top - captionRect.bottom,
					height: rect.height,
					textarea: control instanceof HTMLTextAreaElement,
					associated: field.control === control
				}];
			}))()`);
		assert.ok(fields.length > 0, `${label}: visible form fields`);
		for (const field of fields) {
			const message = `${label}: ${field.caption}`;
			assert.ok(field.left <= 1, `${message}: control shares the label's left edge`);
			assert.ok(field.width <= 1, `${message}: control fills the field`);
			assert.ok(
				field.gap >= 2 && field.gap <= 12,
				`${message}: label above control (${field.gap}px)`,
			);
			assert.equal(field.associated, true, `${message}: label names the visible control`);
		}
		const heights = fields.filter((field) => !field.textarea).map((field) => field.height);
		assert.ok(
			Math.max(...heights) - Math.min(...heights) <= 1,
			`${label}: text inputs and selects share the same height (${heights.join(", ")})`,
		);
	}

	async function checkFormAlignment() {
		await seedContent();
		await host(`(() => {
			const state = window.uiStore.getState();
			window.uiStore.setState({
				entities: [...state.entities, { ...state.entities[0], id: "ui-related-entity", name: "Shared context" }],
				diagrams: [{
					id: "ui-form-diagram",
					name: "Conversation flow",
					type: "workflow",
					nodes: [{ id: "question", label: "A question with a long descriptive label" }],
					edges: [],
					mermaidSource: "flowchart LR\\n  question[Question]",
					version: 1,
					versions: [],
					updatedAt: "2026-09-18T10:24:00.000Z"
				}]
			});
		})()`);
		for (const language of ["en", "zh-CN"]) {
			for (const theme of ["light", "dark"]) {
				await setAppearance(theme, { language });
				for (const width of [1440, 375]) {
					browser.setContentSize(width, 960);
					const label = `${language} ${theme} ${width}`;
					await navigate("/knowledge", ".knowledge-page-header h1");
					await host('document.querySelector(".entity-preview-heading button").click()');
					await until('Boolean(document.querySelector(".entity-center-editor"))', "entity form");
					await checkStackedFields(".entity-center-editor label.form-label", `${label} entity`);
					const fieldSurface = await host(`(() => {
						const input = document.querySelector(".entity-center-editor input.field");
						input.focus();
						const style = getComputedStyle(input);
						return {
							borderWidth: style.borderWidth,
							borderRadius: style.borderRadius,
							background: style.backgroundColor
						};
					})()`);
					assert.equal(fieldSurface.borderWidth, "0px", `${label}: text input has no hard border`);
					assert.ok(
						Number.parseFloat(fieldSurface.borderRadius) > 0,
						`${label}: input surface stays soft`,
					);
					assert.notEqual(
						fieldSurface.background,
						"rgba(0, 0, 0, 0)",
						`${label}: input surface remains visually distinct`,
					);
					await host('document.querySelector(".entity-center-editor .ui-select-trigger").click()');
					await until('Boolean(document.querySelector(".ui-select-popup"))', "confidence dropdown");
					assert.ok(
						await host(`(() => {
						const rect = document.querySelector(".ui-select-popup").getBoundingClientRect();
						return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
					})()`),
						`${label}: confidence popup remains inside the window`,
					);
					browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "End" });
					browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
					await until(
						'!document.querySelector(".ui-select-popup")',
						"confidence keyboard selection",
					);
					assert.equal(
						await host(
							'document.querySelector(".entity-center-editor .ui-select-trigger").dataset.value',
						),
						"disputed",
						`${label}: keyboard changes confidence`,
					);
					await host('document.querySelector(".entity-center-editor button[type=button]").click()');
					await host('document.querySelector("[aria-label=添加关联]").click()');
					await settle();
					await checkStackedFields(".entity-relation-form label", `${label} relation`);
					await host('document.querySelector(".entity-relation-form-header button").click()');
					await host('document.querySelector("#knowledge-diagrams-tab").click()');
					await settle();
					await checkStackedFields(
						".knowledge-inspector-content label.form-label",
						`${label} diagram`,
					);
					await host('document.querySelector("[aria-label=关联实体]").click()');
					await settle();
					await checkStackedFields(".entity-relation-form label", `${label} diagram links`);
					await host('document.querySelector(".entity-relation-form-header button").click()');
					await navigate("/changes", ".page-title");
					const history = await host(`(() => {
						const input = document.querySelector("[aria-label='Filter knowledge history']").getBoundingClientRect();
						const select = document.querySelector(".knowledge-change-list .ui-select-trigger").getBoundingClientRect();
						return {
							height: Math.abs(input.height - select.height),
							top: Math.abs(input.top - select.top),
							stackedGap: select.top - input.bottom,
							left: Math.abs(input.left - select.left),
							width: select.width
						};
					})()`);
					assert.ok(
						history.height <= 1 &&
							(width === 375
								? history.left <= 1 && Math.abs(history.stackedGap - 8) <= 1
								: history.top <= 1),
						`${label}: history filter controls align (${JSON.stringify(history)})`,
					);
					assert.ok(
						Math.abs(history.width - 160) <= 1,
						`${label}: history selector keeps its compact width`,
					);
					await navigate("/settings", ".settings-section:not([hidden]) h1");
					for (const section of [
						"language-heading",
						"provider-heading",
						"knowledge-heading",
						"accessibility-heading",
						"appearance-heading",
						"plugins-heading",
					]) {
						const button = `.settings-navigation [data-section="${section}"]`;
						await host(`document.querySelector(${JSON.stringify(button)}).click()`);
						await settle();
						assert.ok(
							await host(`(() => [...document.querySelectorAll(".settings-section:not([hidden]) .settings-row--field > .ui-select")]
							.every(root => {
								const rect = root.getBoundingClientRect();
								const control = root.querySelector(".ui-select-trigger").getBoundingClientRect();
								return Math.abs(rect.left - control.left) <= 1
									&& Math.abs(rect.width - control.width) <= 1
									&& control.height >= 40;
							}))()`),
							`${label}: ${section} controls fill their grid column`,
						);
					}
				}
			}
		}
		await setAppearance("light", { language: "en" });
		await host(`window.rhyza = {
			pluginList: async () => [],
			mcpList: async () => ({
				workspacePath: "C:\\\\demo\\\\form-layout",
				projectTrusted: true,
				projectConfigExists: false,
				errors: [],
				servers: [{
					name: "form_fixture", scope: "user", source: "fixture", transport: "stdio",
					enabled: true, exposure: "deferred", state: "connected", oauth: false,
					authenticated: false, connections: 1,
					tools: [{ name: "fixture_read", description: "Read fixture data", exposure: "deferred", permission: "read" }]
				}]
			}),
			onMcpEvent: () => () => {}
		}; undefined;`);
		try {
			for (const language of ["en", "zh-CN"]) {
				for (const theme of ["light", "dark"]) {
					await setAppearance(theme, { language });
					for (const width of [1440, 375]) {
						browser.setContentSize(width, 960);
						await host('document.querySelector("[data-section=mcp-heading]").click()');
						await until('Boolean(document.querySelector(".mcp-server"))', "MCP fixture");
						await host('document.querySelector(".mcp-toolbar .command-button").click()');
						await until('Boolean(document.querySelector(".mcp-editor"))', "MCP editor");
						await settle();
						const label = `${language} ${theme} ${width} MCP`;
						await checkStackedFields(".mcp-editor label", `${label} editor`);
						await host('document.querySelector(".mcp-editor .ui-select-trigger").click()');
						await until('Boolean(document.querySelector(".ui-select-popup"))', "modal select");
						assert.ok(
							await host(
								'document.querySelector(".mcp-dialog").contains(document.querySelector(".ui-select-popup"))',
							),
							`${label}: dropdown stays inside the modal`,
						);
						browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
						await until('!document.querySelector(".ui-select-popup")', "close modal select");
						await host('document.querySelector(".mcp-editor header button").click()');
						await host('document.querySelector(".mcp-tools-action").click()');
						await until('Boolean(document.querySelector(".mcp-details"))', "MCP tool controls");
						await settle();
						await checkStackedFields(".mcp-tool label", `${label} tools`);
						await host('document.querySelector(".mcp-details header button").click()');
					}
				}
			}
		} finally {
			await host("delete window.rhyza;");
			await navigate("/knowledge", ".knowledge-page-header h1");
			await host("window.uiStore.setState({ diagrams: [] });");
			await setAppearance("light", { language: "en" });
			await seedContent();
		}
	}

	async function screenshot(name) {
		if (!process.env.RHYZA_UI_SCREENSHOT_DIR) return;
		await sleep(180);
		await writeFile(
			path.join(process.env.RHYZA_UI_SCREENSHOT_DIR, `${name}.png`),
			(await browser.webContents.capturePage()).toPNG(),
		);
	}

	async function checkLayout(label) {
		const result = await host(`(() => {
			const selectors = [
				".chat-topbar", ".chat-composer", ".page-header", ".knowledge-page-header",
				".page-title", ".chat-empty", ".settings-sections"
			];
			const outside = selectors.flatMap(selector => [...document.querySelectorAll(selector)]
				.filter(element => {
					const rect = element.getBoundingClientRect();
					return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
				}).map(element => element.className));
			const hiddenHeading = [...document.querySelectorAll("main h1")]
				.filter(element => !element.closest("[hidden]"))
				.some(element => element.getClientRects().length === 0);
			const reopen = document.querySelector(".sidebar-reopen")?.getBoundingClientRect();
			const obstructedHeading = reopen && [...document.querySelectorAll(
				"main h1, .knowledge-page-header > div:first-child"
			)].some(element => {
				const rect = element.getBoundingClientRect();
				return rect.left < reopen.right && rect.right > reopen.left
					&& rect.top < reopen.bottom && rect.bottom > reopen.top;
			});
			const sidebar = document.querySelector(".app-sidebar");
			const sidebarRect = sidebar.getBoundingClientRect();
			const clippedSidebarControls = sidebar.inert || sidebarRect.width < 200 ? [] : [...sidebar.querySelectorAll(
				".session-tree-header button, .app-sidebar-footer .sidebar-nav-icon"
			)].filter(element => {
				const rect = element.getBoundingClientRect();
				return rect.width > 0 && (rect.left < sidebarRect.left || rect.right > sidebarRect.right);
			}).map(element => element.getAttribute("aria-label"));
			return {
				outside,
				hiddenHeading,
				obstructedHeading: Boolean(obstructedHeading),
				clippedSidebarControls,
				overflow: document.documentElement.scrollWidth > innerWidth + 1,
				mainWidth: document.querySelector("main").getBoundingClientRect().width
			};
		})()`);
		assert.deepEqual(result.outside, [], `${label}: clipped content`);
		assert.equal(result.hiddenHeading, false, `${label}: hidden page heading`);
		assert.equal(result.obstructedHeading, false, `${label}: sidebar opener overlaps heading`);
		assert.deepEqual(result.clippedSidebarControls, [], `${label}: clipped sidebar controls`);
		assert.equal(result.overflow, false, `${label}: horizontal document overflow`);
		assert.ok(result.mainWidth > 200, `${label}: unusably narrow main content`);
	}

	async function checkFilledSelection(selector, label) {
		const states = await host(`(() => [...document.querySelectorAll(${JSON.stringify(selector)})]
			.map(element => {
				const style = getComputedStyle(element);
				return {
					background: style.backgroundColor,
					shadow: style.boxShadow,
					borders: ["Top", "Right", "Bottom", "Left"].map(side => ({
						color: style["border" + side + "Color"],
						style: style["border" + side + "Style"],
						width: style["border" + side + "Width"]
					}))
				};
			}))()`);
		assert.ok(states.length > 0, `${label}: selected item exists`);
		for (const state of states) {
			assert.notEqual(state.background, "rgba(0, 0, 0, 0)", `${label}: filled selection`);
			assert.equal(state.shadow, "none", `${label}: no single-side selection shadow`);
			for (const border of state.borders) {
				assert.equal(border.style, "solid", `${label}: full selection border`);
				assert.equal(border.width, "1px", `${label}: subtle selection border`);
				assert.notEqual(border.color, "rgba(0, 0, 0, 0)", `${label}: visible selection border`);
				assert.equal(border.color, state.borders[0].color, `${label}: uniform selection border`);
			}
		}
	}

	async function checkSettingsNavigation(label) {
		const styles = await host(`(() => {
			const active = document.querySelector(".settings-navigation nav button.is-active");
			const inactive = document.querySelector(".settings-navigation nav button:not(.is-active)");
			const heading = document.querySelector(".settings-navigation-group-heading");
			const activeStyle = getComputedStyle(active);
			const inactiveStyle = getComputedStyle(inactive);
			const headingStyle = getComputedStyle(heading);
			const groupStyle = getComputedStyle(
				document.querySelector(".settings-navigation-group + .settings-navigation-group")
			);
			return {
				current: active.getAttribute("aria-current"),
				activeBackground: activeStyle.backgroundColor,
				inactiveBackground: inactiveStyle.backgroundColor,
				shadow: activeStyle.boxShadow,
				borders: ["Top", "Right", "Bottom", "Left"].map(side => ({
					color: activeStyle["border" + side + "Color"],
					style: activeStyle["border" + side + "Style"],
					width: activeStyle["border" + side + "Width"]
				})),
				headingSize: parseFloat(headingStyle.fontSize),
				tabSize: parseFloat(inactiveStyle.fontSize),
				headingWeight: Number(headingStyle.fontWeight),
				tabWeight: Number(inactiveStyle.fontWeight),
				activeWeight: Number(activeStyle.fontWeight),
				groupSeparator: groupStyle.borderTopStyle
			};
		})()`);
		assert.equal(styles.current, "location", `${label}: selected section is accessible`);
		assert.notEqual(
			styles.activeBackground,
			styles.inactiveBackground,
			`${label}: selected tab has a filled background`,
		);
		assert.equal(styles.shadow, "none", `${label}: no bracket or underline selection decoration`);
		for (const border of styles.borders) {
			assert.equal(border.style, "solid", `${label}: full selection border`);
			assert.equal(border.width, "1px", `${label}: subtle selection border`);
			assert.notEqual(border.color, "rgba(0, 0, 0, 0)", `${label}: visible selection border`);
			assert.equal(border.color, styles.borders[0].color, `${label}: uniform selection border`);
		}
		assert.ok(styles.headingSize < styles.tabSize, `${label}: group titles are smaller than tabs`);
		assert.ok(
			styles.headingWeight > styles.tabWeight,
			`${label}: group titles have distinct typographic weight`,
		);
		assert.ok(styles.activeWeight > styles.tabWeight, `${label}: selected label is emphasized`);
		assert.equal(styles.groupSeparator, "solid", `${label}: settings groups have a separator`);
	}

	async function checkContrast(label) {
		await sleep(180);
		const contrasts = await host(`(() => {
			const rgb = color => color.match(/[\\d.]+/g)?.map(Number) ?? [];
			const luminance = color => rgb(color).slice(0, 3)
				.map(value => value / 255)
				.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
				.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
			return [...document.querySelectorAll(
				".page-title, .page-subtitle, .chat-topbar h1, .chat-empty p, .chat-empty-hint, " +
				".settings-section:not([hidden]) .settings-section-header h1, .command-button:not(:disabled), " +
				".settings-navigation-group-heading, .settings-navigation nav button, " +
				".global-search-input-row input, .global-search-result-copy strong, .global-search-result-copy small, " +
				".global-search-section-label, .global-search-dialog footer, " +
				".pi-plugin-badges .status-badge, " +
				".markdown-body details > summary, " +
				".session-filter-label, .session-filter-hint, .session-filter-count, " +
				".text-selection-actions button[type=submit]:not(:disabled), .analyze-context-button"
			)].filter(element => element.getBoundingClientRect().width > 0).map(element => {
				let background = element;
				while (background.parentElement && (
					getComputedStyle(background).backgroundColor === "transparent" ||
					rgb(getComputedStyle(background).backgroundColor)[3] === 0
				)) background = background.parentElement;
				const foreground = luminance(getComputedStyle(element).color);
				const behind = luminance(getComputedStyle(background).backgroundColor);
				return {
					text: (element.textContent.trim() || element.getAttribute("aria-label") || "").slice(0, 55),
					ratio: (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05)
				};
			});
		})()`);
		for (const { text, ratio } of contrasts) {
			assert.ok(ratio >= 4.5, `${label}: "${text}" contrast ${ratio.toFixed(2)} < 4.5`);
		}
	}

	async function checkWorkspaceSources(
		label,
		{ workspace = "Workspace", sources = "Sources", addSources = "Add sources" } = {},
	) {
		const result = await host(`(() => {
			const heading = document.querySelector(".sources-catalog .library-section-heading");
			const button = heading.querySelector(".command-button");
			const title = heading.querySelector("h2");
			const headingRect = heading.getBoundingClientRect();
			const buttonRect = button.getBoundingClientRect();
			const titleRect = title.getBoundingClientRect();
			return {
				pageTitle: document.querySelector(".page-title").textContent.trim(),
				navigationLabel: document.querySelector('.app-sidebar-footer a[href="#/sources"]')
					.getAttribute("aria-label"),
				sectionTitle: title.firstChild.textContent.trim(),
				buttonLabel: button.getAttribute("aria-label"),
				buttonTooltip: button.title,
				buttonText: button.textContent.trim(),
				addIcon: Boolean(button.querySelector(".lucide-plus[aria-hidden=true]")),
				headingText: heading.textContent.trim().replace(/\\s+/g, " "),
				workspaceParagraphs: document.querySelectorAll(".sources-workspace-copy > p").length,
				workspacePath: Boolean(document.querySelector(".sources-workspace-path")),
				buttonCount: document.querySelectorAll(".sources-page .command-button").length,
				pageHeaderButtons: document.querySelectorAll(".sources-page .page-header button").length,
				emptyStateButtons: document.querySelectorAll(".sources-empty-state button").length,
				sourceCount: Number(title.querySelector(".library-count").textContent),
				rowCount: document.querySelectorAll(".source-row").length,
				rowStatuses: document.querySelectorAll(".source-row .source-status").length,
				rightAlignment: Math.abs(headingRect.right - buttonRect.right),
				centerAlignment: Math.abs((titleRect.top + titleRect.bottom) / 2
					- (buttonRect.top + buttonRect.bottom) / 2),
				visible: buttonRect.width > 0 && buttonRect.left >= 0
					&& buttonRect.right <= innerWidth,
				squareButton: Math.abs(buttonRect.width - buttonRect.height) <= 1,
				desktop: innerWidth >= 768
			};
		})()`);
		assert.equal(result.pageTitle, workspace, `${label}: workspace page title`);
		assert.equal(result.navigationLabel, workspace, `${label}: workspace navigation label`);
		assert.equal(result.sectionTitle, sources, `${label}: sources is a subsection`);
		assert.equal(result.buttonLabel, addSources, `${label}: add sources label`);
		assert.equal(result.buttonTooltip, addSources, `${label}: localized icon tooltip`);
		assert.equal(result.buttonText, "", `${label}: add sources is icon-only`);
		assert.equal(result.addIcon, true, `${label}: add sources shows a decorative plus icon`);
		assert.equal(
			result.headingText,
			`${sources} ${result.sourceCount}`,
			`${label}: no indexed or scanning summary in the heading`,
		);
		assert.equal(result.workspaceParagraphs, 1, `${label}: workspace copy is reduced to its path`);
		assert.equal(result.workspacePath, true, `${label}: workspace path remains visible`);
		assert.equal(result.buttonCount, 1, `${label}: one consistent add sources action`);
		assert.equal(result.pageHeaderButtons, 0, `${label}: no page-level source action`);
		assert.equal(result.emptyStateButtons, 0, `${label}: no duplicate empty-state action`);
		assert.equal(result.sourceCount, result.rowCount, `${label}: source count remains accurate`);
		assert.equal(result.rowStatuses, result.rowCount, `${label}: individual source status remains`);
		assert.ok(result.rightAlignment <= 1, `${label}: action at the right of the sources heading`);
		assert.equal(result.visible, true, `${label}: add sources is not clipped`);
		assert.equal(result.squareButton, true, `${label}: compact square icon action`);
		if (result.desktop)
			assert.ok(result.centerAlignment <= 1, `${label}: action shares the sources title row`);
	}

	async function checkAddSourcesAction() {
		await host(`window.rhyza = {
			sourceAdd: () => new Promise((resolve, reject) => {
				window.uiResolveSources = resolve;
				window.uiRejectSources = reject;
			})
		}; undefined;`);
		try {
			await host('document.querySelector(".sources-add-button").click()');
			await until(
				'document.querySelector(".sources-add-button").disabled',
				"adding sources disables the section action",
			);
			assert.equal(
				await host('document.querySelector(".sources-add-button").getAttribute("aria-label")'),
				"Adding sources…",
			);
			assert.equal(
				await host('document.querySelector(".sources-add-button").getAttribute("aria-busy")'),
				"true",
			);
			assert.equal(
				await host('Boolean(document.querySelector(".sources-add-button .animate-spin"))'),
				true,
			);
			await host('window.uiRejectSources(new Error("Could not add the selected folder."))');
			await until(
				'document.querySelector(".library-feedback[role=alert]")?.textContent.trim() === "Could not add the selected folder."',
				"add sources failure is visible",
			);
			assert.equal(await host('document.querySelector(".sources-add-button").disabled'), false);
			await host('document.querySelector(".sources-add-button").click()');
			await until('!document.querySelector(".library-feedback")', "retry clears the source error");
			await host(`window.uiResolveSources([{
				id: "ui-added-source",
				name: "Added handbook",
				path: "C:\\\\demo\\\\added-handbook",
				fileCount: 6,
				status: "indexed",
				type: "docs"
			}])`);
			await until(
				'document.querySelectorAll(".source-row").length === 1',
				"source added to catalog",
			);
			assert.equal(await host('document.querySelector(".sources-add-button").disabled'), false);
			await checkWorkspaceSources("after adding sources");
		} finally {
			await host(`delete window.rhyza;
				delete window.uiResolveSources;
				delete window.uiRejectSources;
				window.uiStore.setState({ sources: [] });`);
			await settle();
		}
	}

	async function seedContent() {
		const timestamp = "2026-09-18T10:24:00.000Z";
		await host(
			`window.uiStore.setState(${JSON.stringify({
				sessions: [
					{
						id: "ui-session",
						parentId: null,
						title: "Understanding conversation branches",
						isRoot: true,
						status: "idle",
					},
				],
				activeSessionId: "ui-session",
				visibleSessionId: "ui-session",
				turns: [
					{
						id: "ui-question",
						sessionId: "ui-session",
						role: "user",
						status: "complete",
						content: "How do branches preserve the context of a conversation?",
						createdAt: timestamp,
					},
					{
						id: "ui-answer",
						sessionId: "ui-session",
						role: "assistant",
						status: "complete",
						content:
							"## A separate thread, shared context\n\nA branch keeps the discussion up to its starting point. New messages stay in the new thread.\n\n- Revisit the original path at any time.\n- Keep related ideas together.\n- Save durable concepts to the knowledge base.",
						createdAt: timestamp,
						completedAt: timestamp,
					},
				],
				entities: [
					{
						id: "ui-entity",
						name: "Conversation branches",
						aliases: [],
						type: "concept",
						summary: "Independent paths that retain their shared conversation context.",
						content:
							"A branch preserves prior context while allowing an idea to develop independently.",
						confidence: "confirmed",
						sourceScope: "workspace",
						sourceRefs: [],
						version: 1,
						updatedAt: timestamp,
					},
				],
				relations: [],
				sources: [
					{
						id: "ui-source",
						name: "Workspace handbook",
						path: "C:\\demo\\workspace-handbook",
						fileCount: 23,
						status: "indexed",
						type: "docs",
						indexedAt: timestamp,
					},
				],
				changesets: [
					{
						id: "ui-change",
						title: "Document conversation branches",
						timestamp,
						sessionId: "ui-session",
						summary: "Added a concept from the conversation.",
						actor: "agent",
						status: "committed",
						operations: [
							{
								kind: "entity",
								action: "create",
								objectId: "ui-entity",
								label: "Conversation branches",
								after: { name: "Conversation branches", type: "concept" },
							},
						],
					},
				],
				selectedEntityId: "ui-entity",
			})})`,
		);
		await settle();
	}

	async function checkComposerModelMenu() {
		await navigate("/", ".chat-topbar h1");
		const previousSettings = await host("window.uiStore.getState().settings");
		await host(`window.uiPreviousBridge = window.rhyza;
			window.rhyza = {
				isElectron: true,
				windowThemeSet: async () => ({ ok: true }),
				modelCatalog: async () => ({
					models: Array.from({ length: 40 }, (_, index) => ({
						id: "ui-model-" + index,
						name: "Model " + String(index).padStart(2, "0"),
						contextWindow: 128000,
						reasoning: true
					}))
				})
			}; undefined;`);
		try {
			await host('window.uiStore.getState().updateSettings({ provider: "codex" })');
			await settle();
			await host('window.uiStore.getState().updateSettings({ provider: "github-copilot" })');
			await settle();
			await host('window.uiStore.getState().updateSettings({ defaultModel: "ui-model-12" })');
			await until(
				'document.querySelector(".composer-model-trigger")?.textContent.includes("Model 12")',
				"model catalog fixture",
			);
			for (const theme of ["light", "dark"]) {
				for (const width of [1024, 375]) {
					browser.setContentSize(width, 800);
					await setAppearance(theme, {
						fontScale: width === 375 ? 1.35 : 1,
						highContrast: width === 375,
					});
					await host(`document.querySelector(".composer-model-trigger").focus();
						document.querySelector(".composer-model-trigger").click();`);
					await until(
						'Boolean(document.querySelector(".composer-model-settings"))',
						"combined model and effort menu",
					);
					await settle();
					const layout = await host(`(() => {
						const trigger = document.querySelector(".composer-model-trigger");
						const bounds = trigger.getBoundingClientRect();
						const menu = document.querySelector(".composer-model-settings").getBoundingClientRect();
						return {
							pill: parseFloat(getComputedStyle(trigger).borderRadius) >= bounds.height / 2,
							height: bounds.height,
							icons: trigger.querySelectorAll("svg").length,
							efforts: [...document.querySelectorAll(".composer-effort-options button")].map(button => ({
								surface: getComputedStyle(button).backgroundColor,
								checked: button.getAttribute("aria-checked")
							})),
							inViewport: menu.left >= 0 && menu.right <= innerWidth && menu.top >= 0 && menu.bottom <= innerHeight,
							labelFits: trigger.scrollWidth <= trigger.clientWidth
						};
					})()`);
					assert.equal(layout.pill, true, `${theme} ${width}: compact pill trigger`);
					assert(layout.height <= 42, "model control remains compact with enlarged text");
					assert.equal(layout.icons, 1, "trigger only retains the disclosure chevron");
					assert.equal(layout.efforts.length, 4);
					assert.equal(
						new Set(layout.efforts.map((item) => item.surface)).size,
						4,
						"effort levels have distinct theme surfaces",
					);
					assert.equal(layout.efforts.filter((item) => item.checked === "true").length, 1);
					assert.equal(layout.inViewport, true);
					assert.equal(layout.labelFits, true);
					await checkContrast(`${theme} ${width} model settings`);
					await host('document.querySelector(".composer-model-entry").click()');
					await until(
						'Boolean(document.querySelector(".composer-model-menu"))',
						"second-level model list",
					);
					await settle();
					const list = await host(`(() => {
						const menu = document.querySelector(".composer-model-menu");
						const bounds = menu.getBoundingClientRect();
						return {
							options: menu.querySelectorAll('[role="option"]').length,
							icons: menu.querySelectorAll("svg").length,
							optionHeight: menu.querySelector('[data-value="ui-model-0"]').getBoundingClientRect().height,
							scrollable: menu.scrollHeight > menu.clientHeight,
							initialScroll: menu.scrollTop,
							inViewport: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
						};
					})()`);
					assert.equal(list.options, 41);
					assert.equal(
						list.icons,
						1,
						"only the selected model has a check; no repeated leading icons",
					);
					assert(
						list.optionHeight <= 46 * (width === 375 ? 1.35 : 1),
						`${theme} ${width}: two-line model rows remain compact at the selected text scale (${list.optionHeight}px)`,
					);
					assert.equal(list.scrollable, true);
					assert(list.initialScroll > 0, "opening reveals the selected model");
					assert.equal(list.inViewport, true);
					await host(`(() => {
						const menu = document.querySelector(".composer-model-menu");
						menu.scrollTop = 17;
					})()`);
					await settle();
					const hoverScroll = await host(`(() => {
						const menu = document.querySelector(".composer-model-menu");
						const bounds = menu.getBoundingClientRect();
						const partial = [...menu.querySelectorAll('[role="option"]')].find(option => {
							const item = option.getBoundingClientRect();
							return item.top < bounds.bottom && item.bottom > bounds.bottom;
						});
						partial.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementY: 1 }));
						return menu.scrollTop;
					})()`);
					await settle();
					assert.equal(
						await host('document.querySelector(".composer-model-menu").scrollTop'),
						hoverScroll,
						"hovering a partially visible row does not pull the list",
					);
					await host(`(() => {
						const trigger = document.querySelector(".composer-model-entry");
						const measure = trigger.getBoundingClientRect.bind(trigger);
						window.uiModelMeasurements = 0;
						trigger.getBoundingClientRect = () => { window.uiModelMeasurements++; return measure(); };
					})()`);
					const wheelPoint = await host(`(() => {
						const bounds = document.querySelector(".composer-model-menu").getBoundingClientRect();
						return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + 40) };
					})()`);
					const backgroundScroll = await host('document.querySelector(".chat-scroll").scrollTop');
					browser.webContents.sendInputEvent({ type: "mouseMove", ...wheelPoint });
					await settle();
					const positions = [
						await host('document.querySelector(".composer-model-menu").scrollTop'),
					];
					for (let index = 0; index < 4; index++) {
						browser.webContents.sendInputEvent({
							type: "mouseWheel",
							...wheelPoint,
							deltaX: 0,
							deltaY: -80,
							canScroll: true,
						});
						await sleep(100);
						positions.push(await host('document.querySelector(".composer-model-menu").scrollTop'));
					}
					assert(
						positions.at(-1) - positions[0] >= 200,
						`native wheel scrolling progresses: ${positions.join(", ")}`,
					);
					assert(
						positions.every((value, index) => index === 0 || value >= positions[index - 1]),
						"scrolling never snaps backwards",
					);
					assert.equal(
						await host("window.uiModelMeasurements"),
						0,
						"internal scrolling does not reposition the list",
					);
					assert.equal(
						await host('document.querySelector(".chat-scroll").scrollTop'),
						backgroundScroll,
						"model scrolling does not move the reading area",
					);
					browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "End" });
					await settle();
					assert(
						await host(`(() => {
						const menu = document.querySelector(".composer-model-menu");
						const option = document.getElementById(menu.getAttribute("aria-activedescendant"));
						const bounds = menu.getBoundingClientRect();
						const item = option.getBoundingClientRect();
						return option.dataset.value === "ui-model-39" && item.top >= bounds.top && item.bottom <= bounds.bottom;
					})()`),
						"keyboard navigation still reveals the last model",
					);
					browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
					await until(
						'!document.querySelector(".composer-model-menu")',
						"Escape closes only the model list",
					);
					assert(
						await host('Boolean(document.querySelector(".composer-model-settings"))'),
						"first-level menu remains open",
					);
					assert.equal(
						await host('document.activeElement?.classList.contains("composer-model-entry")'),
						true,
					);
					await host(
						'document.querySelector(".composer-effort-options [data-effort=high]").click()',
					);
					await until(
						'!document.querySelector(".composer-model-settings")',
						"choosing effort closes the menu",
					);
					assert.equal(await host("window.uiStore.getState().settings.thinkingLevel"), "high");
					assert.equal(
						await host('document.activeElement?.classList.contains("composer-model-trigger")'),
						true,
						"focus returns to the combined trigger",
					);
				}
			}
			browser.setContentSize(1024, 800);
			await host('document.querySelector(".composer-model-trigger").click()');
			await until(
				'Boolean(document.querySelector(".composer-model-entry"))',
				"model picker reopens",
			);
			await host('document.querySelector(".composer-model-entry").click()');
			await until('Boolean(document.querySelector(".composer-model-menu"))', "model list reopens");
			await settle();
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Home" });
			await settle();
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Down" });
			await settle();
			assert.deepEqual(
				await host(`(() => {
					const menu = document.querySelector(".composer-model-menu");
					return {
						focus: document.activeElement?.getAttribute("role"),
						value: document.getElementById(menu.getAttribute("aria-activedescendant"))?.dataset.value
					};
				})()`),
				{ focus: "listbox", value: "ui-model-0" },
				"ArrowDown after Home targets the first explicit model",
			);
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
			await until(
				'!document.querySelector(".composer-model-settings")',
				"model selection closes both levels",
			);
			assert.equal(await host("window.uiStore.getState().settings.defaultModel"), "ui-model-0");
			assert.equal(
				await host("window.uiStore.getState().settings.thinkingLevel"),
				"high",
				"model selection preserves effort",
			);
		} finally {
			await host(`window.rhyza = window.uiPreviousBridge;
				delete window.uiPreviousBridge;
				delete window.uiModelMeasurements;
				window.uiStore.getState().updateSettings(${JSON.stringify(previousSettings)});`);
			await settle();
		}
	}

	async function checkComposerInputAndContext() {
		await navigate("/", ".chat-topbar h1");
		const previousSettings = await host("window.uiStore.getState().settings");
		try {
			for (const theme of ["light", "dark"]) {
				for (const width of [1024, 375]) {
					browser.setContentSize(width, 800);
					await setAppearance(theme, {
						fontScale: width === 375 ? 1.35 : 1,
						highContrast: width === 375,
					});
					await setInput(".composer-input", "A short draft");
					await host('document.querySelector(".composer-input").focus()');
					await settle();
					const input = await host(`(() => {
						const input = document.querySelector(".composer-input");
						const style = getComputedStyle(input);
						return {
							height: input.getBoundingClientRect().height,
							lineHeight: parseFloat(style.lineHeight),
							paddingBottom: parseFloat(style.paddingBottom),
							maxHeight: parseFloat(style.maxHeight),
							border: parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth),
							borderStyle: style.borderTopStyle,
							shadow: style.boxShadow,
							outline: style.outlineStyle,
							background: style.backgroundColor
						};
					})()`);
					assert.equal(input.border, 0, "the editing area has no nested border");
					assert.equal(
						input.borderStyle,
						"none",
						"no other theme selector can draw a textarea rectangle",
					);
					assert.equal(input.shadow, "none", "focused editing does not add an inner focus frame");
					assert.equal(input.outline, "none");
					assert.equal(input.background, "rgba(0, 0, 0, 0)");
					assert(
						input.paddingBottom >= input.lineHeight,
						"a spare text line separates input from controls",
					);
					await setInput(".composer-input", "First line\nSecond line\nThird line");
					const threeLines = await host(
						'document.querySelector(".composer-input").getBoundingClientRect().height',
					);
					assert(
						Math.abs(threeLines - Math.min(input.maxHeight, input.height + input.lineHeight * 2)) <=
							2,
						"multiline input grows while preserving the spare line",
					);
					await setInput(
						".composer-input",
						Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join("\n"),
					);
					assert(
						await host(`(() => {
						const input = document.querySelector(".composer-input");
						const controls = document.querySelector(".composer-runtime-controls").getBoundingClientRect();
						return getComputedStyle(input).overflowY === "auto"
							&& input.scrollHeight > input.clientHeight
							&& input.getBoundingClientRect().height <= ${input.maxHeight}
							&& controls.bottom <= innerHeight;
					})()`),
						"long drafts scroll inside the editor without displacing controls",
					);
					await setInput(".composer-input", "Keep this draft while checking context");
					await host('document.querySelector(".composer-input").focus()');
					const ringPoint = await host(`(() => {
						const bounds = document.querySelector(".composer-context-ring").getBoundingClientRect();
						return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
					})()`);
					browser.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
					browser.webContents.sendInputEvent({ type: "mouseMove", ...ringPoint });
					await until(
						'Boolean(document.querySelector(".composer-context-popover"))',
						"context tooltip opens on hover without a click",
					);
					await settle();
					assert.equal(
						await host('document.activeElement?.classList.contains("composer-input")'),
						true,
						"hover never steals typing focus",
					);
					const tooltip = await host(`(() => {
						const tooltip = document.querySelector(".composer-context-popover");
						const bounds = tooltip.getBoundingClientRect();
						const ring = document.querySelector(".composer-context-ring");
						return {
							role: tooltip.getAttribute("role"),
							described: ring.getAttribute("aria-describedby") === tooltip.id,
							buttons: tooltip.querySelectorAll("button").length,
							footer: tooltip.querySelectorAll("p").length,
							gap: ring.getBoundingClientRect().top - bounds.bottom,
							inViewport: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
							point: { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) }
						};
					})()`);
					assert.equal(tooltip.role, "tooltip");
					assert.equal(tooltip.described, true);
					assert.equal(tooltip.buttons, 0, "hover feedback has no redundant close button");
					assert.equal(tooltip.footer, 0, "hover feedback has no redundant explanatory footer");
					assert(
						Math.abs(tooltip.gap - 8) <= 1,
						`measured tooltip gap stays close to the ring: ${tooltip.gap}`,
					);
					assert.equal(tooltip.inViewport, true);
					assert.match(
						await host('document.querySelector(".composer-context-popover").textContent'),
						/Not recorded/,
					);
					browser.webContents.sendInputEvent({ type: "mouseMove", ...tooltip.point });
					await sleep(150);
					assert(
						await host('Boolean(document.querySelector(".composer-context-popover"))'),
						"the pointer can cross into the tooltip without flicker",
					);
					browser.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
					await until(
						'!document.querySelector(".composer-context-popover")',
						"context tooltip hides on pointer exit",
					);
					// Offscreen Chromium changes activeElement without delivering native focus events.
					await host(`(() => {
						const ring = document.querySelector(".composer-context-ring");
						ring.focus();
						ring.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
					})()`);
					await settle();
					const focusedTooltip = await host(`({
							focused: document.activeElement?.classList.contains("composer-context-ring"),
							open: Boolean(document.querySelector(".composer-context-popover"))
						})`);
					assert(
						focusedTooltip.focused && focusedTooltip.open,
						`${theme} ${width}: keyboard focus reveals context: ${JSON.stringify(focusedTooltip)}`,
					);
					browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
					await until(
						'!document.querySelector(".composer-context-popover")',
						"Escape dismisses the focused tooltip",
					);
					assert.equal(
						await host('document.activeElement?.classList.contains("composer-context-ring")'),
						true,
					);
					await host(
						'document.querySelector(".composer-context-ring").blur(); document.querySelector(".composer-context-ring").click();',
					);
					await until(
						'Boolean(document.querySelector(".composer-context-popover"))',
						"click fallback works for touch",
					);
					browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
					await until(
						'!document.querySelector(".composer-context-popover")',
						"touch fallback dismisses",
					);
					assert.equal(
						await host('document.querySelector(".composer-input").value'),
						"Keep this draft while checking context",
					);
				}
			}
		} finally {
			await setInput(".composer-input", "");
			await host(`window.uiStore.getState().updateSettings(${JSON.stringify(previousSettings)})`);
			await settle();
		}
	}

	async function checkSettingsIconActions() {
		await navigate("/", ".chat-topbar h1");
		await host(`window.uiPluginCalls = [];
			window.uiPlugins = [
				{ source: "npm:ui-package", scope: "user", installed: true },
				{ source: "npm:workspace-package", scope: "project", installed: false }
			];
			window.rhyza = {
				isElectron: true,
				getWorkspace: async () => ({ path: null }),
				pluginList: async () => window.uiPlugins,
				pluginInstall: async request => {
					window.uiPluginCalls.push(["install", request.source]);
					return { plugins: window.uiPlugins };
				},
				pluginRemove: request => {
					window.uiPluginCalls.push(["remove", request.source]);
					return new Promise(resolve => { window.uiResolveRemove = resolve; });
				},
				pluginSelectLocal: async () => ({ source: null }),
				openExternal: async () => { window.uiPluginCalls.push(["browse"]); },
				providerStatus: async () => ({ providerId: "github-copilot", configured: true, source: "fixture" }),
				modelCatalog: async () => ({ models: [] }),
				providerLogin: async () => ({ ok: true, status: { configured: true } }),
				providerLogout: async () => ({ ok: true, status: { configured: false } }),
				onAuthEvent: () => () => {},
				windowThemeSet: async () => ({ ok: true })
			}; undefined;`);
		try {
			await navigate("/settings", ".settings-section:not([hidden]) h1");
			await until(
				'!document.querySelector(".provider-auth-action").disabled',
				"provider fixture ready",
			);
			for (const language of ["en", "zh-CN", "zh-TW"]) {
				for (const theme of ["light", "dark"]) {
					await setAppearance(theme, { language });
					for (const width of [1024, 375]) {
						browser.setContentSize(width, 960);
						await host('document.querySelector("[data-section=provider-heading]").click()');
						await settle();
						await checkIconButtons(
							".settings-provider-connection .settings-icon-action",
							`${language} ${theme} ${width} provider`,
							2,
						);
						await host('document.querySelector("[data-section=plugins-heading]").click()');
						await until(
							'Boolean(document.querySelector(".pi-plugin-remove"))',
							"package fixture ready",
						);
						await settle();
						await checkIconButtons(
							".pi-plugins-card .settings-icon-action",
							`${language} ${theme} ${width} packages`,
							5,
						);
						assert.equal(await host('document.querySelectorAll("[data-plugin-scope]").length'), 2);
						assert.equal(await host('document.querySelectorAll("[data-plugin-status]").length'), 2);
						const colors =
							await host(`["[data-plugin-scope=user]", "[data-plugin-status=installed]", "[data-plugin-status=missing]"].map(selector => {
							const style = getComputedStyle(document.querySelector(selector));
							return [style.backgroundColor, style.color].join("/");
						})`);
						assert.equal(
							new Set(colors).size,
							3,
							`${language} ${theme}: scope, installed and missing have separate semantic colors`,
						);
						await checkContrast(`${language} ${theme} package badges`);
					}
				}
			}
			await setAppearance("light", { language: "en" });
			await setInput("#pi-plugin-source", "npm:another-ui-package");
			await host('document.querySelector(".pi-plugin-install-action").click()');
			await until('window.uiPluginCalls.some(call => call[0] === "install")', "install icon works");
			await host('document.querySelector(".pi-plugin-browse-action").click()');
			await until('window.uiPluginCalls.some(call => call[0] === "browse")', "browse icon works");
			await host(
				'document.querySelector(".pi-plugin-remove").focus(); document.querySelector(".pi-plugin-remove").click()',
			);
			await until(
				'document.querySelector(".confirmation-dialog")?.open',
				"package removal confirmation",
			);
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
			await until('!document.querySelector(".confirmation-dialog")', "package removal canceled");
			assert.equal(
				await host('window.uiPluginCalls.some(call => call[0] === "remove")'),
				false,
				"cancel leaves package configuration intact",
			);
			await host('document.querySelector(".pi-plugin-remove").click()');
			await until(
				'document.querySelector(".confirmation-dialog")?.open',
				"package removal reopens",
			);
			await host('document.querySelector(".confirmation-submit").click()');
			await until(
				'document.querySelector(".pi-plugin-remove").getAttribute("aria-busy") === "true"',
				"package removal busy",
			);
			assert.equal(await host('document.querySelector(".pi-plugin-remove").disabled'), true);
			await host("window.uiPlugins = []; window.uiResolveRemove({ plugins: [] });");
			await until('!document.querySelector(".pi-plugin-remove")', "package removal completes");
		} finally {
			await host(
				"delete window.rhyza; delete window.uiPluginCalls; delete window.uiPlugins; delete window.uiResolveRemove;",
			);
			await navigate("/", ".chat-topbar h1");
			await setAppearance("light", { language: "en" });
		}
	}

	async function checkIconButtons(selector, label, count) {
		const actions =
			await host(`(() => [...document.querySelectorAll(${JSON.stringify(selector)})].map(button => {
			const bounds = button.getBoundingClientRect();
			return {
				text: button.textContent.trim(),
				icon: Boolean(button.querySelector("svg[aria-hidden=true]")),
				title: button.title,
				name: button.getAttribute("aria-label"),
				square: Math.abs(bounds.width - bounds.height) < 1,
				inViewport: bounds.left >= 0 && bounds.right <= innerWidth
			};
		}))()`);
		assert.equal(actions.length, count, `${label}: action count`);
		for (const action of actions) {
			assert.equal(action.text, "", `${label}: action is icon-only`);
			assert.equal(action.icon, true, `${label}: decorative icon`);
			assert.ok(action.title && action.name, `${label}: tooltip and accessible name`);
			assert.equal(action.square, true, `${label}: consistent square geometry`);
			assert.equal(action.inViewport, true, `${label}: action is not clipped`);
		}
	}

	async function checkRecoveryButtonLayout() {
		await seedContent();
		await navigate("/", ".chat-topbar h1");
		await host('window.uiStore.getState().updateTurn("ui-answer", { status: "interrupted" })');
		for (const language of ["en", "zh-CN", "zh-TW"]) {
			for (const theme of ["light", "dark"]) {
				await setAppearance(theme, { language, fontScale: 1.35 });
				for (const width of [1024, 375]) {
					browser.setContentSize(width, 812);
					await settle();
					await checkIconButtons(
						"#turn-ui-answer .turn-recovery-action",
						`${language} ${theme} ${width} recovery`,
						2,
					);
					const names = await host(
						'[...document.querySelectorAll("#turn-ui-answer .turn-recovery-action")].map(button => button.getAttribute("aria-label"))',
					);
					assert.deepEqual(
						names,
						language === "en"
							? ["Retry", "Edit and retry"]
							: language === "zh-CN"
								? ["重试", "编辑后重试"]
								: ["重試", "編輯後重試"],
					);
					if (width === 375) await screenshot(`recovery-${language}-${theme}`);
				}
			}
		}
		await setAppearance("light", { language: "en", fontScale: 1 });
		await seedContent();
	}

	async function checkDesignContracts() {
		browser.setContentSize(1024, 800);
		await seedContent();
		await setAppearance("dark", { language: "en", autoExtract: false, reduceMotion: true });
		await navigate("/", ".chat-topbar h1");
		await host(`document.querySelector(".composer-input").focus();
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, shiftKey: true, bubbles: true }));`);
		await until(
			'document.querySelector(".global-search-dialog")?.matches(":modal")',
			"search native modal",
		);
		await checkContrast("dark global search");
		await host('document.querySelector(".composer-input").focus()');
		assert.equal(
			await host(
				'document.activeElement.closest("dialog")?.classList.contains("global-search-dialog")',
			),
			true,
			"background cannot steal search focus",
		);
		for (let index = 0; index < 8; index++)
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
		await settle();
		assert.equal(
			await host(
				'document.activeElement.closest("dialog")?.classList.contains("global-search-dialog")',
			),
			true,
			"Tab stays within the modal",
		);
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
		await until('!document.querySelector(".global-search-dialog")', "native search Escape");
		assert.equal(
			await host('document.activeElement.classList.contains("composer-input")'),
			true,
			"search restores input focus",
		);
		await host('document.querySelector(".composer-context-ring").click()');
		await until(
			'Boolean(document.querySelector(".composer-context-popover"))',
			"context usage popup",
		);
		await settle();
		assert.match(
			await host('document.querySelector(".composer-context-popover").textContent'),
			/Not recorded/,
		);
		assert.equal(
			await host(`(() => {
			const bounds = document.querySelector(".composer-context-popover").getBoundingClientRect();
			return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
		})()`),
			true,
			`context popup fits the viewport: ${await host('JSON.stringify(document.querySelector(".composer-context-popover").getBoundingClientRect())')}`,
		);
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
		await until('!document.querySelector(".composer-context-popover")', "context dismissal");
		await host(`(() => {
			const trigger = document.querySelector("#turn-ui-answer .turn-detail-trigger");
			trigger.focus();
			trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
		})()`);
		await settle();
		const turnTooltip = await host(`(() => {
			const trigger = document.querySelector("#turn-ui-answer .turn-detail-trigger");
			const popover = document.querySelector(".turn-detail-popover");
			const bounds = popover.getBoundingClientRect();
			const triggerBounds = trigger.getBoundingClientRect();
			return {
				title: trigger.title,
				description: trigger.getAttribute("aria-describedby") === popover.id,
				controls: trigger.getAttribute("aria-controls") === popover.id,
				role: popover.getAttribute("role"),
				content: popover.textContent.includes("Token breakdown"),
				titleArea: Boolean(popover.querySelector("header")),
				modal: Boolean(document.querySelector(".turn-detail-dialog, .turn-detail-backdrop")),
				inViewport: bounds.left >= 0 && bounds.right <= innerWidth
					&& bounds.top >= 0 && bounds.bottom <= innerHeight,
				placement: popover.classList.contains("turn-detail-popover-bottom") ? "bottom" : "top",
				expectedPlacement: triggerBounds.top + triggerBounds.height / 2 > innerHeight / 2
					? "bottom"
					: "top",
				rightInset: innerWidth - bounds.right,
				verticalInset: popover.classList.contains("turn-detail-popover-bottom")
					? innerHeight - bounds.bottom
					: bounds.top,
				distinctSurface: getComputedStyle(popover).backgroundColor
					!== getComputedStyle(document.querySelector(".chat-pane")).backgroundColor
			};
		})()`);
		assert.equal(turnTooltip.title, "", "turn details no longer use the browser tooltip");
		assert.equal(turnTooltip.description, true, "usage popover describes its trigger");
		assert.equal(turnTooltip.controls, true, "trigger identifies its usage popover");
		assert.equal(turnTooltip.role, "tooltip");
		assert.equal(turnTooltip.content, true, "the hover surface contains the full usage details");
		assert.equal(turnTooltip.titleArea, false, "the details title area is removed");
		assert.equal(turnTooltip.modal, false, "turn details no longer opens a modal");
		assert.equal(turnTooltip.inViewport, true, "usage popover stays inside the viewport");
		assert.equal(
			turnTooltip.placement,
			turnTooltip.expectedPlacement,
			"usage popover chooses the upper or lower right corner based on the trigger position",
		);
		assert.equal(turnTooltip.rightInset <= 16, true, "usage popover stays close to the right edge");
		assert.equal(
			turnTooltip.verticalInset,
			turnTooltip.placement === "bottom" ? 16 : 48,
			"usage popover uses the appropriate upper or lower edge",
		);
		assert.equal(
			turnTooltip.distinctSurface,
			true,
			"usage popover contrasts with the chat surface",
		);
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
		browser.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
		await until(
			'!document.querySelector(".turn-detail-popover")',
			"Escape closes focused usage popover",
		);
		await host(`(() => {
			const trigger = document.querySelector("#turn-ui-answer .turn-detail-trigger");
			trigger.getBoundingClientRect = () => ({
				top: innerHeight - 48,
				bottom: innerHeight - 24,
				height: 24,
				left: 100,
				right: 124,
				width: 24
			});
			trigger.focus();
			trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
		})()`);
		await settle();
		await until(
			'Boolean(document.querySelector(".turn-detail-popover"))',
			"lower-right usage popover",
		);
		assert.equal(
			await host(
				'document.querySelector(".turn-detail-popover")?.classList.contains("turn-detail-popover-bottom")',
			),
			true,
			"usage popover moves to the lower-right corner for a lower trigger",
		);
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
		await until(
			'!document.querySelector(".turn-detail-popover")',
			"Escape closes lower-right usage popover",
		);
		await host(
			`delete document.querySelector("#turn-ui-answer .turn-detail-trigger").getBoundingClientRect`,
		);
		const detailPoint = await host(`(() => {
			const bounds = document.querySelector("#turn-ui-answer .turn-detail-trigger").getBoundingClientRect();
			return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
		})()`);
		browser.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
		browser.webContents.sendInputEvent({
			type: "mouseMove",
			x: detailPoint.x,
			y: detailPoint.y,
		});
		await until('Boolean(document.querySelector(".turn-detail-popover"))', "hover usage popover");
		const popoverPoint = await host(`(() => {
			const bounds = document.querySelector(".turn-detail-popover").getBoundingClientRect();
			return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
		})()`);
		browser.webContents.sendInputEvent({
			type: "mouseMove",
			x: popoverPoint.x,
			y: popoverPoint.y,
		});
		await settle();
		assert.equal(
			await host('Boolean(document.querySelector(".turn-detail-popover"))'),
			true,
			"moving the pointer from the icon into the details panel keeps it open",
		);
		browser.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
		await until('!document.querySelector(".turn-detail-popover")', "hover usage popover closes");
		await setInput(".composer-input", "Keep this unsent draft");
		await host(`(() => {
			const data = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII="), char => char.charCodeAt(0));
			const files = new DataTransfer();
			files.items.add(new File([data], "draft.png", { type: "image/png" }));
			const input = document.querySelector('.chat-composer input[type="file"]');
			input.files = files.files;
			input.dispatchEvent(new Event("change", { bubbles: true }));
		})()`);
		await until('Boolean(document.querySelector(".composer-attachment"))', "draft attachment");
		await host(`window.uiRequests = [];
			window.rhyza = {
				sourceSearch: async () => [],
				agentPrompt: async request => {
					window.uiRequests.push(request);
					return { ok: false, error: "Fixture request failed." };
				}
			};
			(() => {
				document.activeElement.blur();
				const paragraph = document.querySelector("#turn-ui-answer .markdown-body p");
				const range = document.createRange();
				range.selectNodeContents(paragraph);
				const selection = window.getSelection();
				selection.removeAllRanges();
				selection.addRange(range);
				paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			})();`);
		try {
			await until('Boolean(document.querySelector(".text-selection-menu"))', "selection actions");
			await host('document.querySelectorAll(".text-selection-menu button")[1].click()');
			await until(
				'window.uiRequests.length === 1 && Boolean(document.querySelector(".turn-execution-error"))',
				"selection failure",
			);
			assert.equal(
				await host('document.querySelector(".composer-input").value'),
				"Keep this unsent draft",
				"Explain preserves normal draft",
			);
			assert.deepEqual(
				await host("window.uiRequests[0].images"),
				[],
				"selection request does not inherit composer attachments",
			);
			assert.equal(
				await host('document.querySelectorAll(".composer-attachment").length'),
				1,
				"Explain preserves attachments",
			);
			await host(`(() => {
				const original = window.uiStore.getState().turns.filter(turn => turn.role === "user").at(-1);
				window.uiStore.getState().updateTurn(original.id, { images: [{ mimeType: "image/png", data: "original-image" }] });
				const answer = window.uiStore.getState().turns.filter(turn => turn.role === "assistant").at(-1);
				window.uiStore.getState().updateTurn(answer.id, { content: "Partial response from failed attempt" });
			})()`);
			const retryIdentity = await host(`(() => {
				const turns = window.uiStore.getState().turns;
				return {
					count: turns.length,
					questionId: turns.filter(turn => turn.role === "user").at(-1).id,
					questionContent: turns.filter(turn => turn.role === "user").at(-1).content,
					answerId: turns.filter(turn => turn.role === "assistant").at(-1).id
				};
			})()`);
			const clickRecovery = async (label) => {
				await host(
					`[...document.querySelectorAll(".turn-actions button")].find(button => button.getAttribute("aria-label") === ${JSON.stringify(label)}).click()`,
				);
				await settle();
			};
			await clickRecovery("Retry");
			await until("window.uiRequests.length === 2", "retry request");
			assert.equal(
				await host("window.uiRequests[1].prompt === window.uiRequests[0].prompt"),
				true,
				"Retry retains selected passage",
			);
			assert.deepEqual(
				await host("window.uiRequests[1].images"),
				[{ mimeType: "image/png", data: "original-image" }],
				"Retry restores original attachments, not current draft",
			);
			await until(
				'window.uiStore.getState().turns.filter(turn => turn.role === "assistant").at(-1)?.content === "Fixture request failed."',
				"retry replaces partial response",
			);
			assert.equal(
				await host("window.uiStore.getState().turns.length"),
				retryIdentity.count,
				"Retry reuses the original user and assistant turns",
			);
			assert.equal(
				await host("window.uiRequests[1].frontendTurnId === window.uiRequests[0].frontendTurnId"),
				true,
				"Retry keeps the original assistant turn identity",
			);
			assert.equal(
				await host(
					`window.uiStore.getState().turns.filter(turn => turn.id === ${JSON.stringify(retryIdentity.questionId)}).length`,
				),
				1,
				"Retry does not duplicate the original question",
			);
			assert.equal(
				await host(
					`window.uiStore.getState().turns.find(turn => turn.id === ${JSON.stringify(retryIdentity.questionId)}).content`,
				),
				retryIdentity.questionContent,
				"Retry preserves the original question text",
			);
			assert.equal(
				await host('document.querySelector(".composer-input").value'),
				"Keep this unsent draft",
			);
			await clickRecovery("Edit and retry");
			await until(
				'document.querySelector(".confirmation-dialog")?.open',
				"draft replacement confirmation",
			);
			browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
			await until('!document.querySelector(".confirmation-dialog")', "draft replacement canceled");
			assert.equal(
				await host('document.querySelector(".composer-input").value'),
				"Keep this unsent draft",
			);
			await clickRecovery("Edit and retry");
			await until(
				'document.querySelector(".confirmation-dialog")?.open',
				"draft replacement reopens",
			);
			await host('document.querySelector(".confirmation-submit").click()');
			await until(
				'Boolean(document.querySelector(".composer-retry-quote"))',
				"edit retry retains quote",
			);
			assert.match(
				await host('document.querySelector(".composer-attachment img").src'),
				/original-image/,
			);
			await setInput(".composer-input", "Explain with more detail");
			await host('document.querySelector(".composer-send").click()');
			await until("window.uiRequests.length === 3", "edited retry request");
			assert.equal(
				await host("window.uiStore.getState().turns.length"),
				retryIdentity.count,
				"Edit and retry updates the original turn pair",
			);
			assert.equal(
				await host("window.uiRequests[2].frontendTurnId === window.uiRequests[0].frontendTurnId"),
				true,
				"Edit and retry keeps the original assistant turn identity",
			);
			assert.equal(
				await host(
					'window.uiStore.getState().turns.filter(turn => turn.role === "user" && turn.content === "Explain with more detail").length',
				),
				1,
				"Edit and retry replaces rather than duplicates the question",
			);
			assert.match(
				await host("window.uiRequests[2].prompt"),
				/Selected passage:[\s\S]*User question:\nExplain with more detail/,
			);
			await until('!document.querySelector(".composer-retry-quote")', "sent quote cleared");
		} finally {
			await host("delete window.rhyza; delete window.uiRequests;");
		}
		await host(`window.uiScrollCalls = [];
			window.uiOriginalScrollTo = Element.prototype.scrollTo;
			Element.prototype.scrollTo = function(options) {
				window.uiScrollCalls.push(options);
			};
			document.querySelector('[aria-label="Open turn navigator"]').click();`);
		await until('Boolean(document.querySelector(".turn-navigator-option"))', "turn navigator");
		await host('document.querySelector(".turn-navigator-option").click()');
		assert.equal(
			await host("window.uiScrollCalls.at(-1)?.behavior"),
			"auto",
			"reduced motion disables explicit smooth navigation",
		);
		await host(
			"Element.prototype.scrollTo = window.uiOriginalScrollTo; delete window.uiOriginalScrollTo; delete window.uiScrollCalls;",
		);
		await seedContent();
		await navigate("/knowledge", ".knowledge-page-header h1");
		await host(`window.uiStore.setState({ diagrams: [{
			id: "ui-draft-diagram", name: "Editable diagram", type: "flowchart",
			nodes: [], edges: [], mermaidSource: "flowchart TD\\n A-->B",
			version: 1, versions: [], updatedAt: "2026-09-18T00:00:00Z"
		}] });`);
		await host('document.querySelector("#knowledge-diagrams-tab").click()');
		await until(
			'Boolean(document.querySelector(".knowledge-inspector-content textarea"))',
			"diagram editor",
		);
		await setInput(".knowledge-inspector-content textarea", "flowchart TD\n A-->C");
		await host(
			`window.uiStore.setState(state => ({ diagrams: state.diagrams.map(diagram => ({ ...diagram, name: "Background refresh" })) }))`,
		);
		await settle();
		assert.equal(
			await host('document.querySelector(".knowledge-inspector-content textarea").value'),
			"flowchart TD\n A-->C",
			"background updates preserve unsaved source",
		);
		await setInput(".knowledge-inspector-content textarea", "not a diagram");
		await host('document.querySelector("form.knowledge-inspector-content").requestSubmit()');
		await until(
			'Boolean(document.querySelector("#diagram-source-error"))',
			"invalid diagram feedback",
		);
		assert.equal(
			await host("window.uiStore.getState().diagrams[0].version"),
			1,
			"invalid source not saved",
		);
		await setInput(".knowledge-inspector-content textarea", 'pie\n "A": 1\n "B": 2');
		await host('document.querySelector("form.knowledge-inspector-content").requestSubmit()');
		await until("window.uiStore.getState().diagrams[0].version === 2", "supported diagram save");
		assert.equal(
			await host("window.uiStore.getState().diagrams[0].name"),
			"Background refresh",
			"saving source retains unedited refreshed fields",
		);
		await setInput(".knowledge-inspector-content textarea", "flowchart TD\n A-->B");
		await host('document.querySelector("form.knowledge-inspector-content").requestSubmit()');
		await until("window.uiStore.getState().diagrams[0].version === 3", "flowchart save");
		await until(
			'Boolean(document.querySelector(".mermaid-diagram-canvas .node rect"))',
			"diagram rendering",
		);
		const darkFill = await host(
			'getComputedStyle(document.querySelector(".mermaid-diagram-canvas .node rect")).fill',
		);
		await setAppearance("light");
		await until(
			'Boolean(document.querySelector(".mermaid-diagram-canvas .node rect"))',
			"light diagram rendering",
		);
		assert.notEqual(
			await host(
				'getComputedStyle(document.querySelector(".mermaid-diagram-canvas .node rect")).fill',
			),
			darkFill,
			"theme change updates cached diagram node surfaces",
		);
		await host(
			'document.querySelector(".diagram-export button").focus(); document.querySelector(".diagram-export button").click()',
		);
		await until('Boolean(document.querySelector(".diagram-export-menu"))', "export menu");
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "End" });
		await settle();
		assert.match(await host("document.activeElement.textContent"), /PNG/);
		browser.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
		await until('!document.querySelector(".diagram-export-menu")', "export menu dismissal");
		assert.equal(
			await host('document.activeElement.getAttribute("aria-label")'),
			"Download diagram",
			"export restores focus",
		);
		await navigate("/", ".chat-topbar h1");
		await host(`window.uiSourceFails = true;
			window.rhyza = {
				getWorkspace: async () => ({ path: null }),
				sourceList: async () => {
					if (window.uiSourceFails) throw new Error("Fixture source catalog failed.");
					return [];
				}
			}; undefined;`);
		try {
			await navigate("/sources", ".page-title");
			await until(
				'document.querySelector(".sources-catalog [role=alert]")?.textContent.includes("Fixture source catalog failed.")',
				"source failure shown",
			);
			assert.equal(
				await host("window.uiStore.getState().sources.length"),
				1,
				"catalog failure preserves sources",
			);
			await host(`window.uiSourceFails = false;
				[...document.querySelectorAll(".sources-catalog button")].find(button => button.textContent.trim() === "Retry").click();`);
			await until(
				'!document.querySelector(".sources-catalog [role=alert]") && window.uiStore.getState().sources.length === 0',
				"catalog retry recovers",
			);
		} finally {
			await host(
				"delete window.rhyza; delete window.uiSourceFails; window.uiStore.setState({ diagrams: [] });",
			);
		}
		await seedContent();
		await setAppearance("light", { reduceMotion: false });
	}

	async function checkInteractions() {
		browser.setContentSize(1440, 960);
		await navigate("/", ".chat-topbar h1");
		assert.equal(
			await host('document.querySelector(".app-sidebar-brand").textContent.trim()'),
			"",
			"sidebar titlebar only renders icon controls",
		);
		assert.deepEqual(
			await host(`[...document.querySelector(".app-sidebar-brand").children]
				.map(element => element.matches('[aria-label="Close sidebar"]')
					? "toggle"
					: element.getAttribute("aria-label"))`),
			["toggle", "Search all chats"],
			"browser sidebar retains its toggle and search without the old header navigation",
		);
		assert.equal(
			await host('document.querySelectorAll(".app-sidebar-footer .sidebar-nav-icon").length'),
			5,
			"five destinations occupy the bottom-left navigation",
		);
		assert.equal(
			await host(`(() => {
				const link = document.querySelector(".app-sidebar-footer a[aria-label='Settings']");
				return link.title === "" && getComputedStyle(link, "::after").content.includes("Settings");
			})()`),
			true,
			"footer shortcuts use a styled tooltip rather than the native title popup",
		);
		const settingsShortcut = await host(`(() => {
			const rect = document.querySelector(".app-sidebar-footer a[aria-label='Settings']").getBoundingClientRect();
			return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
		})()`);
		browser.webContents.sendInputEvent({ type: "mouseMove", ...settingsShortcut });
		await until(
			'getComputedStyle(document.querySelector(".app-sidebar-footer a[aria-label=Settings]"), "::after").visibility === "visible"',
			"navigation tooltip appears on hover",
		);
		browser.webContents.sendInputEvent({ type: "mouseMove", x: 500, y: 500 });
		assert.equal(
			await host('Boolean(document.querySelector(".app-sidebar-footer a[href=\\"#/\\"]"))'),
			true,
			"the Chats shortcut returns to the current conversation",
		);
		await sleep(200);
		assert.equal(
			await host(`(() => {
				const active = document.querySelector(".app-sidebar-footer .sidebar-nav-icon.is-active");
				const swatch = document.createElement("span");
				swatch.style.background = "var(--ui-action)";
				document.body.append(swatch);
				const matches = getComputedStyle(active).backgroundColor === getComputedStyle(swatch).backgroundColor;
				swatch.remove();
				return matches;
			})()`),
			true,
			"the active navigation shortcut has a distinct filled background",
		);
		assert.equal(
			await host('Boolean(document.querySelector(".app-sidebar-footer a[href=\\"#/changes\\"]"))'),
			true,
			"the changes shortcut remains accessible",
		);
		await host(
			'document.querySelector(".app-sidebar-brand [aria-label=\\"Close sidebar\\"]").click()',
		);
		await until('document.querySelector(".app-sidebar").inert', "sidebar collapsed");
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 0',
			"sidebar collapse animation",
		);
		assert.equal(
			await host('document.querySelector(".app-sidebar-footer").closest(".app-sidebar").inert'),
			true,
			"bottom navigation collapses with the sidebar",
		);
		assert.equal(
			await host('getComputedStyle(document.querySelector(".app-sidebar-footer")).visibility'),
			"hidden",
			"collapsed sidebar hides bottom navigation",
		);
		await host('document.querySelector(".sidebar-reopen").click()');
		await until('!document.querySelector(".app-sidebar").inert', "sidebar reopened");
		assert.equal(
			await host('document.querySelectorAll(".assistant-body .markdown-body li").length'),
			3,
			"assistant Markdown keeps its list structure",
		);
		const nodeViewSwitch = '.sidebar-view-content:not([hidden]) [aria-label="Node view"]';
		await host(`document.querySelector(${JSON.stringify(nodeViewSwitch)}).click()`);
		await until('Boolean(document.querySelector(".session-graph-node"))', "conversation graph");
		await sleep(450);
		const resizePoint = await host(`(() => {
			const bounds = document.querySelector('[aria-label="Resize navigation sidebar"]').getBoundingClientRect();
			return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + 120) };
		})()`);
		browser.webContents.sendInputEvent({ type: "mouseMove", ...resizePoint });
		browser.webContents.sendInputEvent({
			type: "mouseDown",
			button: "left",
			clickCount: 1,
			...resizePoint,
		});
		await sleep(40);
		browser.webContents.sendInputEvent({
			type: "mouseMove",
			x: resizePoint.x + 128,
			y: resizePoint.y,
			button: "left",
		});
		await sleep(40);
		browser.webContents.sendInputEvent({
			type: "mouseUp",
			button: "left",
			clickCount: 1,
			x: resizePoint.x + 128,
			y: resizePoint.y,
		});
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 768',
			"graph width after dragging",
		);
		await host('document.querySelector(".react-flow__controls-zoomout").click()');
		await sleep(450);
		const manualViewport = await host(
			'document.querySelector(".react-flow__viewport").style.transform',
		);
		await host(
			'document.querySelector(".app-sidebar-brand [aria-label=\\"Close sidebar\\"]").click()',
		);
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 0',
			"graph collapsed",
		);
		await host('document.querySelector(".sidebar-reopen").click()');
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 768',
			"graph width restored",
		);
		await sleep(500);
		assert.equal(
			await host('document.querySelector(".react-flow__viewport").style.transform'),
			manualViewport,
			"reopening the graph preserves manual pan and zoom",
		);
		browser.setContentSize(1024, 960);
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 424',
			"graph width respects chat minimum",
		);
		browser.setContentSize(1440, 960);
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 768',
			"graph width returns after resizing window",
		);
		await host('window.graphNodeRef = document.querySelector(".session-graph-node")');
		await host(`document.querySelector(${JSON.stringify(nodeViewSwitch)}).click()`);
		await settle();
		assert.equal(
			await host('document.querySelector(".session-graph-node") === window.graphNodeRef'),
			true,
			"switching to the chat list retains the mounted graph",
		);
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 260',
			"chat list sidebar width",
		);
		for (let step = 0; step < 3; step++) {
			await host(`document.querySelector('[aria-label="Resize navigation sidebar"]')
				.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true }))`);
			await settle();
		}
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 200',
			"sidebar resize animation",
		);
		assert.equal(
			await host('document.querySelector(".app-sidebar").getBoundingClientRect().width'),
			200,
			"sidebar can still be resized to its minimum width",
		);
		await checkLayout("minimum sidebar width with populated conversation");
		await navigate("/knowledge", ".knowledge-page-header h1");
		await host('document.querySelector(".app-sidebar-footer a[href=\\"#/\\"]").click()');
		await until(
			'location.hash === "#/" && Boolean(document.querySelector(".chat-topbar"))',
			"back to chat",
		);
		await host(`document.querySelector('[aria-label="Resize navigation sidebar"]')
			.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
		await settle();
		browser.setContentSize(1024, 960);
		await settle();
		await host("document.querySelector('[aria-label=\"Close sidebar\"]').click()");
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 0',
			"collapsed desktop sidebar",
		);
		for (const [route, heading] of routes) {
			await navigate(route, heading);
			await checkLayout(`collapsed desktop sidebar ${route}`);
		}
		await navigate("/", ".chat-topbar h1");
		await host('document.querySelector(".sidebar-reopen").click()');
		browser.setContentSize(1440, 960);
		await navigate("/", ".chat-topbar h1");
		await setInput(".composer-input", "Keep this draft while opening the model menu");
		assert.equal(await host('document.querySelector(".composer-send").disabled'), false);
		await host('document.querySelector(".composer-runtime-trigger").click()');
		await until('Boolean(document.querySelector(".composer-runtime-menu"))', "provider menu");
		assert.equal(
			await host('document.querySelector(".composer-input").value'),
			"Keep this draft while opening the model menu",
		);
		await host('document.querySelector(".composer-runtime-trigger").click()');
		await host(
			'window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, shiftKey: true, bubbles: true }))',
		);
		await until(
			'document.activeElement?.getAttribute("aria-label") === "Search chats"',
			"search focus",
		);
		await setInput('[aria-label="Search chats"]', "branches");
		assert.ok(
			(await host('document.querySelectorAll(".global-search-results [role=option]").length')) > 0,
		);
		await host(
			'window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
		);
		await until('!document.querySelector(".global-search-dialog")', "search dismissal");

		browser.setContentSize(375, 812);
		await settle();
		assert.equal(await host('document.querySelector(".app-sidebar").inert'), true);
		await host('document.querySelector(".sidebar-reopen").click()');
		await until('!document.querySelector(".app-sidebar").inert', "compact sidebar opening");
		await host('document.querySelector(".app-sidebar-footer a[href=\\"#/sources\\"]").click()');
		await until(
			'document.querySelector(".app-sidebar").inert',
			"navigation closes compact sidebar",
		);
		assert.equal(await host("location.hash"), "#/sources");
		await host('document.querySelector(".sidebar-reopen").click()');
		await until('!document.querySelector(".app-sidebar").inert', "sidebar reopening");
		await host(
			'window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
		);
		await until('document.querySelector(".app-sidebar").inert', "sidebar Escape dismissal");
		assert.equal(await host('Boolean(document.querySelector(".skip-to-content"))'), false);
		assert.equal(
			await host("location.hash"),
			"#/sources",
			"removing the skip link must not change the HashRouter route",
		);
	}

	async function checkSidebarFilter() {
		browser.setContentSize(1440, 960);
		await navigate("/", ".chat-topbar h1");
		await host(`(() => {
			const timestamp = "2026-09-21T00:00:00Z";
			const rootTurns = [
				{ id: "filter-root-question", sessionId: "filter-root", role: "user", content: "Shared context", status: "complete", createdAt: timestamp },
				{ id: "filter-root-answer", sessionId: "filter-root", role: "assistant", content: "Context for a branch.", status: "complete", createdAt: timestamp }
			];
			const childTurns = (sessionId, id, content, quote) => [
				...rootTurns.map(turn => ({ ...turn, id: sessionId + "-" + turn.id, sessionId, sourceTurnId: turn.id })),
				{ id, sessionId, role: "user", content, summary: content, quote, status: "complete", createdAt: timestamp },
				{ id: id + "-answer", sessionId, role: "assistant", content: "A detailed explanation for continued reading.\\n\\n".repeat(30), status: "complete", createdAt: timestamp }
			];
			window.uiStore.setState({
				sessions: [
					{ id: "filter-root", parentId: null, title: "Shared context", isRoot: true, status: "idle", progressStatus: "parked" },
					{ id: "filter-done", parentId: "filter-root", forkedFromTurnId: "filter-root-answer", title: "explain", isRoot: false, status: "idle", progressStatus: "complete" },
					{ id: "filter-todo", parentId: "filter-root", forkedFromTurnId: "filter-root-answer", title: "Explore attention", isRoot: false, status: "idle", progressStatus: "todo" },
					{ id: "filter-empty", parentId: null, title: "Unmarked chat", isRoot: true, status: "idle" }
				],
				turns: [
					...rootTurns,
					...childTurns("filter-done", "filter-done-question", "explain", { turnId: "filter-root-answer", text: "decoder-only architecture" }),
					...childTurns("filter-todo", "filter-todo-question", "Explore attention")
				],
				activeSessionId: "filter-todo",
				visibleSessionId: "filter-todo",
				sidebarOpen: true
			});
		})()`);
		await settle();
		const filterButton = ".sidebar-view-content:not([hidden]) button.session-filter-trigger";
		const nodeViewSwitch = '.sidebar-view-content:not([hidden]) [aria-label="Node view"]';
		const visibleIds = () =>
			host(
				'[...document.querySelectorAll(".session-tree [data-session-tree-id]")].map(node => node.dataset.sessionTreeId)',
			);
		const choose = async (label) => {
			await host(`Array.from(document.querySelectorAll(".session-filter-menu [role=menuitemcheckbox]"))
				.find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
			await settle();
		};
		const open = async () => {
			await host(`document.querySelector(${JSON.stringify(filterButton)}).click()`);
			await until('Boolean(document.querySelector(".session-filter-menu"))', "leaf filter menu");
			await settle();
		};
		const close = async () => {
			await host(`document.querySelector(".session-filter-menu")
				.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
			await until('!document.querySelector(".session-filter-menu")', "leaf filter dismissal");
		};
		for (const theme of ["light", "dark"]) {
			await setAppearance(theme, { highContrast: false, reduceMotion: true, fontScale: 1 });
			assert.equal(
				await host(
					"document.querySelector('[data-session-tree-id=\"filter-done-question\"] .session-node-title').textContent",
				),
				"Explain: decoder-only architecture",
				"existing Explain nodes show the selected subject",
			);
			await host(`(() => {
				const scroll = document.querySelector(".chat-scroll");
				scroll.classList.add("is-positioning");
				scroll.scrollTop = 240;
				scroll.classList.remove("is-positioning");
			})()`);
			await settle();
			const before = await host('document.querySelector(".chat-scroll").scrollTop');
			const total = await host(
				'document.querySelector(".session-tree-header .session-usage").textContent',
			);
			await open();
			assert.equal(
				await host("document.activeElement.textContent.trim()"),
				"所有状态",
				"filter opens with keyboard focus",
			);
			await host(
				`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))`,
			);
			assert.equal(await host("document.activeElement.textContent.trim()"), "Unmarked");
			await choose("Completed");
			assert.deepEqual(await visibleIds(), ["filter-root-question", "filter-done-question"]);
			assert.equal(
				await host("window.uiStore.getState().activeSessionId"),
				"filter-todo",
				"filter must not navigate",
			);
			assert.ok(
				Math.abs((await host('document.querySelector(".chat-scroll").scrollTop')) - before) <= 1,
				"filter must not scroll the conversation",
			);
			assert.equal(
				await host('document.querySelector(".session-tree-header .session-usage").textContent'),
				total,
				"filter must not change total usage",
			);
			await host('window.uiStore.getState().setSessionProgressStatus("filter-todo", "complete")');
			await settle();
			assert.deepEqual(await visibleIds(), [
				"filter-root-question",
				"filter-done-question",
				"filter-todo-question",
			]);
			await host('window.uiStore.getState().setSessionProgressStatus("filter-todo", "todo")');
			await settle();
			await choose("To explore");
			assert.deepEqual(await visibleIds(), [
				"filter-root-question",
				"filter-done-question",
				"filter-todo-question",
			]);
			assert.equal(
				await host('document.querySelector(".session-tree .session-filter-count").textContent'),
				"2",
			);
			await checkContrast(`${theme} leaf filter`);
			await screenshot(`${theme}-leaf-filter`);
			await choose("To explore");
			await close();
			assert.equal(
				await host('document.activeElement.getAttribute("aria-label")'),
				"按末端节点状态筛选",
				"Escape restores focus",
			);
			await host(`document.querySelector(${JSON.stringify(nodeViewSwitch)}).click()`);
			await until(
				'document.querySelectorAll(".react-flow__node").length === 2',
				"filtered node view",
			);
			assert.deepEqual(
				await host(
					'[...document.querySelectorAll(".session-graph-node-main strong")].map(node => node.textContent)',
				),
				["Shared context", "Explain: decoder-only architecture"],
				"node view shares the filter and contextual titles",
			);
			await open();
			await choose("所有状态");
			await choose("On hold");
			assert.equal(
				await host('Boolean(document.querySelector(".session-graph-page .session-filter-empty"))'),
				true,
				"non-leaf status alone must not match",
			);
			await close();
			await host(`document.querySelector(${JSON.stringify(nodeViewSwitch)}).click()`);
			await settle();
			assert.deepEqual(await visibleIds(), []);
			await host('document.querySelector(".session-tree .session-filter-empty button").click()');
			await settle();
			assert.equal((await visibleIds()).length, 4);
			await open();
			await choose("Unmarked");
			assert.deepEqual(await visibleIds(), ["empty:filter-empty"]);
			await choose("Unmarked");
			assert.equal((await visibleIds()).length, 4, "clearing the last status restores all");
			await host(
				'document.querySelector(".chat-topbar").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))',
			);
			await until('!document.querySelector(".session-filter-menu")', "outside click dismissal");
		}
		await open();
		await choose("Completed");
		await choose("To explore");
		await close();
		assert.deepEqual(await host("window.uiStore.getState().leafStatuses"), ["complete", "todo"]);
		await browser.reload();
		await until(
			'Boolean(document.querySelector(".session-filter-trigger.is-active"))',
			"saved leaf filters after reopening the app",
		);
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; window.uiLoadWorkspaceState = module.loadWorkspaceState; })',
		);
		assert.deepEqual(await host("window.uiStore.getState().leafStatuses"), ["complete", "todo"]);
		await settle();
		assert.deepEqual(await visibleIds(), [
			"filter-root-question",
			"filter-done-question",
			"filter-todo-question",
		]);
		await open();
		assert.deepEqual(
			await host(
				'[...document.querySelectorAll(".session-filter-menu [aria-checked=true]")].map(button => button.textContent.trim())',
			),
			["To explore", "Completed"],
			"the reopened menu checks the saved selections",
		);
		await close();
		await host(`(() => {
			window.uiFilterWorkspace = localStorage.getItem("rhyza-workspace-v2");
			const other = JSON.parse(window.uiFilterWorkspace);
			other.state.leafStatuses = ["unmarked"];
			window.uiLoadWorkspaceState(JSON.stringify(other));
		})()`);
		await settle();
		assert.deepEqual(await visibleIds(), ["empty:filter-empty"]);
		await host("window.uiLoadWorkspaceState(window.uiFilterWorkspace)");
		await settle();
		assert.deepEqual(await visibleIds(), [
			"filter-root-question",
			"filter-done-question",
			"filter-todo-question",
		]);
		await host(`(() => {
			const legacy = JSON.parse(window.uiFilterWorkspace);
			delete legacy.state.leafStatuses;
			window.uiLoadWorkspaceState(JSON.stringify(legacy));
			delete window.uiFilterWorkspace;
			delete window.uiLoadWorkspaceState;
		})()`);
		await settle();
		assert.equal((await visibleIds()).length, 4, "legacy workspaces do not inherit another filter");
		await seedContent();
		await setAppearance("dark", { reduceMotion: false });
	}

	async function checkPageControls() {
		browser.setContentSize(1440, 960);
		await navigate("/knowledge", ".knowledge-page-header h1");
		assert.equal(
			await host('Boolean(document.querySelector(".knowledge-resource-pane .knowledge-search"))'),
			true,
			"knowledge search belongs to the list it filters, not the page toolbar",
		);
		await setInput(".knowledge-search input", "no-such-knowledge-entry");
		assert.equal(
			await host('document.querySelectorAll(".knowledge-resource-list button").length'),
			0,
			"knowledge filtering exposes the no-results state",
		);
		assert.equal(
			await host(
				'document.querySelector(".knowledge-resource-pane [role=status]").textContent.trim()',
			),
			"0 of 1",
			"filter results remain announced without duplicating the tab count",
		);
		await host('document.querySelector(".knowledge-search-clear").click()');
		await settle();
		assert.equal(
			await host('document.querySelectorAll(".knowledge-resource-list button").length'),
			1,
		);
		await host('document.querySelector("#knowledge-diagrams-tab").click()');
		await settle();
		assert.equal(
			await host('document.querySelector("#knowledge-diagrams-tab").getAttribute("aria-selected")'),
			"true",
		);
		await host('document.querySelector("#knowledge-entities-tab").click()');
		await settle();
		await host(`Array.from(document.querySelectorAll(".knowledge-page button"))
			.find(button => button.textContent.trim() === "Edit").click()`);
		await until('Boolean(document.querySelector(".entity-center-editor"))', "knowledge editor");
		await host(`Array.from(document.querySelectorAll(".knowledge-page button"))
			.find(button => button.textContent.trim() === "Cancel").click()`);
		await until(
			'!document.querySelector(".entity-center-editor")',
			"knowledge editor cancellation",
		);
		assert.equal(await host("window.uiStore.getState().entities[0].name"), "Conversation branches");

		await navigate("/changes", ".page-title");
		assert.equal(
			await host('document.querySelectorAll(".knowledge-change-list section").length'),
			1,
		);
		await setInput('[aria-label="Filter knowledge history"]', "no-such-change");
		await until(
			'document.querySelectorAll(".knowledge-change-list section").length === 0',
			"history filter",
		);
		assert.match(
			await host('document.querySelector(".knowledge-change-list .empty-state").textContent'),
			/No knowledge changes match/,
		);
		await setInput('[aria-label="Filter knowledge history"]', "");
		await until(
			'document.querySelectorAll(".knowledge-change-list section").length === 1',
			"history filter reset",
		);
		await host(`Array.from(document.querySelectorAll(".knowledge-change-list button"))
			.find(button => button.textContent.trim() === "View diff").click()`);
		await until(
			'Boolean(document.querySelector(".knowledge-change-diff pre"))',
			"knowledge object diff",
		);
		assert.match(
			await host('document.querySelector(".knowledge-change-diff pre").textContent'),
			/Conversation branches/,
		);
		await host("document.querySelector('[aria-label=\"Close diff\"]').click()");
		await host('document.querySelector("#changes-code-tab").click()');
		await until(
			'document.querySelector("#changes-code-tab").getAttribute("aria-selected") === "true"',
			"code tab",
		);
		await until(
			'Boolean(document.querySelector(".changes-code-empty, [role=alert]"))',
			"code diff state without desktop bridge",
		);
		assert.equal(
			await host(`(() => {
				const panel = document.querySelector(".changes-code-panel");
				const guidance = "Open and run a session before viewing its worktree diff.";
				return [...panel.querySelectorAll("p, span")]
					.filter(element => element.textContent.trim() === guidance).length;
			})()`),
			1,
			"missing-session guidance appears once, in the empty state",
		);
		await host('document.querySelector("#changes-knowledge-tab").click()');
		await settle();

		await navigate("/settings", ".settings-section:not([hidden]) .settings-section-header h1");
		assert.equal(
			await host('document.querySelector(".settings-section:not([hidden]) h1").id'),
			"provider-heading",
			"AI provider is the first and default settings section",
		);
		assert.equal(
			await host('document.querySelector(".settings-content .page-header")'),
			null,
			"settings no longer repeats a page-level title",
		);
		assert.equal(
			await host(`(() => {
				const panel = document.querySelector(".settings-section:not([hidden]) > .settings-panel");
				const style = getComputedStyle(panel);
				return style.borderTopWidth === "0px" && style.boxShadow === "none";
			})()`),
			true,
			"settings use aligned rows instead of an additional bordered card",
		);
		assert.equal(await host('document.querySelector(".app-sidebar").inert'), true);
		assert.equal(
			await host('document.querySelector(".app-sidebar-footer").closest(".app-sidebar").inert'),
			true,
		);
		assert.equal(
			await host(
				'document.querySelector(".settings-navigation nav").getBoundingClientRect().width > 0',
			),
			true,
			"settings navigation replaces workspace sidebar",
		);
		assert.deepEqual(
			await host(
				'[...document.querySelectorAll(".settings-navigation-group-heading")].map(heading => heading.textContent.trim())',
			),
			["AI & workflows", "App preferences"],
		);
		for (const heading of [
			"provider-heading",
			"plugins-heading",
			"mcp-heading",
			"knowledge-heading",
			"language-heading",
			"appearance-heading",
			"accessibility-heading",
		]) {
			await host(
				`document.querySelector(".settings-navigation nav button[data-section='${heading}']").click()`,
			);
			assert.equal(await host("location.hash"), "#/settings", `${heading} retains route`);
			assert.equal(
				await host(
					`document.querySelector(".settings-navigation nav button.is-active")?.textContent.trim()`,
				),
				await host(`document.getElementById(${JSON.stringify(heading)}).textContent.trim()`),
				`${heading} becomes active`,
			);
			assert.equal(
				await host(
					`!document.getElementById(${JSON.stringify(heading)}).closest("section").hidden`,
				),
				true,
				`${heading} is the visible section`,
			);
			assert.equal(
				await host('document.querySelectorAll(".settings-section:not([hidden])").length'),
				1,
				"only the selected section is shown",
			);
		}
		await setInput('[aria-label="Search settings sections"]', "azure");
		await until(
			'document.querySelectorAll(".settings-navigation nav button").length === 1',
			"settings search filters categories",
		);
		assert.equal(
			await host('document.querySelectorAll(".settings-navigation-group").length'),
			1,
			"empty groups are hidden by search",
		);
		assert.equal(
			await host(
				'document.querySelector(".settings-navigation nav button.is-active").textContent.trim()',
			),
			"AI provider",
		);
		assert.equal(
			await host(
				'(() => { const input = document.querySelector(".settings-search input"); input.focus(); return getComputedStyle(input).outlineStyle; })()',
			),
			"none",
			"focused search text does not receive a square outline",
		);
		await setInput('[aria-label="Search settings sections"]', "");
		await host(
			'document.querySelector(".settings-navigation nav button[data-section=appearance-heading]").click()',
		);
		await host('document.querySelector(".settings-content").style.maxHeight = "12rem"');
		await host('document.querySelector(".settings-content").scrollTo(0, 200)');
		assert.ok(
			await host('document.querySelector(".settings-content").scrollTop > 0'),
			"settings content scrolls independently",
		);
		await host(
			'document.querySelector(".settings-navigation nav button[data-section=appearance-heading]").click()',
		);
		assert.equal(await host('document.querySelector(".settings-content").scrollTop'), 0);
		await host('document.querySelector(".settings-content").style.maxHeight = ""');
		const autoExtract = await host("window.uiStore.getState().settings.autoExtract");
		await host(`document.querySelector('input[name="app-theme"][value="light"]').click()`);
		await host(
			'document.querySelector(".settings-navigation nav button[data-section=accessibility-heading]").click()',
		);
		await until('document.documentElement.dataset.theme === "light"', "theme radio");
		await host('document.querySelector("#reduce-motion").click()');
		await host('document.querySelector("#high-contrast").click()');
		await setInput("#font-scale", "1.1");
		await host(
			'document.querySelector(".settings-navigation nav button[data-section=knowledge-heading]").click()',
		);
		await setInput("#concurrent-questions", "3");
		await host(
			'document.querySelector(".settings-navigation nav button[data-section=knowledge-heading]").click()',
		);
		await host(`document.querySelector('button[aria-labelledby="auto-extract-label"]').click()`);
		assert.equal(
			await host('Boolean(document.querySelector("#workspace-heading"))'),
			false,
			"workspace selection is not duplicated in Settings",
		);
		await settle();
		const expected = {
			theme: "light",
			reduceMotion: true,
			highContrast: true,
			fontScale: 1.1,
			maxConcurrentRequests: 3,
			autoExtract: !autoExtract,
		};
		for (const [key, value] of Object.entries(expected)) {
			assert.equal(
				await host(`window.uiStore.getState().settings[${JSON.stringify(key)}]`),
				value,
				key,
			);
		}
		assert.equal(
			await host(
				`document.querySelector('button[aria-labelledby="auto-extract-label"]').getAttribute("aria-checked")`,
			),
			String(!autoExtract),
		);
		assert.equal(await host('document.documentElement.classList.contains("reduce-motion")'), true);
		await host(
			'document.querySelector(".settings-navigation nav button[data-section=accessibility-heading]").click()',
		);
		await host('document.querySelector("#font-scale").scrollIntoView({ block: "center" })');
		await screenshot("settings-controls");
		await browser.loadURL(browser.webContents.getURL());
		await until('Boolean(document.querySelector("#font-scale"))', "settings reload");
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; })',
		);
		for (const [key, value] of Object.entries(expected)) {
			assert.equal(
				await host(`window.uiStore.getState().settings[${JSON.stringify(key)}]`),
				value,
				`${key} persists after reload`,
			);
		}
		browser.setContentSize(375, 812);
		await settle();
		assert.equal(
			await host(
				'document.querySelector(".settings-navigation nav").getBoundingClientRect().width > 0',
			),
			true,
			"settings navigation remains usable on compact screens",
		);
		await host('document.querySelector(".settings-back").click()');
		await until('location.hash === "#/"', "return from settings");
		assert.equal(await host('document.querySelector(".app-sidebar").inert'), true);
	}

	async function checkMarkdownHtml() {
		browser.setContentSize(1440, 960);
		const content = [
			"Grouped results.",
			"",
			"<details>",
			"<summary><b>Region A (2 items)</b></summary>",
			"",
			"- `resource-one`",
			"- **resource-two**",
			"",
			"<details>",
			"<summary>Nested group</summary>",
			"",
			"needle-native-disclosure",
			"",
			"## Nested heading",
			"",
			"Nested prose.",
			"",
			"</details>",
			"",
			"</details>",
			"",
			"<details open><summary>Initially open</summary>",
			"",
			"Visible content.",
			"",
			"</details>",
			"",
			"<script>window.unsafeHtmlExecuted = true</script>",
		].join("\n");
		const original = await host(`({
			answer: window.uiStore.getState().turns.find(turn => turn.id === "ui-answer").content,
			entity: window.uiStore.getState().entities.find(entity => entity.id === "ui-entity").content
		})`);
		for (const theme of ["light", "dark"]) {
			await setAppearance(theme, { highContrast: false, reduceMotion: true, fontScale: 1 });
			await host(`window.uiStore.getState().updateTurn("ui-answer", {
				content: ${JSON.stringify(content)}
			})`);
			await navigate("/", ".chat-topbar h1");
			await until(
				'document.querySelectorAll("#turn-ui-answer .markdown-body details").length === 3',
				"native Markdown disclosure groups",
			);
			assert.deepEqual(
				await host(`(() => {
					const group = document.querySelector("#turn-ui-answer .markdown-body details");
					return {
						open: group.open,
						label: group.querySelector("summary b").textContent,
						items: group.querySelectorAll("li").length,
						itemVisible: group.querySelector("li").checkVisibility(),
						initiallyOpen: document.querySelector("#turn-ui-answer details[open]").open,
						script: Boolean(document.querySelector("#turn-ui-answer .markdown-body script")),
						executed: window.unsafeHtmlExecuted === true
					};
				})()`),
				{
					open: false,
					label: "Region A (2 items)",
					items: 2,
					itemVisible: false,
					initiallyOpen: true,
					script: false,
					executed: false,
				},
				`${theme}: formatted summaries fold Markdown lists without executing HTML`,
			);
			const typography = await host(`(() => {
				const body = document.querySelector("#turn-ui-answer .assistant-body");
				const group = body.querySelector(".markdown-body details");
				const summary = group.querySelector("summary");
				const summaryStyle = getComputedStyle(summary);
				const bodyStyle = getComputedStyle(body);
				return {
					font: getComputedStyle(body.querySelector(".markdown-body")).fontFamily,
					bodyPaddingX: parseFloat(bodyStyle.paddingLeft),
					bodyPaddingY: parseFloat(bodyStyle.paddingTop),
					summaryPaddingX: parseFloat(summaryStyle.paddingLeft),
					summaryPaddingY: parseFloat(summaryStyle.paddingTop),
					summaryWeight: Number(summaryStyle.fontWeight),
					nestedBoldWeight: Number(getComputedStyle(summary.querySelector("b")).fontWeight),
					emphasisWeight: Number(getComputedStyle(group.querySelector("li strong")).fontWeight),
					closedHeight: group.getBoundingClientRect().height
				};
			})()`);
			assert.ok(typography.font.includes("Segoe UI"), `${theme}: shared sans-serif reading font`);
			assert.ok(
				typography.font.includes("Microsoft YaHei"),
				`${theme}: explicit Chinese sans-serif fallback`,
			);
			assert.ok(typography.bodyPaddingX >= 20, `${theme}: answer has a horizontal gutter`);
			assert.ok(typography.bodyPaddingY >= 16, `${theme}: answer has vertical breathing room`);
			assert.ok(typography.summaryPaddingX >= 16, `${theme}: disclosure title has a gutter`);
			assert.ok(typography.summaryPaddingY >= 14, `${theme}: disclosure title has breathing room`);
			assert.equal(typography.summaryWeight, 500, `${theme}: medium-weight disclosure title`);
			assert.equal(
				typography.nestedBoldWeight,
				typography.summaryWeight,
				`${theme}: nested bold does not compound the title weight`,
			);
			assert.equal(typography.emphasisWeight, 600, `${theme}: restrained prose emphasis`);
			assert.ok(typography.closedHeight >= 50, `${theme}: comfortable disclosure hit area`);
			await checkContrast(`${theme} disclosure titles`);
			await screenshot(`${theme}-disclosures-closed`);
			await host(`window.uiDetailsNode = document.querySelector("#turn-ui-answer .markdown-body details");
				window.uiDetailsNode.querySelector("summary").click();`);
			await screenshot(`${theme}-disclosures-open`);
			await host(`window.uiStore.getState().updateTurn("ui-answer", {
				content: ${JSON.stringify(`${content}\n\nAppended text.`)}
			})`);
			await settle();
			assert.equal(
				await host(
					'window.uiDetailsNode === document.querySelector("#turn-ui-answer .markdown-body details") && window.uiDetailsNode.open',
				),
				true,
				`${theme}: answer updates preserve the disclosure DOM and open state`,
			);
			await host('window.uiDetailsNode.querySelector("summary").click()');
			await host(
				'import("/src/store/conversationFocus.ts").then(module => module.useConversationFocus.getState().setFocus("ui-session", "ui-answer"))',
			);
			await until('Boolean(document.querySelector(".answer-outline-list button"))', "HTML outline");
			await host('document.querySelector(".answer-outline-list button").click()');
			await settle();
			assert.equal(
				await host(
					'window.uiDetailsNode.open && window.uiDetailsNode.querySelector("details").open',
				),
				true,
				`${theme}: outline navigation opens enclosing native disclosure groups`,
			);
			await host(`window.uiDetailsNode.querySelector("summary").click();
				window.uiDetailsNode.querySelector("details").open = false;
				window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));`);
			await until('Boolean(document.querySelector(".conversation-find input"))', "HTML search");
			await setInput(".conversation-find input", "needle-native-disclosure");
			await until(
				'window.uiDetailsNode.open && window.uiDetailsNode.querySelector("details").open',
				"search opens native disclosure groups without a Markdown section ancestor",
			);
			await host(
				'document.querySelector(".conversation-find input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
			);
			await host(`window.uiStore.setState(state => ({
				entities: state.entities.map(entity => entity.id === "ui-entity"
					? { ...entity, content: ${JSON.stringify(content)} } : entity)
			}))`);
			await navigate("/knowledge", ".knowledge-page-header h1");
			assert.equal(
				await host('document.querySelectorAll(".entity-markdown-preview-body details").length'),
				3,
				`${theme}: knowledge notes use the same safe HTML renderer`,
			);
			await host('document.querySelector(".entity-markdown-preview-body details summary").click()');
			assert.equal(
				await host('document.querySelector(".entity-markdown-preview-body details").open'),
				true,
				`${theme}: knowledge disclosures are interactive`,
			);
			await navigate("/", ".chat-topbar h1");
			browser.setContentSize(375, 812);
			await settle();
			assert.equal(
				await host(`(() => {
					const body = document.querySelector("#turn-ui-answer .assistant-body");
					const style = getComputedStyle(body);
					return parseFloat(style.paddingLeft) >= 16 && parseFloat(style.paddingTop) >= 12
						&& [...body.querySelectorAll(".markdown-body details")].every(group => {
							const bounds = group.getBoundingClientRect();
							return bounds.left >= 0 && bounds.right <= innerWidth;
						});
				})()`),
				true,
				`${theme}: compact answers retain padding without overflowing disclosure cards`,
			);
			await screenshot(`${theme}-disclosures-compact`);
			browser.setContentSize(1440, 960);
			await settle();
		}
		await host(`window.uiStore.getState().updateTurn("ui-answer", {
			content: ${JSON.stringify(original.answer)}
		});
			window.uiStore.setState(state => ({
				entities: state.entities.map(entity => entity.id === "ui-entity"
					? { ...entity, content: ${JSON.stringify(original.entity)} } : entity)
			}));
			delete window.uiDetailsNode;`);
	}

	async function checkChatActionContrast() {
		browser.setContentSize(1440, 960);
		await navigate("/", ".chat-topbar h1");
		await host(`window.uiStore.getState().updateTurn("ui-answer", {
			modelRequests: [{
				id: "ui-request", sequence: 1, timestamp: "2026-09-18T10:24:00.000Z",
				model: "UI test model", provider: "copilot", api: "test", thinking: "off",
				context: { messages: [{ role: "user", content: "Explain conversation branches." }] }
			}]
		})`);
		for (const theme of ["light", "dark"]) {
			await setAppearance(theme, { highContrast: false, reduceMotion: false, fontScale: 1 });
			await host(
				'import("/src/store/conversationFocus.ts").then(module => module.useConversationFocus.getState().setFocus("ui-session", "ui-answer"))',
			);
			await settle();
			assert.equal(
				await host(`(() => {
					const body = document.querySelector("#turn-ui-answer.is-focused .turn-body");
					const style = getComputedStyle(body);
					return style.outlineStyle === "solid" && style.outlineWidth === "1px"
						&& style.backgroundColor !== "rgba(0, 0, 0, 0)"
						&& getComputedStyle(body, "::after").content === "none";
				})()`),
				true,
				`${theme}: located answer uses a complete highlight instead of a left rail`,
			);
			await host(`(() => {
				const paragraph = document.querySelector(".assistant-body .markdown-body p");
				const range = document.createRange();
				range.selectNodeContents(paragraph);
				const selection = window.getSelection();
				selection.removeAllRanges();
				selection.addRange(range);
				paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			})()`);
			await until('Boolean(document.querySelector(".text-selection-menu"))', "selected text menu");
			await host('document.querySelector(".text-selection-menu [role=menuitem]").click()');
			await until(
				'Boolean(document.querySelector(".text-selection-popover textarea"))',
				"selection question",
			);
			await setInput(".text-selection-popover textarea", "What context stays in the branch?");
			assert.equal(
				await host(
					'document.querySelector(".text-selection-actions button[type=submit]").disabled',
				),
				false,
			);
			await checkContrast(`${theme} selected text action`);
			await host('document.querySelector(".text-selection-actions button[type=button]").click()');
			await host("window.getSelection().removeAllRanges()");
			await host('window.uiStore.getState().openTurnInspector("ui-answer", "context")');
			await until(
				'Boolean(document.querySelector(".analyze-context-button"))',
				"context inspector action",
			);
			await checkContrast(`${theme} context analysis action`);
			await host('document.querySelector(".analyze-context-button").click()');
			await until('Boolean(document.querySelector(".rot-score"))', "context analysis results");
			await host("document.querySelector('[aria-label=\"Close panel\"]').click()");
			await host(
				'import("/src/store/conversationFocus.ts").then(module => module.useConversationFocus.getState().setFocus("ui-session", null))',
			);
		}
	}

	async function run() {
		await app.whenReady();
		const { createServer } = await import(
			pathToFileURL(path.join(projectRoot, "node_modules", "vite", "dist", "node", "index.js")).href
		);
		server = await createServer({
			root: projectRoot,
			logLevel: "error",
			plugins: [
				{
					name: "startup-recovery-fixture",
					transform(code, id) {
						if (!id.endsWith("/src/main.tsx")) return;
						return `if (new URL(location.href).searchParams.has("startup-fixture")) {
						let attempts = 0;
						window.rhyza = { getWorkspace: async () => {
							if (++attempts === 1) throw new Error("Fixture workspace failed.");
							delete window.rhyza;
							return { path: null };
						} };
					}\n${code}`;
					},
				},
			],
			server: { host: "127.0.0.1", port: 0, strictPort: false, watch: null },
		});
		await server.listen();
		browser = new BrowserWindow({
			show: false,
			width: 1440,
			height: 960,
			useContentSize: true,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false,
				offscreen: true,
			},
		});
		browser.webContents.on("console-message", (event) => {
			if (event.level === "error") rendererErrors.push(event.message);
		});
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/?startup-fixture`);
		await until(
			'Boolean(document.querySelector(".startup-state [role=alert]"))',
			"startup error surface",
		);
		assert.match(
			await host('document.querySelector(".startup-state").textContent'),
			/Fixture workspace failed/,
		);
		await host('document.querySelector(".startup-state button").click()');
		await until('Boolean(document.querySelector(".chat-empty"))', "initial workspace");
		await host('history.replaceState(null, "", "/");');
		await host(
			'import("/src/store/index.ts").then(module => { window.uiStore = module.useAppStore; })',
		);
		await host('window.uiStore.getState().updateSettings({ language: "en" })');
		for (const theme of ["light", "dark"]) {
			await setAppearance(theme);
			for (const [route, heading] of routes) {
				await navigate(route, heading);
				await checkLayout(`${theme} empty ${route}`);
				await checkContrast(`${theme} empty ${route}`);
				if (route === "/sources") await checkWorkspaceSources(`${theme} empty workspace`);
				await screenshot(`${theme}-empty-${route.slice(1) || "workspace"}`);
			}
		}
		await navigate("/sources", ".page-title");
		assert.equal(
			await host('document.querySelector(".sources-workspace-card h2").textContent.trim()'),
			"Current workspace",
			"workspace selection is displayed on the Workspace page",
		);
		assert.equal(
			await host('document.querySelector(".sources-workspace-card button").textContent.trim()'),
			"Choose workspace",
		);
		await checkAddSourcesAction();
		for (const [language, labels] of [
			["zh-CN", { workspace: "工作区", sources: "资料源", addSources: "添加资料源" }],
			["zh-TW", { workspace: "工作區", sources: "資料來源", addSources: "新增資料來源" }],
		]) {
			await host(
				`window.uiStore.getState().updateSettings({ language: ${JSON.stringify(language)} })`,
			);
			await settle();
			await checkWorkspaceSources(`${language} workspace`, labels);
		}
		await host('window.uiStore.getState().updateSettings({ language: "en" })');
		await seedContent();
		await checkOverlayControls();
		await checkFormAlignment();
		await checkDesignContracts();
		await checkRecoveryButtonLayout();
		await checkComposerModelMenu();
		await checkComposerInputAndContext();
		await checkSettingsIconActions();
		for (const theme of ["light", "dark"]) {
			await setAppearance(theme);
			await navigate("/", ".chat-topbar h1");
			const nodeViewSwitch =
				'.sidebar-view-content:not([hidden]) [aria-label="Node view"][aria-checked="true"]';
			if (await host(`Boolean(document.querySelector(${JSON.stringify(nodeViewSwitch)}))`)) {
				await host(`document.querySelector(${JSON.stringify(nodeViewSwitch)}).click()`);
				await settle();
			}
			for (const width of [1440, 1024, 768, 375]) {
				browser.setContentSize(width, 960);
				await settle();
				for (const [route, heading] of routes) {
					await navigate(route, heading);
					await checkLayout(`${theme} ${width} ${route}`);
					await checkContrast(`${theme} ${width} ${route}`);
					if (route === "/") {
						await checkFilledSelection(
							".session-node-button.is-current",
							`${theme} ${width} conversation list`,
						);
						assert.equal(
							await host('document.querySelector(".session-viewport-rail")'),
							null,
							"reading position no longer adds a left rail",
						);
					}
					if (route === "/knowledge") {
						await checkFilledSelection(
							".knowledge-resource-list button.is-selected",
							`${theme} ${width} knowledge list`,
						);
					}
					if (route === "/settings") await checkSettingsNavigation(`${theme} ${width} settings`);
					if (route === "/sources") await checkWorkspaceSources(`${theme} ${width} workspace`);
					if (width === 1440 || width === 375) {
						await screenshot(`${theme}-${width}-${route.slice(1) || "workspace"}`);
					}
				}
			}
			await setAppearance(theme, { fontScale: 1.25, highContrast: true, reduceMotion: true });
			for (const [route, heading] of routes) {
				await navigate(route, heading);
				await checkLayout(`${theme} large text ${route}`);
				await checkContrast(`${theme} large text ${route}`);
				if (route === "/settings") await checkSettingsNavigation(`${theme} large text settings`);
				if (route === "/sources") await checkWorkspaceSources(`${theme} large text workspace`);
			}
			await setAppearance(theme, { fontScale: 1, highContrast: false, reduceMotion: false });
		}
		await checkInteractions();
		await checkSidebarFilter();
		await checkPageControls();
		await checkMarkdownHtml();
		await checkChatActionContrast();
		browser.setContentSize(1440, 960);
		await navigate("/", ".chat-topbar h1");
		assert.equal(
			await host('localStorage.getItem("rhyza-layout-graph-width")'),
			"768",
			"the dragged graph width is saved",
		);
		await browser.reload();
		await until('Boolean(document.querySelector(".session-tree-header"))', "reopened workspace");
		if (await host('Boolean(document.querySelector(".sidebar-reopen"))'))
			await host('document.querySelector(".sidebar-reopen").click()');
		await host(
			'document.querySelector(".sidebar-view-content:not([hidden]) [aria-label=\\"Node view\\"]").click()',
		);
		await until(
			'document.querySelector(".app-sidebar").getBoundingClientRect().width === 768',
			"saved graph width after reopening the app",
		);
		const resizeNotifications = rendererErrors.filter(
			(message) => message === "ResizeObserver loop completed with undelivered notifications.",
		);
		if (resizeNotifications.length)
			console.warn(`${resizeNotifications.length} browser ResizeObserver delivery warnings`);
		assert.deepEqual(
			rendererErrors.filter(
				(message) => message !== "ResizeObserver loop completed with undelivered notifications.",
			),
			[],
			"renderer console errors",
		);
		console.log(
			"Verified five routes, empty/populated states, both themes, four widths, large text and navigation.",
		);
	}

	run()
		.then(async () => {
			browser?.destroy();
			await server?.close();
			app.exit(0);
		})
		.catch(async (error) => {
			console.error(error);
			if (browser && process.env.RHYZA_UI_SCREENSHOT_DIR) await screenshot("failure");
			browser?.destroy();
			await server?.close();
			app.exit(1);
		});
}
