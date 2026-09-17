const assert = require("node:assert/strict");
const { readFileSync, statSync } = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { app, BrowserWindow, nativeTheme } = require("electron");

const fixturePath = process.argv[2];
app.setPath("userData", path.join(path.dirname(fixturePath), "browser-data"));
app.disableHardwareAcceleration();

async function loadDocument(browser, html) {
	await browser.loadURL("data:text/html,<!doctype html><body style='margin:0'>");
	await browser.webContents.executeJavaScript(`new Promise((resolve) => {
		const frame = document.createElement("iframe");
		frame.sandbox = "allow-scripts allow-downloads";
		frame.style.cssText = "display:block;width:100vw;height:100vh;border:0";
		frame.onload = resolve;
		const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'";
		frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="' + policy + '">' + ${JSON.stringify(html)};
		document.body.append(frame);
	})`);
	return browser.webContents.mainFrame.frames[0];
}

async function downloadExport(browser, frame, format, name) {
	const session = browser.webContents.session;
	let listener;
	let timeout;
	const downloaded = new Promise((resolve, reject) => {
		timeout = setTimeout(() => reject(new Error(`No ${format} download for ${name}`)), 15000);
		listener = (_event, item) => {
			const filename = path.join(path.dirname(fixturePath), `${name}.${format}`);
			item.setSavePath(filename);
			item.once("done", (_doneEvent, state) => {
				if (state !== "completed") reject(new Error(`${format} download ${state}`));
				else resolve({ filename, mime: item.getMimeType(), bytes: item.getReceivedBytes() });
			});
		};
		session.once("will-download", listener);
	});
	try {
		const [, download] = await Promise.all([
			frame.executeJavaScript(`Archify.exportMenu.run(${JSON.stringify(format)})`, true),
			downloaded,
		]);
		assert.equal(statSync(download.filename).size, download.bytes);
		assert(download.bytes > 100, `${format} export must contain image data`);
		assert(download.mime.startsWith(`image/${format === "svg" ? "svg+xml" : format}`));
		return download.filename;
	} finally {
		clearTimeout(timeout);
		session.removeListener("will-download", listener);
	}
}

async function checkSvgExport(filename, sourceNodeCount) {
	const browser = new BrowserWindow({
		show: false,
		width: 480,
		height: 320,
		webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false },
	});
	try {
		await browser.loadFile(filename);
		const result = await browser.webContents.executeJavaScript(`(() => {
			const svg = document.documentElement;
			const box = svg.viewBox.baseVal;
			const background = svg.querySelector(":scope > rect");
			const backgrounds = [...svg.querySelectorAll(':scope > rect')];
			for (const item of backgrounds) item.style.display = "none";
			const bounds = svg.getBBox();
			for (const item of backgrounds) item.style.display = "";
			const nodes = [...svg.querySelectorAll("[data-node-id]")];
			return {
				name: svg.localName,
				nodeCount: nodes.length,
				visible: nodes.every((node) => {
					const style = getComputedStyle(node);
					return style.display !== "none" && style.visibility !== "hidden"
						&& Number(style.opacity) > 0.9;
				}),
				clean: !svg.hasAttribute("data-view-scale") && !svg.hasAttribute("data-focus-active")
					&& !svg.hasAttribute("data-animation") && !svg.style.transform && !svg.style.clipPath,
				contained: bounds.x >= box.x && bounds.y >= box.y
					&& bounds.x + bounds.width <= box.x + box.width
					&& bounds.y + bounds.height <= box.y + box.height,
				width: Number(svg.getAttribute("width")),
				height: Number(svg.getAttribute("height")),
				viewBoxWidth: box.width,
				viewBoxHeight: box.height,
				cssWidth: getComputedStyle(svg).width,
				cssHeight: getComputedStyle(svg).height,
				background: ["x", "y", "width", "height"].map((name) => Number(background.getAttribute(name))),
				viewBox: [box.x, box.y, box.width, box.height],
			};
		})()`);
		assert.equal(result.name, "svg");
		assert.equal(result.nodeCount, sourceNodeCount);
		assert(result.visible && result.clean && result.contained, JSON.stringify(result));
		assert.equal(result.width, result.viewBoxWidth);
		assert.equal(result.height, result.viewBoxHeight);
		assert.equal(result.cssWidth, `${result.width}px`);
		assert.equal(result.cssHeight, `${result.height}px`);
		assert.deepEqual(result.background, result.viewBox);
		return result;
	} finally {
		browser.destroy();
	}
}

