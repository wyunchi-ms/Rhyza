export type AppTheme = "light" | "dark";
export type ArchifyViewerMode = "inline" | "expanded";

interface ArchifyViewerOptions {
	theme?: AppTheme;
	mode?: ArchifyViewerMode;
}

const viewerStyles = `
	html[data-rhyza-viewer] .container {
		max-width: none !important;
		min-width: 0;
	}
	html[data-rhyza-viewer] .diagram-container {
		overflow: hidden !important;
	}
	html[data-rhyza-viewer] .diagram-container > svg {
		width: 100% !important;
		min-width: 0 !important;
		height: auto;
	}
	html[data-rhyza-viewer] .export-menu button:not([data-format="png"]):not([data-format="webp"]):not([data-format="svg"]),
	html[data-rhyza-viewer] .export-menu-section:not(:has(button[data-format="png"], button[data-format="webp"], button[data-format="svg"])) {
		display: none !important;
	}
	html[data-rhyza-viewer] .toolbar #btn-export {
		min-height: 2rem;
		border-radius: 6px;
		padding: 0.35rem 0.65rem;
		font-size: 0.72rem;
		font-weight: 650;
	}
	html[data-rhyza-viewer] .pulse-dot {
		width: 12px !important;
		height: 12px !important;
		min-width: 12px !important;
		flex: 0 0 12px !important;
		aspect-ratio: 1 / 1;
		border-radius: 50% !important;
	}
	html[data-rhyza-mode="inline"],
	html[data-rhyza-mode="inline"] body {
		min-height: 0 !important;
		overflow-x: hidden !important;
	}
	html[data-rhyza-mode="inline"] body {
		padding: 1rem !important;
	}
	html[data-rhyza-mode="inline"] .diagram-container {
		padding: 1rem !important;
		--archify-nav-reserve: 0px !important;
	}
	html[data-rhyza-mode="inline"] .header,
	html[data-rhyza-mode="inline"] .toolbar,
	html[data-rhyza-mode="inline"] .diagram-nav,
	html[data-rhyza-mode="inline"] .cards,
	html[data-rhyza-mode="inline"] .guided-views,
	html[data-rhyza-mode="inline"] .route-probe,
	html[data-rhyza-mode="inline"] .overview-map,
	html[data-rhyza-mode="inline"] .overview-map-feedback,
	html[data-rhyza-mode="inline"] .semantic-lens,
	html[data-rhyza-mode="inline"] .focus-chip,
	html[data-rhyza-mode="inline"] .diagram-guide,
	html[data-rhyza-mode="inline"] .node-finder,
	html[data-rhyza-mode="inline"] #btn-route-probe,
	html[data-rhyza-mode="inline"] #btn-overview-map,
	html[data-rhyza-mode="inline"] #btn-semantic-lens,
	html[data-rhyza-mode="inline"] #btn-node-finder,
	html[data-rhyza-mode="inline"] #btn-diagram-guide {
		display: none !important;
	}
	.rhyza-export-error {
		margin: 0.75rem 0;
		padding: 0.75rem;
		border: 1px solid currentColor;
		border-radius: 6px;
		color: var(--security-stroke);
	}
	@media print {
		html[data-rhyza-viewer] .diagram-container {
			padding: 1rem !important;
		}
	}
`;

