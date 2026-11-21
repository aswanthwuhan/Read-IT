# Third-party licences

Every component this app ships, with its exact terms.

**This file is generated and enforced.** `.github/workflows/licence.yml` enumerates the
dependency tree and the runtime model manifest, fails the build if any copyleft
component appears, and rewrites this file. If a row is wrong, the manifest is wrong —
fix the manifest, not the row.

Columns:

* **Where** — `bundled` means the code or data ships inside the app binary; `runtime`
  means it is downloaded on the user's device after install and is not part of the
  distributed binary.
* **Attribution** — whether the licence requires the notice to be shown to end users.
  Required notices appear in the app's About screen, not only here.

---

## Code bundled in the app

| Component | Version | Licence | Where | Attribution |
|---|---|---|---|---|
| Read IT (this project) | 0.6.1 | Apache-2.0 | bundled | — |
| `kokoro.js` (vendored, patched, `src/tts/kokoro/`) | 1.2.1 | Apache-2.0 | bundled | NOTICE + About |
| `sherpa-onnx` (Android AAR) | 2.0.1+ | Apache-2.0 | bundled (Android) | NOTICE + About |
| `@huggingface/transformers` | 3.8.1 | Apache-2.0 | bundled | NOTICE |
| `onnxruntime-web` | (via transformers) | MIT | bundled | NOTICE |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 | bundled | NOTICE |
| `epubjs` | 0.3.93 | BSD-2-Clause | bundled | NOTICE |
| `mammoth` | 1.13.0 | BSD-2-Clause | bundled | NOTICE |
| `@mozilla/readability` | 0.6.0 | Apache-2.0 | bundled | NOTICE |
| `dexie` | 4.4.7 | Apache-2.0 | bundled | NOTICE |
| `dexie-react-hooks` | 4.4.0 | Apache-2.0 | bundled | NOTICE |
| `fflate` | 0.8.3 | MIT | bundled | NOTICE |
| `pocket-tts-js` | 0.1.0 | MIT | bundled | NOTICE |
| `react`, `react-dom` | 19.3.1 | MIT | bundled | NOTICE |
| `react-router-dom` | 7.18.5 | MIT | bundled | NOTICE |
| `@capacitor/*` | 8.x | MIT | bundled | NOTICE |
| `@capacitor-community/text-to-speech` | 8.0.2 | MIT | bundled | NOTICE |
| `@capacitor/filesystem` | 8.1.5 | MIT | bundled | NOTICE |
| `@tauri-apps/*` | 2.12.4 | MIT / Apache-2.0 | bundled (Windows) | NOTICE |

## Generated dependency inventory

<!-- BEGIN GENERATED: dependencies -->

<!-- Written by scripts/check-licences.mjs. Do not edit by hand. -->

