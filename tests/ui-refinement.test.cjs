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
	const host = (code) => browser.webContents.executeJavaScript(code);
	const until = async (code, label) => {
		for (let attempt = 0; attempt < 300; attempt++) {
			if (await host(code)) return;
			await sleep(50);
		}
		throw new Error(`Timed out: ${label}`);
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
		await setInput(".knowledge-search input", "no-such-knowledge-entry");
		assert.equal(
			await host('document.querySelectorAll(".knowledge-resource-list button").length'),
			0,
			"knowledge filtering exposes the no-results state",
		);
		await setInput(".knowledge-search input", "");
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
		await browser.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/`);
		await until('Boolean(document.querySelector(".chat-empty"))', "initial workspace");
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
