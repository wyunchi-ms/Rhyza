# Tauri + Node sidecar prototype

This branch keeps the existing React/Vite UI and Node-based Pi agent services while replacing Electron's bundled Chromium window with a Tauri system-WebView shell.

## Architecture

```text
React UI in Tauri WebView
  -> authenticated JSON RPC on 127.0.0.1
  -> Node sidecar
     -> Pi coding agent
     -> workspace/source services
     -> persisted application state

Node sidecar
  -> authenticated SSE
  -> auth and streaming agent events in React
```

The sidecar binds an ephemeral loopback port and creates a random token for every launch. Tauri receives the handshake through the child process stdout. Prompts and workspace data never leave the local RPC channel except through the configured model provider.

## Development

1. Install JavaScript dependencies with `npm install`.
2. Ensure Rust and the platform Tauri prerequisites are installed.
3. Ensure `node` is on PATH, or set `RHYZA_NODE_BINARY` to an absolute Node executable.
4. Run `npm run tauri:dev`.

The Tauri pre-dev command compiles `dist-electron/sidecar/index.js` before starting Vite. The name of that output folder is retained temporarily so Electron and Tauri can share one TypeScript build.

## Verified in this prototype

- React and sidecar TypeScript builds pass.
- The Node sidecar starts, emits a handshake, authenticates RPC requests, and returns the configured workspace.
- The Tauri Rust shell passes `cargo check` on Windows.
- Existing Electron code remains available on this branch.

## Remaining production work

- Bundle a standalone Node executable for every target triple and teach the Rust shell to resolve the packaged resource path.
- Replace the temporary `node` PATH dependency.
- Implement native save-file UI for patch export and harden external-link opening.
- Add sidecar restart/backoff and surface fatal sidecar failures in the UI.
- Add signed installers, updater configuration, icons, and CI builds for Windows, Linux, macOS x64/arm64.
- Run Mermaid, ReactFlow, font, clipboard, and scrolling compatibility tests on WebView2, WKWebView, and WebKitGTK.
- Measure final installer size after packaging Node and production dependencies.

## Current build limitation

The first Rust build needs working crates.io access to populate Cargo's dependency cache. Once dependencies are available, the current Tauri shell passes `cargo check` on Windows.
