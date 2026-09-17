# Archify Pi extension

This directory is a self-contained, optional Pi package. Install this folder directly through **Settings → Pi Plugins → Install from local folder…**. No extension build or host-side renderer registration is needed. Keep the folder on disk while it is installed.

The extension uses Pi's standard `before_agent_start` hook, a skill, and the schema-backed `archify_render` tool. It supplies all Archify instructions, schemas, validators, CLI code, and rendering logic. The host has no Archify-specific API or UI.

The tool takes `specification`, a serialized Archify v1 JSON document. It writes four files to the current session workspace under `.rhyza/html/`:

- `.json`: the validated specification, including deterministic layout repairs.
- `.mjs`: a replay script runnable with Node. Set `ARCHIFY_CLI` to the extension's `skills/archify/bin/archify.mjs` if the extension moves.
- `.html`: the complete interactive page, with inline SVG and scripts.
- `.preview.html`: a compact chat view derived from the completed `.html`, with identical diagram content and scripts, changing only its viewer mode.

The final answer contains an ordinary HTML attachment reference:

````markdown
```html-preview
{"version":1,"path":".rhyza/html/diagram-example.html","previewPath":".rhyza/html/diagram-example.preview.html","title":"Architecture"}
```
````

Rhyza snapshots the HTML into the answer and displays it in its generic sandboxed viewer. Removing this extension does not invalidate saved HTML previews. Other HTML-producing extensions use the same protocol. The JSON and script stay on disk and are not parsed by the host.

The extension generates the full viewer first, then derives its compact preview without rendering the diagram again. Chat hides the page title/subtitle, toolbar, guided views, summary cards, and navigation panels. Expansion opens the full page with those controls restored. Both start with the classic visual preset; the full viewer lets readers change theme, preset, motion, and presentation settings. If a producer does not supply `previewPath`, the generic host shows the full document inline as before.

The full viewer's export menu offers PNG, WebP, and SVG only. Exports use the complete, static diagram, not the current zoom, focus, or animation frame. The extension adapter retains the vendored serializer's styling and interaction cleanup while fitting export bounds to the cleaned SVG, aligning its background, and fixing intrinsic dimensions so responsive page CSS cannot crop or resize the downloaded SVG. Raster resolution respects canvas and WebP dimension limits, including fractional downscaling for oversized diagrams. Export failures appear in the viewer even when its sandbox blocks browser alerts; a successful retry clears the notice. The replay script applies the same adjustments and regenerates both variants.

The SVG canvas fits the measured diagram content, including content beyond the original viewBox. Its layout is not squeezed into a fixed page width: the viewer uses the available width and proportionally scales the diagram on resize. Architecture grid cells also grow with repaired component widths so long labels do not push neighboring columns together. Diagram height follows its natural aspect ratio instead of the current iframe height, allowing the host's inline cards to grow and shrink with the content. Standalone and expanded viewers may scroll vertically. Existing saved answer snapshots are unchanged; regenerate a diagram to update its attached preview.

The host must allow installed extension tools when creating its Pi session. It must support the `html-preview` protocol to embed the page; ordinary Pi clients can still use the generated HTML file.

From the repository root, run `npm --prefix extensions\pi-archify run typecheck` and `npm --prefix extensions\pi-archify test`. Tests cover Pi installation, tool activation, customized HTML and replay scripts, parsing, rendering repairs, and sandboxed Electron layout checks for all five diagram types at narrow and wide viewport sizes. Development tools resolve from the repository checkout; deployed Pi loads the TypeScript entry directly. Runtime imports use Node built-ins and Pi's provided `typebox` package.

Upstream assets are under `skills/archify`, with their MIT license and version record. Do not format or modify vendored files when changing the extension adapter. To upgrade, replace the vendor snapshot, update its version record, and rerun the extension tests. The application needs no matching Archify release.
