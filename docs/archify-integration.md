# Archify integration and upgrades

Rhyza vendors Archify under `resources/skills/archify`. It is not a git submodule and it is not imported as a frontend library. Electron starts the bundled CLI (`bin/archify.mjs`) with Node, receives a self-contained HTML artifact with inline SVG, and displays it in a sandboxed iframe.

The current upstream identity is recorded in `resources/skills/archify/RHYZA_VENDOR.json`. The originally vendored snapshot did not preserve an upstream commit SHA, so its `sourceRevision` is intentionally marked `unrecorded-vendored-snapshot`. The next upgrade must replace this with the exact upstream tag and commit.

## Integration boundaries

| Layer | Rhyza-owned integration | Upstream Archify contract |
| --- | --- | --- |
| Model authoring | `electron/main/archify-harness.ts` registers the local skill and requires a fenced `archify` JSON response. | `SKILL.md`, schemas, examples, and `bin/archify.mjs validate`. |
| Input and delivery | `electron/main/archify-service.ts` normalizes compatible legacy JSON, validates and delivers via the CLI, applies deterministic overlap fixes, and keeps a Mermaid fallback. | JSON schema v1, renderer CLI, diagnostics, generated HTML. |
| Inline preview | `src/components/ArchifyDiagram.tsx` owns the iframe, its intrinsic-height handshake, and the app-level full-screen dialog. | Self-contained HTML artifact. |
| Viewer presentation | `src/shared/archify-viewer.ts` injects Rhyza-scoped CSS and root attributes into the generated HTML. | Viewer DOM classes/IDs such as `.toolbar`, `.export-wrap`, `.cards`, and `#btn-export`. |

No Rhyza change currently edits Archify's `assets/template.html`, renderer files, schemas, or CLI code.

## What is configurable versus host customization

These choices use supported Archify inputs or CLI parameters:

- `meta.animation`, `meta.locale`, `meta.quality_profile`, diagram type, and diagram topology.
- `data-theme` and `data-preset` on the generated viewer root.
- `deliver <type> ... --quality showcase|standard`.

These preview requirements are not exposed as stable Archify schema/CLI options, so Rhyza applies them in its own host overlay rather than patching upstream:

- App-owned theme and classic preset enforcement.
- Hiding Archify controls that duplicate Rhyza controls; retaining the supported image exports.
- Hiding share-card actions, compacting the title, and fixing the status dot shape.
- Removing inline-only cards/maps/lenses and sizing the iframe to the complete artifact height without nested scrolling.

This means an Archify upgrade does **not** require replaying a patch against upstream source. It does require checking that the viewer's documented/observed DOM selectors remain available. If a selector changes, update only `src/shared/archify-viewer.ts` and its test instead of modifying the vendor runtime.

## Upgrade procedure

1. Choose a specific upstream release/tag and commit from `tt-a1i/archify`.
2. Replace the complete contents of `resources/skills/archify` with that exact upstream snapshot, preserving only Rhyza's `RHYZA_VENDOR.json` long enough to update it with the new version, tag, commit, and schema version.
3. Do not carry local edits into Archify source. Confirm that `assets/template.html`, `renderers/`, `schemas/`, and `bin/` match upstream.
4. Update `RHYZA_VENDOR.json`. Its `version` must equal the vendored `package.json` version; `schemaVersion` must equal the schema constant accepted by the new runtime.
5. Review the compatibility boundary in `src/shared/archify-viewer.ts`: verify toolbar/export selectors, diagram/header/card selectors, and the iframe height reporting flow against one generated artifact in both themes.
6. If the schema major changed, update `src/shared/archify.ts`, `electron/main/archify-harness.ts`, and their tests before accepting model output. Do not silently reinterpret an old schema.
7. Run the checks below and package a smoke build before merging.

```powershell
npm run typecheck
npm test
npm run smoke:archify
npm run build
```

`npm run smoke:archify` verifies local Skill discovery, CLI delivery, generic JSON normalization, Mermaid fallback, diagnostics, and the vendor manifest/package version match. The renderer tests additionally assert the Rhyza viewer overrides.

## Packaging

`package.json` excludes the vendor tree from the application archive and copies it as Electron `extraResources` to `resources/skills/archify`. `resolveBundledArchifySkillRoot()` locates that directory in packaged builds and the source directory during development. Updating the vendor tree therefore updates both development and packaged behavior without an additional dependency install.
