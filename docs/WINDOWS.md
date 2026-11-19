# Read IT on Windows (Tauri 2)

## Install

- Download `ReadIT_*_x64-setup.exe` from the project's Releases page and run it; it
  installs per user, no admin prompt.
- Unsigned build: SmartScreen shows "Windows protected your PC" — click
  **More info → Run anyway**.
- Needs WebView2 (preinstalled on Windows 10 and 11); the installer fetches
  Microsoft's bootstrapper if it is missing.

## Offline

- Same Vite bundle as the PWA, built with `--mode native` (no service worker); all
  data stays on the device.
- On-device voices download their weights once and then live in the WebView cache;
  platform voices need nothing.
- SharedArrayBuffer (multithreaded WASM) comes from `COOP: same-origin` +
  `COEP: credentialless` — `credentialless` rather than `require-corp` because model
  files are cross-origin CORS responses and article pages can still use cross-origin
  images.

## Data

- `%LOCALAPPDATA%\app.readit.reader` — the WebView2 profile:
  `EBWebView\Default\IndexedDB` (library, highlights, notes) and cache (voice models,
  audio).
- Uninstalling keeps that folder; export a backup from Settings first, and delete
  the folder to reset.

## Build

- `pnpm install`, then `pnpm win:build` →
  `src-tauri\target\release\bundle\nsis\ReadIT_*_x64-setup.exe` (first build compiles
  Rust, several minutes).
- `pnpm tauri dev` runs a hot-reloading shell against `http://localhost:5173`.
- Not included yet: code signing, auto-updater; OS voices still go through the Web
  Speech API.