async function checkRasterExport(frame, filename, format) {
	const encoded = readFileSync(filename).toString("base64");
	const result = await frame.executeJavaScript(`new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = 100;
			canvas.height = 100;
			const context = canvas.getContext("2d");
			context.drawImage(image, 0, 0, 100, 100);
			const pixels = context.getImageData(0, 0, 100, 100).data;
			const colors = new Set();
			for (let index = 0; index < pixels.length; index += 4) {
				if (pixels[index + 3]) colors.add(Array.from(pixels.slice(index, index + 4)).join(","));
			}
			resolve({ width: image.naturalWidth, height: image.naturalHeight, colors: colors.size });
		};
		image.onerror = () => reject(new Error("Cannot decode exported ${format}"));
		image.src = "data:image/${format};base64,${encoded}";
	})`);
	assert(result.width > 0 && result.height > 0 && result.colors > 10, JSON.stringify(result));
	assert(result.width <= 16383 && result.height <= 16383, JSON.stringify(result));
	assert(result.width * result.height <= 16777216, JSON.stringify(result));
	return result;
}

async function settle(frame) {
	const deadline = Date.now() + 10000;
	let previous = "";
	let stableSamples = 0;
	while (Date.now() < deadline) {
		const snapshot = await frame.executeJavaScript(`(() => {
			const root = document.documentElement;
			const diagram = document.querySelector(".diagram-container");
			const svg = diagram && diagram.querySelector(":scope > svg");
			const rect = diagram && diagram.getBoundingClientRect();
			return JSON.stringify([
				document.readyState,
				svg && svg.getAttribute("data-rhyza-fitted"),
				innerWidth, innerHeight, root.clientWidth, root.scrollHeight,
				rect && rect.top, rect && rect.width, rect && rect.height,
				svg && getComputedStyle(svg).transform,
			]);
		})()`);
		stableSamples = snapshot === previous ? stableSamples + 1 : 0;
		previous = snapshot;
		const [ready, fitted] = JSON.parse(snapshot);
		if (stableSamples >= 3 && ready === "complete" && fitted === "true") return;
		await delay(50);
	}
	throw new Error(`Archify viewport did not settle within 10 seconds: ${previous}`);
}

