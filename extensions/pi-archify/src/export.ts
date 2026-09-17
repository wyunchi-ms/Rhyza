const exportBounds = `
        // Measure the clean export, not the live camera or its detail level.
        clone.removeAttribute('data-animation');
        clone.querySelectorAll('[data-animate]').forEach(function (element) {
          element.removeAttribute('data-animate');
        });
        var gridBackgrounds = Array.from(clone.querySelectorAll(':scope > rect[fill^="url(#grid)"]'));
        var gridDisplays = gridBackgrounds.map(function (background) {
          return background.style.display;
        });
        gridBackgrounds.forEach(function (background) {
          background.style.display = 'none';
        });
        clone.style.setProperty('position', 'fixed');
        clone.style.setProperty('visibility', 'hidden');
        clone.style.setProperty('pointer-events', 'none');
        document.body.appendChild(clone);
        var bounds;
        try {
          bounds = clone.getBBox();
        } finally {
          clone.remove();
          clone.style.removeProperty('position');
          clone.style.removeProperty('visibility');
          clone.style.removeProperty('pointer-events');
          gridBackgrounds.forEach(function (background, index) {
            background.style.display = gridDisplays[index];
          });
        }
        if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
            || bounds.width <= 0 || bounds.height <= 0) {
          throw new Error('Cannot measure the complete diagram for export.');
        }
        var padding = 24;
        var vb = {
          x: Math.floor(bounds.x - padding),
          y: Math.floor(bounds.y - padding),
          width: Math.ceil(bounds.x + bounds.width + padding) - Math.floor(bounds.x - padding),
          height: Math.ceil(bounds.y + bounds.height + padding) - Math.floor(bounds.y - padding)
        };
        clone.setAttribute('viewBox', [vb.x, vb.y, vb.width, vb.height].join(' '));
        clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        gridBackgrounds.forEach(function (background) {
          background.setAttribute('x', String(vb.x));
          background.setAttribute('y', String(vb.y));
          background.setAttribute('width', String(vb.width));
          background.setAttribute('height', String(vb.height));
        });
        if (!autoTheme) {
          scale = Math.min(scale, Math.sqrt(16777216 / (vb.width * vb.height)),
            16383 / Math.max(vb.width, vb.height));
        }
        // Host sizing and responsive SVG rules must not resize a standalone artifact.
        clone.style.setProperty('width', (vb.width * scale) + 'px', 'important');
        clone.style.setProperty('height', (vb.height * scale) + 'px', 'important');
        clone.style.setProperty('min-width', '0', 'important');
        clone.style.setProperty('min-height', '0', 'important');
        clone.style.setProperty('max-width', 'none', 'important');
        clone.style.setProperty('max-height', 'none', 'important');
        clone.style.setProperty('overflow', 'visible', 'important');
        var finiteSvgDimensions =`;

export const archifyExportPatches: ReadonlyArray<readonly [string, string]> = [
	["var vb = svg.viewBox.baseVal;\n        var finiteSvgDimensions =", exportBounds.trimStart()],
	[
		"bgRect.setAttribute('width', '100%');\n        bgRect.setAttribute('height', '100%');",
		`bgRect.setAttribute('x', String(vb.x));
        bgRect.setAttribute('y', String(vb.y));
        bgRect.setAttribute('width', String(vb.width));
        bgRect.setAttribute('height', String(vb.height));`,
	],
	[
		"Promise.resolve(serializeSvg(1, { autoTheme: true })).then(function (d) {",
		`Promise.resolve().then(function () {
              return serializeSvg(1, { autoTheme: true });
            }).then(function (d) {`,
	],
	[
		": rasterize(format).then(function (blob) {",
		`: Promise.resolve().then(function () {
              return rasterize(format);
            }).then(function (blob) {`,
	],
];

/** Preserve upstream style and interaction cleanup while fixing geometry and surfacing errors. */
export function patchArchifyExportHtml(html: string): string {
	let prepared = html.replace(/\r\n/g, "\n");
	for (const [source, replacement] of archifyExportPatches) {
		const index = prepared.indexOf(source);
		if (index < 0 || index !== prepared.lastIndexOf(source)) {
			throw new Error("The Archify export adapter does not match the bundled viewer.");
		}
		prepared = prepared.replace(source, () => replacement);
	}
	return prepared;
}
