# Archify Pi extension

This directory is a self-contained, optional Pi package. Install this folder directly through **Settings → Pi Plugins → Install from local folder…**. No extension build or host-side renderer registration is needed. Keep the folder on disk while it is installed.

The extension uses Pi's standard `before_agent_start` hook, a skill, and the schema-backed `archify_render` tool. It supplies all Archify instructions, schemas, validators, CLI code, and rendering logic. The host has no Archify-specific API or UI.

The tool takes `specification`, a serialized Archify v1 JSON document. It writes three files to the current session workspace under `.rhyza/html/`:

- `.json`: the validated specification, including deterministic layout repairs.
- `.mjs`: a replay script runnable with Node. Set `ARCHIFY_CLI` to the extension's `skills/archify/bin/archify.mjs` if the extension moves.
- `.html`: the complete interactive page, with inline SVG and scripts.

The final answer contains an ordinary HTML attachment reference:

````markdown
```html-preview
{"version":1,"path":".rhyza/html/diagram-example.html","title":"Architecture"}
```
````

Rhyza snapshots the HTML into the answer and displays it in its generic sandboxed viewer. Removing this extension does not invalidate saved HTML previews. Other HTML-producing extensions use the same protocol. The JSON and script stay on disk and are not parsed by the host.

The host must allow installed extension tools when creating its Pi session. It must support the `html-preview` protocol to embed the page; ordinary Pi clients can still use the generated HTML file.

From the repository root, run `npm --prefix archify-extension run typecheck` and `npm --prefix archify-extension test`. Tests cover Pi installation, tool activation, HTML output, replay scripts, parsing, and rendering repairs. Development tools resolve from the parent checkout; deployed Pi loads the TypeScript entry directly. Runtime imports use Node built-ins and Pi's provided `typebox` package.

Upstream assets are under `skills/archify`, with their MIT license and version record. Do not format or modify vendored files when changing the extension adapter. To upgrade, replace the vendor snapshot, update its version record, and rerun the extension tests. The application needs no matching Archify release.
