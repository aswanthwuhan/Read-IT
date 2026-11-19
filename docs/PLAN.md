# Read IT — plan and scope

Read IT is a general, offline ebook reader for books the reader already owns. It
runs on Android, Windows and as an installable web app. The short version of the
product is in [PRODUCT.md](../PRODUCT.md); this file records what is in scope.

## Shipped

- **Library** — import PDF, EPUB, DOCX, TXT/Markdown, saved web articles and pasted
  text; per-book progress; delete; search.
- **Reader** — reflowing text view and PDF page view, read-along sentence and word
  highlighting, tap a sentence to hear it from there, font and theme settings.
- **Annotations** — highlights, notes, bookmarks; their text stays with the book.
- **Speech** — on-device Kokoro-82M, Pocket TTS and the platform voice; a short
  editable pronunciation list; audio cache; optional on-device word alignment.
- **Layout** — a downloadable on-device model that detects columns, tables and
  figures at PDF import so reading order comes out right.
- **Backup** — one zip of books, notes and settings, exportable and importable.
- **Shells** — Android (Capacitor), Windows (Tauri) and an installable PWA.

## Principles

- Private at launch: no account, no server, no sync, no telemetry. What is read
  stays on the device. The one optional network call is the opt-in update check.
- Offline is the normal state, not a degraded one. No remote font, no model fetched
  at reading time, no surface that waits on a request.
- Apache-2.0, with bundled components on permissive licences only. The licence guard
  in CI enforces this.
- Plain, specific copy. No marketing register, no invented performance claims.
- Ads and a one-time "Remove Ads" purchase are planned for later. Keep the code
  clean so they can be added without touching the reading surfaces.

## Not in scope

OCR, DRM, MOBI/AZW3, accounts, cloud sync, catalogues, spaced-repetition study
tools and generative features. A scanned PDF imports but has no readable text, and
the app says so at import time.

## Open items

- Native iOS shell on the same Capacitor base.
- Code signing and an auto-updater for the Windows build.
- Faster native Pocket TTS through the platform speech runtime (blocked on voice
  data, not synthesis speed; see [PERFORMANCE.md](PERFORMANCE.md)).
- Multithreaded WASM in the Android WebView, if cross-origin isolation ever becomes
  available there.