async function main() {
	await app.whenReady();
	const window = new BrowserWindow({
		show: false,
		width: 1440,
		height: 900,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			backgroundThrottling: false,
			offscreen: true,
		},
	});
	window.webContents.session.webRequest.onBeforeRequest(
		{ urls: ["http://*/*", "https://*/*"] },
		(_details, callback) => callback({ cancel: true }),
	);
	const errors = [];
	window.webContents.on("console-message", (details) => {
		if (details.level === "error" && !details.message.includes("Content Security Policy")) {
			errors.push(details.message);
		}
	});
	try {
		const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
		let smallWidth = 0;
		for (const fixture of fixtures) {
			console.log(`Checking ${fixture.name}`);
			let frame = await loadDocument(window, fixture.previewHtml);
			let canvasSize;
			for (const width of [375, 768, 1024, 1440, 2400, 600]) {
				nativeTheme.themeSource = width === 375 ? "dark" : "light";
				window.setContentSize(width, 700);
				await settle(frame);
				const result = await frame.executeJavaScript(`(() => {
					const root = document.documentElement;
					const svg = document.querySelector(".diagram-container > svg");
					const box = svg.viewBox.baseVal;
					const backgrounds = [...svg.querySelectorAll(':scope > rect[fill^="url(#grid)"]')];
					for (const background of backgrounds) background.style.display = "none";
					const content = svg.getBBox();
					for (const background of backgrounds) background.style.display = "";
					const rect = svg.getBoundingClientRect();
					const hidden = [".header", ".toolbar", ".diagram-nav", ".cards", ".guided-views", ".route-probe", ".overview-map",
						".semantic-lens", ".focus-chip", ".diagram-guide", ".node-finder",
						"#btn-theme", "#btn-present", "#btn-preset", "#btn-route-probe",
						"#btn-overview-map", "#btn-node-finder", "#btn-diagram-guide",
						'.export-menu-section:has(button[data-format="share-card"])'];
					const visible = (element) => element && element.getClientRects().length > 0
						&& getComputedStyle(element).display !== "none";
					const nodes = [...svg.querySelectorAll("[data-node-id]")].map((node) => {
						const box = node.getBBox();
						return { x: box.x, width: box.width };
					});
					return {
						fitted: svg.getAttribute("data-rhyza-fitted"),
						mode: root.getAttribute("data-rhyza-mode"),
						theme: root.getAttribute("data-theme"),
						preset: root.getAttribute("data-preset"),
						hidden: hidden.every((selector) => !visible(document.querySelector(selector))),
						exportVisible: visible(document.querySelector("#btn-export")),
						zoomVisible: visible(document.querySelector('[data-view="in"]')),
						pageWidth: root.scrollWidth,
						viewportWidth: root.clientWidth,
						shellWidth: document.querySelector(".container").getBoundingClientRect().width,
						contained: content.x >= box.x && content.y >= box.y
							&& content.x + content.width <= box.x + box.width
							&& content.y + content.height <= box.y + box.height,
						svgWidth: rect.width,
						svgBottom: rect.bottom,
						viewBoxWidth: box.width,
						viewBoxHeight: box.height,
						contentWidth: content.width,
						contentHeight: content.height,
						readyState: document.readyState,
						scaleX: svg.getScreenCTM().a,
						scaleY: svg.getScreenCTM().d,
						viewportHeight: innerHeight,
						nodes,
					};
				})()`);
				const context = `${fixture.name} at ${width}px: ${JSON.stringify(result)} errors: ${errors.join("\n")}`;
				assert.equal(result.fitted, "true", context);
				assert.equal(result.mode, "inline", context);
				assert.equal(result.theme, nativeTheme.themeSource, context);
				assert.equal(result.preset, "classic", context);
				assert.deepEqual(errors, [], context);
				assert(result.hidden && !result.exportVisible && !result.zoomVisible, context);
				assert(result.contained, context);
				assert(result.pageWidth <= result.viewportWidth + 1, context);
				assert(result.svgWidth <= result.viewportWidth, context);
				assert(Math.abs(result.scaleX - result.svgWidth / result.viewBoxWidth) < 0.001, context);
				assert(result.shellWidth >= result.viewportWidth - 34, context);
				assert(Math.abs(result.scaleX - result.scaleY) < 0.001, context);
				const size = [result.viewBoxWidth, result.viewBoxHeight];
				if (canvasSize) assert.deepEqual(size, canvasSize, context);
				canvasSize = size;
				if (fixture.name === "2-columns") smallWidth = result.viewBoxWidth;
				if (fixture.name === "10-columns") {
					assert(result.viewBoxWidth > smallWidth * 3, context);
					assert(result.viewBoxWidth > 2000, context);
					assert(result.viewBoxWidth > result.svgWidth, context);
					for (let index = 1; index < result.nodes.length; index += 1) {
						const previous = result.nodes[index - 1];
						assert(result.nodes[index].x - previous.x - previous.width >= 39, context);
					}
				}
			}
			frame = await loadDocument(window, fixture.html);
			window.setContentSize(1440, 900);
			await settle(frame);
			const full = await frame.executeJavaScript(`(() => {
				const visible = (selector) => {
					const element = document.querySelector(selector);
					return element && element.getClientRects().length > 0
						&& getComputedStyle(element).display !== "none";
				};
				return {
					mode: document.documentElement.getAttribute("data-rhyza-mode"),
					preset: document.documentElement.getAttribute("data-preset"),
					controls: [".header", ".toolbar", "#btn-theme", "#btn-preset", "#btn-export",
						'[data-view="in"]'].every(visible),
					guided: visible(".guided-views"),
					formats: [...document.querySelectorAll("#export-menu button")].map((button) => button.dataset.format),
					nodeCount: document.querySelectorAll(".diagram-container > svg [data-node-id]").length,
				};
			})()`);
			assert.equal(full.mode, "expanded");
			assert.equal(full.preset, "classic");
			assert(full.controls, JSON.stringify(full));
			if (fixture.name === "agent-tool-call.workflow") assert(full.guided);
			assert.deepEqual(full.formats, ["png", "webp", "svg"]);
			const originalTheme = await frame.executeJavaScript(
				'document.documentElement.getAttribute("data-theme")',
			);
			await frame.executeJavaScript('document.querySelector("#btn-theme").click()');
			assert.notEqual(
				await frame.executeJavaScript('document.documentElement.getAttribute("data-theme")'),
				originalTheme,
			);
			await frame.executeJavaScript('document.querySelector("#btn-present").click()');
			assert.equal(
				await frame.executeJavaScript('document.documentElement.getAttribute("data-present")'),
				"true",
			);
			await frame.executeJavaScript('document.querySelector("#btn-present").click()');
			assert.equal(
				await frame.executeJavaScript('document.documentElement.getAttribute("data-present")'),
				null,
			);
			await settle(frame);
			assert.equal(
				await frame.executeJavaScript(`(() => {
				Archify.preset.apply("blueprint");
				return document.documentElement.getAttribute("data-preset");
			})()`),
				"blueprint",
			);
			await frame.executeJavaScript('Archify.preset.apply("classic")');
			await frame.executeJavaScript(`document.querySelector('[data-view="in"]').click()`);
			await settle(frame);
			const zoom = await frame.executeJavaScript(
				`document.querySelector(".diagram-container > svg").getAttribute("data-view-scale")`,
			);
			assert(Number(zoom) > 1, fixture.name);
			window.setContentSize(600, 700);
			await settle(frame);
			assert.equal(
				await frame.executeJavaScript(
					'document.querySelector(".diagram-container").hasAttribute("data-wide-diagram")',
				),
				false,
				"The expanded mobile viewer must use fitted zoom, not upstream fixed-width panning.",
			);
			assert.equal(
				await frame.executeJavaScript(
					`document.querySelector(".diagram-container > svg").getAttribute("data-view-scale")`,
				),
				zoom,
				`${fixture.name}: resizing must not reset user zoom`,
			);
			await frame.executeJavaScript(`(() => {
				const svg = document.querySelector(".diagram-container > svg");
				svg.setAttribute("data-focus-active", "true");
				svg.querySelector("[data-node-id]").setAttribute("data-focus-match", "");
			})()`);
			const svgFile = await downloadExport(window, frame, "svg", fixture.name);
			await checkSvgExport(svgFile, full.nodeCount);
			if (fixture.name === "agent-tool-call.workflow") {
				assert.deepEqual(errors, []);
				const failure = await frame.executeJavaScript(`(async () => {
					const svg = document.querySelector(".diagram-container > svg");
					const display = svg.style.display;
					try {
						svg.style.display = "none";
						await Archify.exportMenu.run("svg");
						const notice = document.querySelector(".rhyza-export-error");
						return { message: notice.textContent, visible: !notice.hidden };
					} finally {
						svg.style.display = display;
					}
				})()`);
				assert(failure.visible, JSON.stringify(failure));
				assert.match(failure.message, /Cannot measure the complete diagram/);
				await settle(frame);
				assert.match(errors.shift(), /Cannot measure the complete diagram/);
				assert.match(errors.shift(), /Ignored call to 'alert\(\)'.*sandboxed/);
				assert.deepEqual(errors, []);
				for (const format of ["png", "webp"]) {
					const filename = await downloadExport(window, frame, format, fixture.name);
					await checkRasterExport(frame, filename, format);
				}
				assert.equal(
					await frame.executeJavaScript('document.querySelector(".rhyza-export-error").hidden'),
					true,
					"A successful retry must clear the visible export error.",
				);
			}
			if (fixture.name === "10-columns") {
				for (const [width, height] of [
					[40000, 100],
					[7000, 4000],
				]) {
					await frame.executeJavaScript(`(() => {
						const svg = document.querySelector(".diagram-container > svg");
						const rectangle = document.createElementNS(svg.namespaceURI, "rect");
						rectangle.id = "export-bounds-fixture";
						rectangle.setAttribute("width", ${JSON.stringify(String(width))});
						rectangle.setAttribute("height", ${JSON.stringify(String(height))});
						rectangle.setAttribute("fill", "none");
						rectangle.setAttribute("stroke", "#00b4d8");
						svg.append(rectangle);
					})()`);
					const name = `export-bounds-${width}-${height}`;
					const filename = await downloadExport(window, frame, "svg", name);
					const geometry = await checkSvgExport(filename, full.nodeCount);
					assert(geometry.width > width && geometry.height > height);
					const scale = Math.min(
						Math.sqrt(16777216 / (geometry.width * geometry.height)),
						16383 / Math.max(geometry.width, geometry.height),
					);
					assert(scale < 1, "The fixture must exercise fractional downscaling.");
					for (const format of ["png", "webp"]) {
						const rasterFile = await downloadExport(window, frame, format, name);
						const raster = await checkRasterExport(frame, rasterFile, format);
						assert.deepEqual(
							[raster.width, raster.height],
							[Math.floor(geometry.width * scale), Math.floor(geometry.height * scale)],
						);
					}
					await frame.executeJavaScript(
						'document.querySelector("#export-bounds-fixture").remove()',
					);
				}
			}
			assert.equal(
				await frame.executeJavaScript(
					`document.querySelector(".diagram-container > svg").getAttribute("data-view-scale")`,
				),
				zoom,
				"Export must not reset the live camera.",
			);
			assert.match(
				await frame.executeJavaScript(`(() => {
				try {
					Archify.exportMenu.run("jpeg");
				} catch (error) {
					return error.message;
				}
			})()`),
				/Unsupported diagram export format/,
			);
			await frame.executeJavaScript(`document.querySelector('[data-view="reset"]').click()`);
			await settle(frame);
			assert.equal(
				await frame.executeJavaScript(
					`document.querySelector(".diagram-container > svg").getAttribute("data-view-scale")`,
				),
				"1",
				fixture.name,
			);
		}
		console.log("ARCHIFY_VIEWER_OK");
	} finally {
		window.destroy();
	}
}

main()
	.then(() => app.exit(0))
	.catch((error) => {
		console.error(error);
		app.exit(1);
	});
