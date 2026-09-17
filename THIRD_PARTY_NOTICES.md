# Third-party notices

## Codex

Rhyza depends on the official [OpenAI Codex TypeScript SDK](https://github.com/openai/codex/tree/main/sdk/typescript) (`@openai/codex-sdk`) and its platform-specific Codex runtime. These packages are licensed under Apache-2.0; their license files are distributed with the installed packages.

Claude Code is not bundled. Users install and authenticate their own CLI, subject to Anthropic's applicable terms.

## Archify

Rhyza's optional Archify extension includes a runtime subset of [tt-a1i/archify](https://github.com/tt-a1i/archify), development version 2.16, to validate and render interactive diagrams. The application itself does not bundle or require this runtime. The vendored snapshot identity is recorded in `extensions/pi-archify/skills/archify/RHYZA_VENDOR.json`.

Archify is licensed under the MIT License. Copyright (c) 2026 tt-a1i (Archify). Copyright (c) 2025 Cocoon AI (original `architecture-diagram-generator`). The complete license text is included at `extensions/pi-archify/skills/archify/LICENSE`.