| Package | Version | Licence |
|---|---|---|
| `pako` | 1.0.11 | (MIT AND Zlib) |
| `type-fest` | 0.13.1 | (MIT OR CC0-1.0) |
| `jszip` | 3.10.2 | (MIT OR GPL-3.0-or-later) |
| `tslib` | 2.9.1 | 0BSD |
| `@huggingface/transformers` | 3.8.1 | Apache-2.0 |
| `@mozilla/readability` | 0.6.0 | Apache-2.0 |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `dexie` | 4.4.7 | Apache-2.0 |
| `dexie-react-hooks` | 4.4.0 | Apache-2.0 |
| `flatbuffers` | 25.9.23 | Apache-2.0 |
| `localforage` | 1.10.0 | Apache-2.0 |
| `long` | 5.3.2 | Apache-2.0 |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 |
| `sharp` | 0.34.5 | Apache-2.0 |
| `duck` | 0.1.12 | BSD |
| `dingbat-to-unicode` | 1.0.2 | BSD-2-Clause |
| `epubjs` | 0.3.93 | BSD-2-Clause |
| `lop` | 0.4.2 | BSD-2-Clause |
| `mammoth` | 1.13.0 | BSD-2-Clause |
| `option` | 0.2.4 | BSD-2-Clause |
| `@protobufjs/aspromise` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/base64` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/codegen` | 2.0.5 | BSD-3-Clause |
| `@protobufjs/eventemitter` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/fetch` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/float` | 1.0.2 | BSD-3-Clause |
| `@protobufjs/path` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/pool` | 1.1.0 | BSD-3-Clause |
| `@protobufjs/utf8` | 1.1.2 | BSD-3-Clause |
| `global-agent` | 3.0.0 | BSD-3-Clause |
| `protobufjs` | 7.6.6 | BSD-3-Clause |
| `roarr` | 2.15.4 | BSD-3-Clause |
| `sprintf-js` | 1.0.3, 1.1.3 | BSD-3-Clause |
| `chownr` | 3.0.0 | BlueOak-1.0.0 |
| `minipass` | 7.1.3 | BlueOak-1.0.0 |
| `tar` | 7.5.22 | BlueOak-1.0.0 |
| `yallist` | 5.0.0 | BlueOak-1.0.0 |
| `@capacitor/synapse` | 1.0.4 | ISC |
| `@isaacs/fs-minipass` | 4.0.1 | ISC |
| `d` | 1.0.2 | ISC |
| `es5-ext` | 0.10.64 | ISC |
| `es6-symbol` | 3.1.4 | ISC |
| `esniff` | 2.0.1 | ISC |
| `event-emitter` | 0.3.7 | ISC |
| `ext` | 1.7.0 | ISC |
| `guid-typescript` | 1.0.9 | ISC |
| `inherits` | 2.0.4 | ISC |
| `json-stringify-safe` | 5.0.1 | ISC |
| `next-tick` | 1.1.0 | ISC |
| `semver` | 7.8.6 | ISC |
| `type` | 2.7.3 | ISC |
| `@capacitor-community/text-to-speech` | 8.0.2 | MIT |
| `@capacitor/android` | 8.6.0 | MIT |
| `@capacitor/core` | 8.6.0 | MIT |
| `@capacitor/filesystem` | 8.1.5 | MIT |
| `@huggingface/jinja` | 0.5.11 | MIT |
| `@img/colour` | 1.1.0 | MIT |
| `@types/localforage` | 0.0.34 | MIT |
| `@types/node` | 26.6.6 | MIT |
| `@xmldom/xmldom` | 0.7.13, 0.8.15 | MIT |
| `argparse` | 1.0.10 | MIT |
| `base64-js` | 1.5.1 | MIT |
| `boolean` | 3.2.0 | MIT |
| `chardet` | 2.2.0 | MIT |
| `compromise` | 14.19.0 | MIT |
| `cookie` | 1.1.1 | MIT |
| `core-js` | 3.51.0 | MIT |
| `core-util-is` | 1.0.3 | MIT |
| `define-data-property` | 1.1.4 | MIT |
| `define-properties` | 1.2.1 | MIT |
| `detect-node` | 2.1.0 | MIT |
| `efrt` | 2.9.0 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es6-error` | 4.1.1 | MIT |
| `es6-iterator` | 2.0.3 | MIT |
| `escape-string-regexp` | 4.0.0 | MIT |
| `fflate` | 0.8.3 | MIT |
| `globalthis` | 1.0.4 | MIT |
| `gopd` | 1.2.0 | MIT |
| `has-property-descriptors` | 1.0.2 | MIT |
| `immediate` | 3.0.6 | MIT |
| `isarray` | 1.0.0 | MIT |
| `lie` | 3.1.1, 3.3.0 | MIT |
| `lodash` | 4.18.1 | MIT |
| `marks-pane` | 1.0.9 | MIT |
| `matcher` | 3.0.0 | MIT |
| `minizlib` | 3.1.0 | MIT |
| `object-keys` | 1.1.1 | MIT |
| `onnxruntime-common` | 1.21.0, 1.22.0-dev.20250409-89f8206ba4 | MIT |
| `onnxruntime-node` | 1.21.0 | MIT |
| `onnxruntime-web` | 1.22.0-dev.20250409-89f8206ba4 | MIT |
| `path-webpack` | 0.0.3 | MIT |
| `platform` | 1.3.6 | MIT |
| `pocket-tts-js` | 0.1.0 | MIT |
| `process-nextick-args` | 2.0.1 | MIT |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `react-router` | 7.18.5 | MIT |
| `react-router-dom` | 7.18.5 | MIT |
| `readable-stream` | 2.3.8 | MIT |
| `safe-buffer` | 5.1.2 | MIT |
| `scheduler` | 0.28.0 | MIT |
| `semver-compare` | 1.0.0 | MIT |
| `serialize-error` | 7.0.1 | MIT |
| `set-cookie-parser` | 2.7.3 | MIT |
| `setimmediate` | 1.0.5 | MIT |
| `string_decoder` | 1.1.1 | MIT |
| `suffix-thumb` | 6.0.0 | MIT |
| `underscore` | 1.13.8 | MIT |
| `undici-types` | 8.9.0 | MIT |
| `util-deprecate` | 1.0.2 | MIT |
| `xmlbuilder` | 10.1.1 | MIT |

