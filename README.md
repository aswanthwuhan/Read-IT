# Read IT

**[Android](docs/ANDROID.md)** · **[Windows](docs/WINDOWS.md)** · **[PWA](docs/PWA.md)** · **[Changelog](CHANGELOG.md)** · **[Plan](docs/PLAN.md)**

Offline-first reader for books you already own: import your own PDF, EPUB, DOCX, TXT/Markdown
and web articles, read them in a reflowing reader (or as PDF pages), and listen to them with
on-device voices. Files, highlights and notes live in IndexedDB on your device only —
no account, no backend, no server for reading. Apache-2.0.
Version 0.6.1 is the current public Read IT release: Android, Windows and the web as an
installable PWA. See `CHANGELOG.md`. The source is public at
[github.com/aswanthwuhan/Read-IT](https://github.com/aswanthwuhan/Read-IT).

## Who it is for

- People with a shelf of ebooks, papers or textbooks they want to read on a phone, offline.
- Anyone who wants a long document read aloud in a natural voice with nothing leaving the device.
- Readers who want highlights, notes and their place in a book to survive a reinstall.

## Features

- Import your own PDF, EPUB, DOCX, TXT/Markdown and web articles, or paste text.
- Read in a reflowing reader, or keep a PDF as pages with the sentence boxes in place.
- Listen with on-device voices (Kokoro-82M and Pocket TTS) or the system voice.
- Follow the read-along highlight; an optional on-device Whisper aligner makes it precise.
- Hear names and unusual words correctly through a pronunciation list you can edit.
- Save highlights, notes and bookmarks, and keep your place in each book.
- Keep reading with the screen off, with lock-screen controls and a sleep timer.
- Work fully offline. Files, highlights and notes stay on the device, with no account and no server.
- Run on Android, Windows and as an installable PWA. An iOS app is on the plan.

## Download / install

**Public source, private build pipeline.** v0.6.1 is the current release: the source is
public on GitHub; the Android APK is an unsigned debug build for review and testing, and
the store accounts are not open. What ships, and how you install it:

**Android (APK).** Android 8.0 or newer with WebView 110+ is required. The v0.6.1 release is
a source release; build and install the APK with [docs/ANDROID.md](docs/ANDROID.md). A signed,
store-ready APK is planned for the store launch.

**Windows (installer).** A Windows installer (`ReadIT_*_x64-setup.exe`) that installs per user
with no admin prompt. The build is unsigned, so SmartScreen shows "Windows protected your PC":
choose **More info → Run anyway**. It needs WebView2, which is already on Windows 10 and 11.
Details are in [docs/WINDOWS.md](docs/WINDOWS.md).

**PWA.** The web app is hosted on GitHub Pages at /Read-IT/ and installs from the browser. On Android
Chrome use ⋮ → **Install app**. On iPhone or iPad use Share → **Add to Home Screen**. On desktop
use the install icon in the address bar. Details are in [docs/PWA.md](docs/PWA.md).

Until then, build it yourself — see [Build from source](#build-from-source).

## Privacy

Imported files, highlights, notes and your place in each book are stored in IndexedDB on your
device. There is no server and no account, and nothing about what you read is sent anywhere.
Ads and a one-time "Remove Ads" purchase are planned; neither is in this release. Backup export
is the only copy, so export one before changing device.

## FAQ

**Is it free?**

Yes. The app is free and open source under Apache-2.0. Ads and a one-time "Remove Ads" purchase
are planned; nothing is charged for anything in this release.

**Do I need an account or an internet connection?**

No account, ever. After the one-time voice model download the app works offline. Importing a web
article needs a connection at the moment you import it; reading and listening to it afterwards
does not.

**Which formats can it open?**

Text PDF, EPUB, DOCX, TXT/Markdown and web articles (a URL where the site allows it, pasted text
where it does not). There is no OCR, no DRM, and no MOBI or AZW3.

**Does it work with scanned PDFs?**

Not yet. A scanned PDF imports but has no readable text because there is no OCR, and the app says
so at import.

**Which devices does it run on?**

Android 8.0+, Windows 10 and 11, and as an installable PWA in Chrome, Edge or Safari on iPhone
and iPad. A native iOS app is on the plan.

**Is it open source?**

Yes. The whole app — importers, reader, speech engines, shells — is in the repository under the
Apache-2.0 licence.

**What licence, and what about the parts inside it?**

The app is Apache-2.0. The pieces it uses keep their own licences: Kokoro (hexgrad) is Apache-2.0,
Pocket TTS (Kyutai) is MIT code with CC-BY-4.0 weights, the Literata reading font is SIL OFL 1.1.
The inventory is in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

**How big are the voice models?**

Kokoro is about 334 MB for the full model and 126 MB for the lighter INT8 one. Pocket TTS is
about 98 MB. Each downloads once, then is cached on the device. The system voice needs no
download at all.

## Build from source

```sh
pnpm install   then:   pnpm dev    (dev server)   pnpm test   (vitest)   pnpm build   (typecheck + bundle)
```

## Credits

- **Contributors:** see [CONTRIBUTORS.md](CONTRIBUTORS.md).
- **Voices:** Pocket TTS by Kyutai (code MIT, weights CC-BY-4.0) · Kokoro-82M by hexgrad
  (Apache-2.0), run through sherpa-onnx (Apache-2.0). The Pocket voices that need attribution
  carry it inside the app's Credits panel; the non-commercial voices are not shipped.
- **Reading font:** Literata (SIL OFL 1.1), self-hosted so nothing is fetched from a CDN.
- **Licence:** Apache-2.0. Provenance is recorded in [RELICENSING.md](RELICENSING.md); bundled
  components are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
