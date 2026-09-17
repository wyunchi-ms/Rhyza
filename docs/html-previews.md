# HTML preview protocol

The application embeds self-contained HTML files produced by any tool or extension. It has no renderer registry and does not interpret diagram specifications.

Return this explicit fenced declaration in an assistant answer:

````markdown
```html-preview
{"version":1,"path":"output/preview.html","title":"Preview"}
```
````

`version` must be `1`. `path` names an existing `.html` or `.htm` file inside the current session workspace, preferably relative to that workspace. `title` is optional, up to 200 characters. References are read after the assistant completes. An incomplete or invalid reference stays visible without executing anything.

The main process resolves symlinks and checks that each file stays within the session's actual workspace, including its isolated worktree. Each response can attach at most eight distinct files, at most 5 MB per file and 10 MB total. Missing, disallowed, or oversized files produce per-preview errors without failing the answer.

The HTML is persisted in `Turn.htmlPreviews`, separately from the short assistant text. Reopening or forking a conversation keeps the snapshot without sending the full HTML back as model transcript text. Deleting the generated file or uninstalling its extension does not remove the saved preview.

The UI uses an opaque-origin iframe with scripts and downloads enabled, without same-origin, parent navigation, popups, or Electron bridge access. A restrictive CSP blocks fetches, external scripts, external images, frames, and forms. Pages should inline their JavaScript, CSS, SVG and data URLs.

Inline cards grow and shrink to fit the full document, including after content changes, image/font loading, and width changes. A small host-injected script measures inside the sandbox and reports dimensions through `postMessage`; the host accepts only numeric heights from the matching iframe and document ID. Inline previews clear viewport-based height/min-height on the document root and body and suppress the document's vertical scrollbar. Height updates are coalesced per animation frame; one-pixel decreases retain the larger height to prevent fractional-layout flicker. Growth is immediate, but a smaller height must remain unchanged for at least six measurements and 150 ms before the card shrinks. This prevents temporary toolbar/footer re-layout after a viewport resize from repeatedly shrinking and expanding the iframe. The host does not access the iframe DOM or implement renderer-specific theming/layout. Pages should use normal document flow for content that needs to expand the card; deliberately scrollable elements within the page retain their own layout.

Expanded previews remain viewport-sized and scroll inside the full-screen viewer. HTML downloads preserve the original file without the sizing script or preview-only styles.

Markdown renderers keep stable component identities and receive changing attachment, status, and knowledge-link data through context. Parent updates must not remount an unchanged preview: that would reset its interactive state and repeat blocked resource requests. An external font stylesheet still produces a CSP warning on initial load; the preview uses its declared local fallback fonts rather than allowing network access.

Run `npm run test:html-preview` for the Electron/Chromium regression covering iframe identity, interactive state, repeated font warnings, updated link callbacks, attachment changes, and stable toolbar/footer geometry across content and width changes.

Extensions use ordinary Pi package discovery, skills, tools and lifecycle hooks. Host-provided Mermaid guidance is a default that extensions may override. Installing or uninstalling a package reloads agent sessions; the next request uses the updated package set.