<!-- END GENERATED: dependencies -->

## Data bundled in the app

| Component | Licence | Where | Attribution |
|---|---|---|---|
| Literata (web font, Latin subset) | SIL OFL 1.1 | bundled | `public/fonts/OFL.txt` + About |
| CMU Pronouncing Dictionary (merged with misaki data) | free for any use / Apache-2.0 | bundled as `public/lexicon/lexicon-en-us.txt` | NOTICE |
| Misaki English gold dictionary (`us_gold.json`) | Apache-2.0 | bundled in `public/lexicon/` | NOTICE + `src/tts/kokoro/g2p/assets/LICENSE.txt` |
| OpenReader English letter-to-sound rules (`en-us.tsv`) | MIT | bundled in `public/lexicon/` | NOTICE + `src/tts/kokoro/g2p/assets/LICENSE.txt` |
| NRL Report 7948 letter-to-sound rules | public domain | first-party fallback speller in `src/tts/kokoro/g2p/index.ts` | About |

## Downloaded at runtime (not part of the distributed binary)

| Component | Licence | Where | Attribution |
|---|---|---|---|
| Kokoro-82M v1.0 ONNX weights + voices | Apache-2.0 | runtime | About |
| Pocket TTS model weights | CC-BY-4.0 | runtime | About (required) |
| Pocket TTS voice references (VCTK-derived) | CC-BY-4.0 | runtime | About (required) |
| Pocket TTS voice references (Unmute donations) | CC0 | runtime | thanks |
| Whisper (word alignment) weights | MIT (code) / model-specific | runtime | About |
| ONNX Runtime wasm binaries | MIT | runtime | NOTICE |

### Pocket TTS voices that must never ship

`cosette` (Expresso, CC-BY-4.0 **NC**) and `jean` (EARS, CC-BY-4.0 **NC**) are
non-commercial. They are excluded from the app, from the model manifest and from the
fallback list. The CI licence job fails if either appears in the manifest.

## Store and service components

| Component | Terms | Where | Notes |
|---|---|---|---|
| Google Mobile Ads SDK + UMP | Google AdSense/AdMob publisher terms | bundled | AdMob account required |
| Apple StoreKit 2 | Apple Developer Program terms | bundled (iOS) | IAP product required |
| Google Play Billing | Play Developer Agreement | bundled (Android) | service account required |

## Prohibited

No component under `GPL-2.0`, `GPL-3.0`, `AGPL-3.0`, `SSPL-1.0` or a source-available
licence (`BUSL`, `Elastic`, `Fair`) may appear in the dependency tree, in the prebuilt
Android archive, or in the runtime model manifest. This is enforced in CI.

The historical exception was `espeak-ng` (GPL-3.0), reached through
`kokoro-js → phonemizer` and through the `sherpa-onnx` AAR. Both were removed:

* `sherpa-onnx` v2.0.0 removed espeak-ng and piper-phonemize from its build
  (upstream PR #4055). The Android archive must be **2.0.1 or newer**.
* `kokoro-js` has no espeak-free release, so the vendored copy in
  `packages/kokoro-js/` has the phonemiser replaced with Read IT's own
  grapheme-to-phoneme engine.
