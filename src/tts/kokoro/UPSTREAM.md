# Vendored upstream: Kokoro-82M web engine

Read IT vendors the `kokoro-js` engine instead of depending on the npm package,
because that package still imports `phonemizer` (which embeds GPL-3.0 espeak-ng).
Vendoring lets us replace the phonemiser while keeping the model inference code.

- **Upstream:** https://github.com/hexgrad/kokoro-js
- **Pinned commit:** `dfb907a02bba8152ca444717ca5d78747ccb4bec` (v1.2.1)
- **Upstream licence:** Apache-2.0 (`upstream/LICENSE`; the same text is at the repo root as `LICENSE`)
- **Files:** `kokoro.ts`, `splitter.ts`, `voices.ts`, `phonemize.ts` (copied verbatim except for the change below). The raw upstream JS files were removed once the patched vendored copies were in place.

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

2. `g2p/` is written by Read IT. It uses CMUdict (public domain), NRL Report 7948
   (US Government work, public domain) and the Kokoro tokenizer vocabulary.
   The phoneme table is filtered to that vocabulary so no unknown token reaches
   the model.

No GPL/copyleft code is present in these files.
