# PWA (Read IT)

The web app installs from the browser and works offline after the first load.

## Install

- **Android (Chrome):** open the URL → ⋮ menu → **Install app** (or "Add to Home screen").
- **iPhone/iPad (Safari):** open the URL → **Share** → **Add to Home Screen**.
- **Windows/macOS (Chrome or Edge):** open the URL → install icon in the address bar
  (Edge: ⋯ menu → Apps → Install this site as an app).

On iPhone, Safari can clear a website's stored data after seven days without a
visit. Adding the app to the Home Screen prevents that; the app says so once in the
Library.

## Hosting

The production build is published to GitHub Pages at
https://aswanthwuhan.github.io/Read-IT/ from the `gh-pages` branch (the `dist`
output at its root). `.github/workflows/pwa.yml` builds and uploads the same
bundle for review. The iOS simulator workflow builds the same tree under
`/readit/` with `VITE_BASE=/readit/` and serves it locally; a plain `pnpm build`
(no `VITE_BASE`) produces the root-path bundle used by development, Android and
Windows.

## Offline

- App shell, ORT runtime and imported books live on the device (service worker +
  IndexedDB), so the library, reader and TTS settings work without a connection.
- Voice models are not bundled: Kokoro and Pocket weights download once from their
  model host and are then cached. Platform voices need no download.
- Backup (Settings → Backup) is the only copy of your books and notes. Hosting
  stores nothing about what you read.

## Updates

The service worker uses prompt mode. When an update is waiting, a global,
non-modal banner offers **Reload now** and **Later**. It does not move focus or
open a dialog. The service-worker callbacks only change the banner state; the
page reloads only after the reader chooses **Reload now**.

There is no shared busy signal covering playback, audio generation, imports,
model downloads and backups. The banner therefore cannot detect or block those
operations. Finish or cancel the current operation before choosing **Reload now**,
or choose **Later** to keep reading. A manual browser reload is outside this
guard.

## Offline caches

- ORT and G2P runtime caches are named `readit-ort-runtime-<asset hash>` and
  `readit-g2p-lexicon-<asset hash>`. The hashes come from the same asset-version
  constants used to configure Workbox. The `readit-` prefix avoids collisions with
  other apps on a shared hosting origin.
- When a new service worker activates, it deletes only older app-scoped
  `readit-ort-runtime-*` and `readit-g2p-lexicon-*` caches. Legacy unscoped buckets
  are cleaned only for requests under this app's exact scope, preserving other
  apps' entries. Current runtime caches and all model, audio, book and Workbox
  caches are preserved.
- Neural worker JavaScript remains precached. Model weights, `.bin` files, ORT
  assets and lexicon files are excluded from the precache and use their runtime
  paths instead. Runtime caching matches only same-origin URLs under the exact
  `/Read-IT/ort/` and `/Read-IT/lexicon/` paths (or `/ort/` and `/lexicon/` for a
  root deployment).
