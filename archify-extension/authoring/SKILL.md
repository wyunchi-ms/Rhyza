---
name: archify
description: Generate interactive architecture, workflow, sequence, dataflow, or lifecycle diagrams as standalone HTML files using the archify_render tool.
---

# HTML diagram authoring

1. Choose one diagram type. Read its schema at `../skills/archify/schemas/<type>.schema.json`, the common schema, and one matching example from `../skills/archify/examples/`. Paths are relative to this skill directory.
2. Author one bounded specification with `schema_version: 1`, the exact `diagram_type`, `meta.title`, and the type's required fields. Prefer at most 12 primary nodes, concise labels, and automatic layout. Use `meta.quality_profile: "showcase"`.
3. Call `archify_render` with the serialized JSON in `specification`. The tool validates, repairs supported layout issues, and writes the final `.json`, `.mjs`, and `.html` files.
4. If the tool fails, correct the reported fields and retry. Do not claim success until it produces an HTML file.
5. Copy the tool's complete `html-preview` fenced block into the final response. This versioned reference contains only the HTML file path and title. Do not output the input specification or the full HTML source.

The host reads HTML only. It does not know the diagram type, schema, renderer, or this extension. The generated `.mjs` script can be run with Node to rebuild the HTML; `ARCHIFY_CLI` can override the CLI location after moving the extension.

Use Mermaid only when requested by the user or as an explicitly explained fallback after generation fails. Upstream documentation under `../skills/archify/` is reference material; its historical host delivery instructions do not apply to this extension.