export function createArchifyViewerHead(options: ArchifyViewerOptions = {}): string {
	return `<style id="rhyza-archify-viewer">${viewerStyles}</style>
<script id="rhyza-archify-host">
(() => {
	const root = document.documentElement;
	const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)");
	const theme = ${JSON.stringify(options.theme ?? null)};
	const mode = root.getAttribute("data-rhyza-mode") || "expanded";
	let resizeQueued = false;

	function enforce() {
		const attributes = {
			"data-rhyza-mode": mode,
			"data-rhyza-viewer": "true",
		};
		if (theme || mode === "inline") {
			attributes["data-theme"] = theme || (preferredTheme.matches ? "dark" : "light");
		}
		if (mode === "inline") {
			attributes["data-preset"] = "classic";
			root.removeAttribute("data-present");
		}
		for (const [name, value] of Object.entries(attributes)) {
			if (root.getAttribute(name) !== value) root.setAttribute(name, value);
		}
	}

	function fitDiagram() {
		const svg = document.querySelector(".diagram-container > svg");
		if (!svg || typeof svg.getBBox !== "function") return;
		const backgrounds = [...svg.querySelectorAll(':scope > rect[fill^="url(#grid)"]')];
		const displays = backgrounds.map((background) => background.style.display);
		for (const background of backgrounds) background.style.display = "none";
		try {
			const box = svg.getBBox();
			if (![box.x, box.y, box.width, box.height].every(Number.isFinite)
				|| box.width <= 0 || box.height <= 0) return;
			const padding = 24;
			const x = Math.floor(box.x - padding);
			const y = Math.floor(box.y - padding);
			const width = Math.ceil(box.x + box.width + padding) - x;
			const height = Math.ceil(box.y + box.height + padding) - y;
			svg.setAttribute("viewBox", [x, y, width, height].join(" "));
			svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
			svg.setAttribute("data-rhyza-fitted", "true");
			svg.removeAttribute("width");
			svg.removeAttribute("height");
			for (const background of backgrounds) {
				background.setAttribute("x", String(x));
				background.setAttribute("y", String(y));
				background.setAttribute("width", String(width));
				background.setAttribute("height", String(height));
			}
		} finally {
			backgrounds.forEach((background, index) => {
				background.style.display = displays[index];
			});
		}
	}

	function resizeDiagram() {
		if (resizeQueued) return;
		resizeQueued = true;
		requestAnimationFrame(() => {
			resizeQueued = false;
			const diagram = document.querySelector(".diagram-container");
			if (!diagram) return;
			if (!diagram.querySelector(":scope > svg[data-rhyza-fitted]")) fitDiagram();
			// The upstream mobile reader pans a 720px canvas; this viewer fits it instead.
			diagram.removeAttribute("data-wide-diagram");
		});
	}

	root.setAttribute("data-preset", "classic");
	if (theme) root.setAttribute("data-theme", theme);
	enforce();
	new MutationObserver(enforce).observe(root, {
		attributes: true,
		attributeFilter: ["data-theme", "data-preset", "data-rhyza-mode", "data-present"],
	});
	preferredTheme.addEventListener("change", enforce);
	document.addEventListener("keydown", (event) => {
		if (mode !== "inline" || event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
		if (event.key.length === 1 && "?/tesfmlr".includes(event.key.toLowerCase())) {
			event.preventDefault();
		}
	}, { capture: true });
	document.addEventListener("DOMContentLoaded", () => {
		const menu = document.querySelector("#export-menu");
		const formats = new Set(["png", "webp", "svg"]);
		if (menu) {
			for (const button of menu.querySelectorAll("button")) {
				if (!formats.has(button.getAttribute("data-format"))) button.remove();
			}
			for (const section of menu.querySelectorAll(".export-menu-section")) {
				if (!section.querySelector("button")) section.remove();
				else if (section.querySelector('[data-format="svg"]')) {
					section.setAttribute("aria-label", "SVG");
					const heading = section.querySelector(".export-menu-heading");
					if (heading) heading.textContent = "SVG";
				}
			}
		}
		if (window.Archify && Archify.exportMenu) {
			const run = Archify.exportMenu.run;
			Archify.exportMenu.run = (format) => {
				if (!formats.has(format)) throw new Error("Unsupported diagram export format: " + format);
				return run(format);
			};
		}
		const exportError = document.createElement("p");
		exportError.className = "rhyza-export-error";
		exportError.setAttribute("role", "alert");
		exportError.hidden = true;
		const shell = document.querySelector(".container");
		if (shell) shell.prepend(exportError);
		new MutationObserver(() => {
			const error = root.getAttribute("data-last-export-error");
			exportError.textContent = error ? viewerText("viewer.export.failed", { message: error }) : "";
			exportError.hidden = !error;
		}).observe(root, { attributes: true, attributeFilter: ["data-last-export-error"] });
		fitDiagram();
		resizeDiagram();
		if (typeof ResizeObserver === "function") {
			const observer = new ResizeObserver(resizeDiagram);
			for (const selector of [".container", ".header", ".diagram-container"]) {
				const element = document.querySelector(selector);
				if (element) observer.observe(element);
			}
		}
		if (document.fonts) {
			document.fonts.ready.then(() => {
				fitDiagram();
				resizeDiagram();
			});
		}
	}, { once: true });
	window.addEventListener("resize", resizeDiagram, { passive: true });
	window.addEventListener("load", resizeDiagram, { once: true });
})();
</script>`;
}

export function prepareArchifyViewerHtml(html: string, options: ArchifyViewerOptions = {}): string {
	const prepared = html.replace(
		/<html\b([^>]*)>/i,
		(_tag, attributes: string) =>
			`<html${attributes} data-rhyza-mode="${options.mode ?? "expanded"}">`,
	);
	return prepared.replace(/<\/head>/i, () => `${createArchifyViewerHead(options)}\n</head>`);
}

export function createArchifyPreviewHtml(fullHtml: string): string {
	if (!/<html\b[^>]*\bdata-rhyza-mode="expanded"/i.test(fullHtml)) {
		throw new Error("An Archify preview must be derived from the full viewer document.");
	}
	return fullHtml.replace('data-rhyza-mode="expanded"', 'data-rhyza-mode="inline"');
}
