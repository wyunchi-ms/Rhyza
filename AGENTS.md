# Rhyza agent instructions

## Code formatting

- Keep source code readable. Do not compress function bodies, event handlers, JSX, or CSS rules onto one line to save space. Use normal multiline blocks for functions containing statements; concise expression callbacks are fine when the formatter keeps them readable.
- After creating or editing source files, run `npm run format -- <file paths>` before validation or reporting completion. Run `npm run format:check` before the final response. With no file arguments, these commands operate on modified, staged, and untracked source files only.
- Use the repository's pinned Prettier and `.prettierrc.json` for TS, TSX, JS, JSX, HTML, CSS, SCSS, LESS, JSON, and YAML. Do not use `npx` to download an arbitrary formatter during a hook run.
- `.codex/hooks.json` runs the same formatter after file-edit/shell tools and before a turn finishes. The explicit format/check commands remain required when hooks have not been loaded or trusted. Formatting does not replace type checking or relevant tests.
- Avoid unrelated whole-repository formatting. Do not format dependencies, generated output, vendored skills, lockfiles, or other agents' directories.

## Reserved agent directories

- Never create, modify, format, or delete code, temporary pages, test fixtures, scripts, screenshots, or other artifacts inside `.sisyphus/` or `.sisphus/`. `.sisyphus/` belongs to OpenCode's Oh My OpenCode (OMO) agents and is not a Codex scratch directory.
- Do not clean up or repurpose existing files in those directories.
- Put project code in `src/`, reusable scripts in `scripts/`, and committed tests in `tests/`. Use an OS temporary directory for disposable experiments and test fixtures.

## Formatting commands

- `npm run format -- src/components/SessionGraph.tsx`: format explicit files.
- `npm run format`: format changed source files.
- `npm run format:check`: check changed source files without writing.
- `npm run test:formatter`: exercise formatter and hook path handling in OS temporary directories.
