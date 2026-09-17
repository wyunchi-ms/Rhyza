# HTML preview protocol

The application embeds self-contained HTML files produced by any tool or extension. It has no renderer registry and does not interpret diagram specifications.

Return this explicit fenced declaration in an assistant answer:

````markdown
```html-preview
{"version":1,"path":"output/full.html","previewPath":"output/compact.html","title":"Preview"}
```
````

`version` must be `1`. Required `path` names the **full HTML document**: an existing `.html` or `.htm` file inside the current session workspace, preferably relative to that workspace. Optional `previewPath` names a separate compact HTML document in the same allowed workspace. Both paths must be nonblank strings of at most 2,048 characters without control characters. `title` is optional, up to 200 characters. References are read after the assistant completes. An incomplete or invalid reference stays visible without executing anything.

The main process resolves symlinks and checks that **both** files are regular HTML files within the session's actual workspace, including its isolated worktree. Each response can attach at most eight distinct `(path, previewPath)` pairs, at most 5,000,000 bytes per file and 10,000,000 bytes total across both full and compact snapshots. Identical pairs are deduplicated regardless of title; references sharing a full path but naming different compact paths remain separate attachments. Their persisted copies count separately toward the total. Full HTML is read first, then its optional compact HTML. Missing, disallowed, or oversized full files produce per-attachment `error` values without failing the answer. An optional compact file failure produces `previewError`, retains the full snapshot, and displays an explicit notice before falling back to the full document.

The full snapshot remains in `Turn.htmlPreviews[].html`; optional compact snapshots are saved as `previewHtml`, alongside `previewPath` and any `previewError`. They are persisted separately from the short assistant text. Reopening or forking a conversation keeps both snapshots without sending their HTML back as model transcript text. Deleting the generated files or uninstalling the extension does not remove saved previews. References and saved documents without `previewPath` keep the existing full-document inline behavior.

The UI uses an opaque-origin iframe with scripts and downloads enabled, without same-origin, parent navigation, popups, or Electron bridge access. A restrictive CSP blocks fetches, external scripts, external images, frames, and forms. Pages should inline their JavaScript, CSS, SVG and data URLs.

Inline cards prefer the supplied `previewHtml`, falling back to `html` when no compact snapshot is available. The host does not generate compact layouts or interpret page content; the producing extension owns the compact document. Cards grow and shrink to fit their inline document, including after content changes, image/font loading, and width changes. A small host-injected script measures inside the sandbox and reports dimensions through `postMessage`; the host accepts only numeric heights from the matching iframe and document ID. Inline previews clear viewport-based height/min-height on the document root and body and suppress the document's vertical scrollbar. Height updates are coalesced per animation frame; one-pixel decreases retain the larger height to prevent fractional-layout flicker. Growth is immediate, but a smaller height must remain unchanged for at least six measurements and 150 ms before the card shrinks. This prevents temporary toolbar/footer re-layout after a viewport resize from repeatedly shrinking and expanding the iframe. The host does not access the iframe DOM or implement renderer-specific theming/layout. Pages should use normal document flow for content that needs to expand the card; deliberately scrollable elements within the page retain their own layout.

Expand always opens `html`, not `previewHtml`, in a separate viewport-sized iframe that scrolls inside the full-screen viewer. Opening and closing it leaves the inline iframe mounted with its interactive state intact. The generic Download HTML button always downloads the original full HTML without the host sizing script or styles. Page-owned export menus remain the producing extension's responsibility.

Markdown renderers keep stable component identities and receive changing attachment, status, and knowledge-link data through context. Parent updates must not remount an unchanged preview: that would reset its interactive state and repeat blocked resource requests. Changes to full HTML do not reload an unchanged compact inline document; changes to compact HTML do not reload an unchanged expanded full document. An external font stylesheet still produces a CSP warning on initial load; the preview uses its declared local fallback fonts rather than allowing network access.

Run `node --import tsx --test tests\html-preview.test.ts` for protocol validation, snapshot persistence, and file/size boundaries. Run `npm run test:html-preview` for the Electron/Chromium regression covering compact/full selection, fallback and error notices, full downloads, iframe identity, independent snapshot updates, interactive state, repeated font warnings, updated link callbacks, and stable toolbar/footer geometry across content and width changes.

Extensions use ordinary Pi package discovery, skills, tools and lifecycle hooks. Host-provided Mermaid guidance is a default that extensions may override. Installing or uninstalling a package reloads agent sessions; the next request uses the updated package set.
