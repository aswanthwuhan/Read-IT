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
- A new deploy updates in the background — reload once when the app says an update
  is ready.
- Backup (Settings → Backup) is the only copy of your books and notes. Hosting
  stores nothing about what you read.
