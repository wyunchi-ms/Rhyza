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

The UI uses an opaque-origin iframe with scripts and downloads enabled, without same-origin, parent navigation, popups, or Electron bridge access. A restrictive CSP blocks fetches, external scripts, external images, frames, and forms. Pages should inline their JavaScript, CSS, SVG and data URLs. The viewer supports expansion and HTML download; it does not inspect the page's DOM or implement renderer-specific theming/layout.

Extensions use ordinary Pi package discovery, skills, tools and lifecycle hooks. Host-provided Mermaid guidance is a default that extensions may override. Installing or uninstalling a package reloads agent sessions; the next request uses the updated package set.
