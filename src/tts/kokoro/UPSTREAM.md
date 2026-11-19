# Vendored upstream: Kokoro-82M web engine

Read IT vendors the `kokoro-js` engine instead of depending on the npm package,
because that package still imports `phonemizer` (which embeds GPL-3.0 espeak-ng).
Vendoring lets us replace the phonemiser while keeping the model inference code.

- **Upstream:** https://github.com/hexgrad/kokoro-js
- **Pinned commit:** `dfb907a02bba8152ca444717ca5d78747ccb4bec` (v1.2.1)
- **Upstream licence:** Apache-2.0 (`upstream/LICENSE`; the same text is at the repo root as `LICENSE`)
- **Files:** `kokoro.ts`, `splitter.ts`, `voices.ts`, `phonemize.ts` (copied verbatim except for the change below). The raw upstream JS files were removed once the patched vendored copies were in place.
- **English lexicon (web):** `public/lexicon/lexicon-en-us.txt` — the **merged best-for-novels lexicon**: `hexgrad/misaki` English data (`us_gold` + `us_silver` + `gb_gold` + `gb_silver`, Apache-2.0) as the primary source, sherpa-onnx `lexicon-en-us.txt` (Apache-2.0) as the complement for words misaki lacks. Measured on the book fixture (`src/import/__fixtures__/sample-book.epub`, 5015 words): merged 4,855/5,015 covered (96.8%); sherpa alone 4,640 (92.5%); misaki `us_gold` alone 4,622 (92.2%). Sample phones: `the=ði` `nurse=nˈɜɹs` `patient=pˈAʃənt` `diet=dˈIət` `gutenberg=ɡjˈuːtənbˌɜːɡ` (misaki = the G2P Kokoro was trained with).

## Read IT changes

1. `phonemize.ts`: replaced

   ```js
   import { phonemize as espeakng } from "phonemizer";
   ```

   with

   ```js
   import { phonemizeWithLexicon } from "./g2p/index.js";
   ```

   and replaced the `espeakng(text, lang)` call with our G2P. All text
   normalisation upstream of that call (numbers, currency, dates, abbreviations,
   possessives, hyphenation) is untouched upstream Apache-2.0 code.

2. `g2p/` is written by Read IT. Its data is the merged English lexicon (misaki +
   sherpa) plus our own fallbacks: CMUdict (public domain) — already inside the
   merged file, since sherpa's lexicon is built from it — NRL Report 7948
   (US Government work, public domain) for out-of-vocabulary words, and the
   Kokoro tokenizer vocabulary (115 chars). The phone table is filtered to that
   vocabulary so no unknown token reaches the model. (The native Android plugin
   keeps the sherpa lexicon; only the web engine runs the merged one.)

No GPL/copyleft code is present in these files.
