# Read IT — improvement roadmap (external research)

Status: research complete. This file consolidates findings from parallel
research workers. Every proposal is checked against the licence policy below
before it can be scheduled.

## Shipped so far

| Commit | Change |
|---|---|
| `759cade` | code listings skipped when reading aloud, with a Code switch |
| `6441c0a` | text-encoding detection for `.txt`/`.fb2` (cp1251, Shift-JIS) |
| `b80e336` | EPUB 3 footnote asides preserved; tag names compared case-insensitively |
| `9831f30` | Android share provider narrowed; WebView file/content access off |
| `ddeca78` | EPUB font de-obfuscation module; nav/NCX outline parser |

In flight: speech normaliser wiring into `speakPlan`, content-store split of
`BookRecord`, and the four normaliser defects found by probing real prose.

## Licence policy (hard)

Read IT ships as Apache-2.0 and is sold commercially, so the product must stay
free of copyleft code and non-commercial data.

Allowed: Apache-2.0, MIT, BSD-2/3, ISC, CC0, OFL (fonts), public domain.
Never ship: GPL, AGPL, LGPL, MPL, SSPL, BUSL, CC-BY-NC, proprietary SDKs whose
terms forbid paid distribution.
Model weights: check separately from code; no Llama/Gemma/NLLB (CC-BY-NC) or
other use-restricted weights in the paid build (a user-supplied download is a
separate decision).
Patents/trademarks: avoid Bionic Reading, Beeline, Spritz/RSVP, Irlen naming.

## Research streams

| Stream | Owner | Scope | State |
|---|---|---|---|
| A | ebook readers | rendering, library, annotations, perf, a11y | done |
| B | TTS engines | speed, streaming, voices, model licences | done |
| C | parsing/OCR | scanned PDF, tables, reading order | done |
| D | accessibility/UX | dyslexia, focus, karaoke, dictionary | done |
| E | sync/storage | OPDS, self-host, E2EE, conflicts | done |
| F | AI features | local models, summaries, translation | done |
| G | QA/perf | corpora, visual/a11y CI, benchmarks | done |
| H | business/legal | billing, signing, privacy, attribution | done |
| I | standards/a11y | EPUB 3, Media Overlays, DAISY, EAA | done |
| J | export/interop | annotations, M4B, Obsidian/Readwise, OPDS | done |
| K | platform shell | background audio, MediaSession, SAF, Tauri | done |
| L | i18n/typography | RTL, CJK, hyphenation, fonts, line breaking | done |
| M | search/retrieval | indexes, FTS, ranking, highlighting | done |
| N | import formats | MOBI/FB2/DOCX/CBZ, conversion, robustness | done |
| O | storage/perf | IndexedDB quota, SQLite, migrations, audio cache | done |
| P | security | sandboxing, CSP, parsers, supply chain | done |
| Q | market | pricing, tiering, positioning, buyers | done |
| U | TTS front-end | numbers, units, abbreviations, URLs, tables | done |
| V | audio quality | loudness, seams, time-stretch, resampling | done |
| W | assistive tech | screen reader + TTS coexistence, WCAG | done |
| X | navigation | TOC, outlines, footnotes, cross-refs | done |
| Y | images | covers, comic pages, decode perf, alt text | done |
| Z | word sync | timing without timestamps, karaoke accuracy | done |
| AA | onboarding | first run, settings complexity, defaults | done |
| AB | web perf | cold start, bundle, ORT/WASM, service worker | done |

## Stream A — open-source ebook readers (reported)

| Source | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| Readium CSS (`docs/CSS12-user_prefs.md`) | BSD-3 | preference model as CSS vars: `colCount`, `lineLength`, `paraIndent`, `hyphens`, `wordSpacing`, `letterSpacing`, `a11yNormalize`, `darkenFilter`, `no-ruby`, paged↔scroll | H | S | copy OK |
| Thorium `annotation/converter.ts` | BSD-3 | annotation target = selector *stack* (epubcfi + cssSelector + textQuote + progression), resolve by first match | H | M | copy OK |
| Thorium `noteExport/`, `htmlTemplate.ts` | BSD-3 | annotated HTML/Markdown note export + annotation-set JSON | M | S | copy OK |
| Thorium `pdf-annotations/SPEC.md` | BSD-3 | PDF highlight `{page, rects[], quote}` in normalised PDF space, re-aligned on zoom/rotate | H | M | copy OK |
| epub.js `locations.js` | BSD-2 | ~1 KB-char CFI checkpoints → stable page count/%/seek/sync key | H | S | copy OK |
| foliate-js `paginator.js` | MIT | single iframe, N-column strip paged by `transform` — no re-layout per page | H | M | copy OK |
| KOReader `statistics.koplugin` | AGPL-3 | per-page duration rows rescaled when page count changes | H | S | reimplement |
| KOReader `util.lua` partialMD5 + `kosync` | AGPL-3 | book identity from sampled MD5; 25 s debounce LWW progress | H | S | reimplement |
| KOReader `koptoptions.lua` | AGPL-3 | PDF crop (auto/semi/manual), page↔continuous, rotation presets | M | M | reimplement |
| Komga `read-progress` | MIT | `completed` auto-set on last page; read lists vs collections | M | S | copy OK |
| Foliate `export.js` | GPL-3 | per-highlight chapter title in exports; named colours | M | S | reimplement |
| Kavita / calibre | GPL-3 | virtual pages, saved-filter shelves, series index sort | M | M | reimplement |
| Librera | **none** | competitor only | L | — | do not copy |
| pdf.js text layer | Apache-2.0 | selection rects from `getTextContent` + viewport transform | H | S | copy OK |

Top 5: multi-selector annotation targets; precomputed locations table;
Readium CSS preference layer (copy stylesheets); KOReader-style rescaled
reading stats; PDF highlight geometry + text layer + crop/continuous modes.

## Stream B — TTS engines (reported)

| Project | Code / weights | Size · stream · quality | Idea | Imp | Effort | Risk |
|---|---|---|---|---|---|---|
| Kitten TTS | Apache-2.0 / Apache-2.0 | 4–80 MB, sentence chunks, clear/flat | bundled zero-download fallback, low-RAM mode | H | M | low (Kitten-2 1.7B = bespoke licence, avoid) |
| Piper | MIT (archived) / GPL-3 successor; espeak-ng GPL embedded | 20–110 MB, sentence chunks | 30+ language voice packs | H | M | med — hfc_female/ryan CC-BY-NC-SA, lessac Blizzard research licence |
| Supertonic 3 | MIT / **OpenRAIL** | 99 M, 31 langs, batch | one multilingual model | H | M | high — OpenRAIL not allowlisted; `supertonic-android` GPL-3 |
| Pocket TTS | MIT / CC-BY-4.0 | 100 M, true stream ~200 ms first chunk | lowest-latency voice, 1.9 M tiny tier | H | M | low (cloning consent UX) |
| Kokoro-82M | Apache-2.0 / Apache-2.0 | 377 MB fp32 / ~88 MB int8, no native stream | keep as quality default | M | S | none |
| sherpa-onnx | Apache-2.0 | runtime, chunk callback | expose real streaming | H | L | none |
| Marmalade | MIT app / **GPL-3 engine CDN** | emotion prosody | reimplement pacing presets | M | S | med |
| Orpheus | Apache-2.0 / Llama-3B | 3 B | skip on phones | L | — | high |
| Chatterbox Nano | MIT / MIT | 110 M, ~3× RTF on 8 cores | cloning option, watermark must stay | M | L | med |
| Matcha + Vocos | MIT / Apache-2.0 | 18 M + 13 M | cheap fast voice | M | M | low |
| MeloTTS / VITS | MIT | 200 MB / 20–80 MB | skip / fallback | L | M | low |
| eSpeak-NG | GPL-3 | robotic | never ship | — | — | blocked |

Top 5: bundled Kitten-int8 fallback (~25 MB) so first speech needs no download;
WSOLA time-stretch so speed changes reuse cached audio; real streaming via
sherpa chunk callback into AudioTrack; Piper voice packs behind a per-voice
licence allowlist; Supertonic-3 multilingual as an explicit user download.
Avoid: Orpheus, Kitten-2 1.7B, ZipVoice, Blizzard/NC Piper voices.

## Stream I — EPUB 3 / standards / accessibility conformance (reported)

State found in code: `src/import/epub.ts` walks the spine and uses `navigation.toc`
for titles only; `src/import/html.ts` flattens DOM to `BlockSeed` and **drops
element ids, `<aside>` and `<svg>`**; `Sentence.cfi` exists but is never
populated; `PdfView.tsx` is `role="img"` labelled "Page N of M". So EPUB 3
footnotes, page-lists, landmarks, fixed layout, obfuscated fonts and Media
Overlays are all currently unsupported.

| Spec / project | Code licence | Spec free to implement | Ship in paid app | Gap |
|---|---|---|---|---|
| EPUB 3.3 (W3C Rec, Jan 2026) | — | yes (RF patents) | yes | nav, `epub:type`, properties, fixed layout |
| EPUB Reading Systems 3.3 | — | yes | yes | §7 nav MUST/SHOULD, MathML input, §9 overlays SHOULD, §12 EPUB 2 |
| EPUB Accessibility 1.1 + Techniques | — | yes | yes | `accessMode*`, `accessibilityFeature`, `dcterms:conformsTo` |
| EPUB 3 Media Overlays (SMIL subset) | — | yes | yes | publisher narration synced to text |
| TTS Enhancements 1.0 + PLS 1.0 | — | yes | yes | `ssml:ph`, PLS lexicons → existing lexicon |
| Font de-obfuscation (3.3 §4.4.3–4.4.4) | — | yes, normative, no patent | yes | SHA-1(identifier) XOR first 1040 bytes |
| EAA 2019/882 + EN 301 549 | — | free to read | duty | in scope since 28 Jun 2025 |
| DAISY 2.02 / Z39.86-2005 | — | **§1.6 RAND, noncommercial reproduction** | format yes, spec text no | legacy DTB import |
| epubcheck 5.4.0 | BSD-3 | — | CI only | catch import assumptions |
| Ace by DAISY | MIT, bundles axe-core **MPL-2.0** | — | CI only | corpus audit |
| w3c/epub-tests | W3C Software & Document Licence | yes | yes | RS conformance suite |
| foliate-js | MIT | — | reference | `epubcfi.js`, fixed layout, deobfuscator |

Top 5: preserve anchors + parse nav/page-list/landmarks (`BlockSeed.anchor`,
`src/import/epub/nav.ts`); Media Overlays playback (`src/import/epub/overlays.ts`
→ existing `PlayerBar`); font de-obfuscation (~30 lines with `crypto.subtle`);
accessibility metadata + a real PDF text layer so TalkBack reads sentences
instead of "Page 3 of 210"; stop discarding footnote/MathML/SVG semantics in
`src/import/html.ts`.

## Stream Y — images / covers / illustrated content (reported)

No cover support exists today (no `cover` field on `BookRecord`; the library renders
text rows). `PdfView.tsx` already does fit/zoom/pinch/DPR-capped canvas correctly.

| Source | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| epub.js `findCoverPath()` | BSD-2, existing dep | EPUB3 `cover-image` → EPUB2 `<meta name="cover">` → guide → first-spine-image | H | S | none |
| `fflate` + `DecompressionStream` | MIT | index the central directory once, `blob.slice` per page — constant memory | H | M | none |
| `libarchive.js` | MIT wrapper / BSD-2 wasm | CB7 and CBR random access without unrar code | H | M | audit wasm |
| 7z-wasm | **LGPL-2.1** | — | — | — | reject |
| node-unrar-js | wrapper MIT, unRAR restriction | — | — | — | avoid |
| Komga web reader | MIT | fit-width/page/actual, RTL, spread pairing with standalone cover, webtoon mode | M | S | none |
| Foliate `contents.js` | **GPL-3** | transform-based zoom, page+fraction position | M | M | reimplement |
| pdf.js `getStructTree`, `AnnotationMode` | Apache-2.0 | harvest `/Alt`; render comics with annotations disabled | H | S | none |
| `@jsquash/resize` / `webp` | Apache-2.0 | wasm thumbnails in a worker | M | M | none |
| `comlink` | Apache-2.0 | worker RPC for decode batches | L | S | none |
| `sharp` | Apache-2.0 code, libvips **LGPL** | build-time only, never ship | L | — | flag |

Numbers: a 4000×6000 scan decodes to **91.6 MiB** RGBA (never cache 300 of them);
a fit-width page on a 1080 px phone is ~7.0 MB, so a 5-page window is ~35 MB — that
is the cap. A letter PDF at ratio 2 is a 24.2 MB canvas vs 6.1 MB at ratio 1, so
cache at most 3 rendered pages. AVIF needs a feature detect (WebView 85+,
WebView2 121+, disabled 114–120). Animated GIF only animates in `<img>`. CMYK
JPEGs decode but the Adobe profile is often ignored → warn, don't fail.

Top 5: cover chain + 320×480 WebP thumbnail + dominant colour (`src/import/covers.ts`);
CBZ import with constant memory (`src/import/cbz.ts`); `ComicView` cloned from
`PdfView` with a 5-page window; PDF `AnnotationMode.DISABLE` + `/Alt` harvesting;
alt text and `role="presentation"` decorative marking through to TTS.

## Stream U — text normalisation for speech (reported)

The pipeline is `blocks.ts` → `segment.ts` → `reader/spoken.ts` (`speakPlan`, with
`charMap`) → `player.ts` (`item.spoken ?? item.text`) → engine. Misaki's G2P already
does per-token numbers, bare 4-digit years, `$`/`£`/`€` and a 25-entry unit table —
that is a *phonemiser's* level of TN, not a front-end's.

| Input | Should say | Today |
|---|---|---|
| `1000` | one thousand | "ten hundred" |
| `911` | nine one one (call) / nine eleven (date) | "nine hundred eleven" |
| `1990-95`, `pp. 10–20`, `1st–4th` | nineteen ninety to ninety-five / pages ten to twenty / first to fourth | slash or skipped |
| `1/2`, `3¼`, `5+1/2` | one half / three and a quarter / five and a half | "one slash two" |
| `3:1`, `2x4` | three to one / two by four | colon, "x" |
| `€1.2bn`, `£1.2m` | one point two billion euros / one point two million pounds | **loses magnitude and currency** |
| `100°C`, `10 kg/m²` | one hundred degrees Celsius / ten kilograms per square meter | degree lost / "slash" |
| `2024-05-03`, `3/5/24` | May third, twenty twenty-four | unavailable |
| `Q3`, `FY2024`, `1H23` | third quarter / fiscal year … / first half of … | unavailable |
| `e.g.`, `vs.`, `approx.`, `w/` | for example / versus / approximately / with | letter or dropped |
| `Ch. 4`, `p. 12`, `Eq. 4`, `Sec. 3` | chapter four / page twelve / equation four / section three | partially |
| `St. Mary`, `Oxford St.` | Saint Mary / Oxford Street | "Mary" |
| `Chapter IV`, `Henry VIII`, `World War II` | chapter four / Henry the eighth / World War Two | **"H V I I I"** |
| `x^2`, `3 + 4 = 7`, `√2` | x squared / three plus four equals seven / the square root of two | unavailable |
| `v2.1.0`, `192.168.0.1`, ISBN | version two point one point zero / digit groups | unavailable |
| `word¹²`, `mc²` | word (marker skipped) / m c squared | superscript read literally |
| `exam-\nple` | example | "exam- ple" |

Policies that cannot be a lookup: slash (number/number = fraction, unit/unit = "per",
word/word = "or", else "slash"); acronym (dotted → letters, no vowel → letters,
otherwise word, with ~100 exceptions); roman (after a person → ordinal with "the",
after Chapter/Part/Act → cardinal); `St.`/`Dr.` by next-token case and position.
**Over-normalisation is worse than under-normalisation** — leave ambiguous local
context as written. Structure: do not announce brackets/dashes, skip superscript
footnote markers, default-skip tables/captions/footnotes/references — and `code`,
which is currently read aloud (`reading.ts` `OPTIONAL` has no `code`).

| Project | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| NeMo text processing + `data/*.tsv` | Apache-2.0 | semiotic taxonomy, year/decade/quarter rules, unit/currency/roman tables | H | M | none (keep NOTICE) |
| MaryTTS `Preprocess` | **LGPL-3.0** | ordering + checklist, `abbrev.dat` concept | H | S | reimplement only |
| Misaki `en.py` | Apache-2.0 | extend existing year/ordinal path, share formatter | H | S | none |
| num2words | **LGPL-2.1+** | phrasing reference | M | — | never ship |
| espeak-ng / Piper | **GPL-3.0** | number/date ideas | M | — | avoid |
| Google/Polly `say-as` | docs | `interpret-as` contract, `detail=2` dates, fraction syntax, UK phone grouping | H | S | none |
| `compromise` | MIT | POS context for `St.`, acronyms | M | S | already a dep |
| ICU `Intl` | Unicode-3.0 | currency display names, plurals; no JS spellout | M | S | none |
| `unidecode` | **GPL-2.0** | — | L | — | avoid |

Architecture: new pure `src/tts/normalize/` (`index.ts` returning `{text, map}`,
`numbers.ts`, `dates.ts`, `units.ts`, `abbrev.ts`, `fractions.ts`, `roman.ts`,
`symbols.ts`, `fixtures.ts`), importing `NumberToWords` rather than forking it.
Call it **once** in `speakPlan` after citation/bracket edits — that is the only place
that already builds `charMap`, and `player.ts` speaks `item.spoken ?? item.text` for
every engine. Do **not** normalise inside `phonemizeWithLexicon`/`tokensFor`:
`wordTokenCounts` requires counts to match words, and internal expansion desyncs
`splitForModelByTokens` (which then silently falls back to the character splitter).
Fix de-hyphenation at import, where the newline still exists.

Top 5: dates/times/ranges; abbreviations and reference apparatus (a 60-entry table
fixes every page of a scholarly book); money/units/percent/degrees; fractions,
ratios, dimensions, versions; roman numerals, superscripts, formula tokens — plus
adding `code` to the default skips. Fixtures are listed in the stream report
(`src/tts/normalize/fixtures.ts`), with invariants: idempotent, `charMap.length ===
text.length`, every expansion maps inside its source span, and `wordTokenCounts`
still matches the player's text.

## Stream AB — web performance / cold start (reported)

Measured baseline in this repo: entry `index-*.js` **911 KB raw / 327 KB gz**, CSS
14 KB gz; already split: pdfWorker 383 KB gz, epub 102, docx 93, kokoro.worker 357.
`public/ort/…jsep.wasm` 21 MB, lexicon 10.9 MB, models: Kokoro web 320 MB, Pocket
180 MB, PP-DocLayout int8 32 MB.

| Source | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| web.dev performance budgets | CC-BY prose | TTI < 5 s on slow 3G Moto G4, < 3 s slow 4G, LCP < 2.5 s, critical path ~170 KB gz | H | S | none |
| Vite 8 build guide | MIT | route chunks via `import()`, handle `vite:preloadError`; default target already Baseline (our `safari15.4` pin buys nothing) | H | S | none |
| Rolldown code splitting | MIT | `build.rolldownOptions.output.codeSplitting.groups` (manualChunks is legacy in Vite 8) | H | S | none |
| vite-plugin-pwa | **MIT** | `autoUpdate` ⇒ `skipWaiting + clientsClaim` — exactly the old/new chunk mix the app patches around; oversized precache fails the build since 0.20.2 | H | S | none |
| Workbox 7 | MIT | `cleanupOutdatedCaches`, `navigateFallback`, CacheFirst for `/ort/` and `/lexicon/`; never precache models | H | S | none |
| onnxruntime-web 1.31 | **MIT** | `jsep.wasm` 28.15 MB vs `simd-threaded.wasm` 14.16 MB; `ort.env.wasm.wasmPaths`; conditional import | H | M | none |
| Chromium wasm compile data | public | 19.12 MB compiles in 504 ms (Nokia 1), 133 ms (Pixel 2), 75 ms (Pixel 7); 60 MB OOMs on Nokia 1 | H | S | none |
| caniuse WebGPU | CC | Android 121+/12+, adapter often null — detect via `requestAdapter()`, not `'gpu' in navigator` | M | S | none |
| Android WebView docs | Apache-2.0 | `onRenderProcessGone` is mandatory or the app dies; `setRendererPriorityPolicy`; `onTrimMemory`; `startUpWebView()` | H | M | none |
| Android splash API | Apache-2.0 | system splash, dismiss on first stable frame | M | S | none |
| `scheduler.postTask` / `content-visibility` | MDN | postTask has no Safari; `requestIdleCallback` has no Safari (existing fallback is right) | M | S | none |
| Tauri 2 vs Electron (2026) | MIT/Apache | installer 1.05 MB vs 106 MB, but first frame 435 vs 392 ms — win is disk, not startup | M | S | none |
| transformers.js tutorial | Apache-2.0 | **anti-pattern for us**: warming the model at mount is only correct when ML is the product | M | S | none |
| rollup-plugin-visualizer, size-limit, @lhci/cli, web-vitals | MIT/Apache | CI budget gates (Lighthouse 12 dropped `budget.json`) | M | S | none |

Top 5: cut the shell from 327 KB gz to ≤180 KB by lazy-loading the three routes and
splitting react/dexie/app (effort S); switch PWA `registerType` to `'prompt'` with a
deferred reload while reading; load the TTS stack only on first Play, with a visible
"preparing voice" state; ship the 14.16 MB `simd-threaded.wasm` by default and keep
`.jsep` only behind a real `requestAdapter()`; add a memory-pressure guard
(`src/core/memory.ts`, `onTrimMemory`, `onRenderProcessGone`).

## Stream Z — word-level sync / karaoke (reported)

No engine in the stack exposes word times, but Read IT already holds the two inputs
that make timing derivable: per-word phoneme counts (`wordTokenCounts()`,
`g2p/index.ts:257`) and a timestamped ASR option
(`onnx-community/whisper-tiny.en_timestamped`, 42 MB).

| Project | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| sherpa-onnx `offline-tts.h` | Apache-2.0 | callback `(samples,n,progress)` — progress is sentences, not time; `phoneme_codepoints` injects tokens | M | S | none |
| Kokoro impl | Apache-2.0 | single `Run(...)` audio output — no durations in the graph | — | — | none |
| Kokoro / kokoro-js / Misaki | Apache-2.0 | phonemes per word already known → duration weights | H | S | none |
| Piper | MIT code, **espeak-ng GPL-3** | phoneme durations not exported | L | M | GPL if linked |
| Android `onRangeStart` | platform API 26 | exact audio frames via `synthesizeToFile`, no TalkBack contention | H | M | none |
| Web `SpeechSynthesis` boundary | platform | word starts only, engine-dependent; `charIndex` can hit whitespace; `charLength` 0 when unknown | M | S | none |
| aeneas | **AGPL-3.0** | — | — | — | avoid |
| whisperX default aligner | BSD code / **MMS_FA CC-BY-NC** | do not ship the aligner | — | — | high |
| stable-ts | MIT | DTW over cross-attention — already done in `align/align.ts` | — | — | none |
| wav2vec2-960h CTC | Apache-2.0 | forced alignment, ~95 MB second model | M | L | none |
| EPUB media overlays | W3C | SMIL `par` + `clipBegin/clipEnd` — clean, but almost no books carry them | M | S | none |
| US10699072B2 | patent to 2037 | active-word + inactive-line dimming | — | — | **avoid dimming** |
| ITU-R BT.1359-1 | standard | detectability +45/−125 ms → bias early, never >45 ms late | H | S | none |
| Gerbier 2015 | paper | synchronous highlight 28% vs 17% recall — sync is load-bearing | H | — | none |

Accuracy ladder: char-proportional drifts to ±300–450 ms by mid-sentence; phoneme
weights roughly halve it; phoneme + pause snapping ≈ ±120 ms; calibrated ±80 ms;
ASR timestamps ±50–100 ms; model-exposed durations ±20 ms. Since late is worse than
early (45 vs 125 ms), add a 60–80 ms lead.

Top 5: phoneme-count weights replacing `spokenLengths()` char counts
(`player.ts:457` → `align/text.ts` weights) — a dozen lines, no model; pause-aware
snapping from frame energy (`src/tts/align/vad.ts`) — no model; persist `timings`
on `AudioCacheRecord` during prerender (~0.5 KB/sentence, no Dexie bump); exact
word clock with one armed timer instead of a 66 ms poll (`player.ts:495`) plus
`leadMs` 70; `onRangeStart` via `synthesizeToFile` for the free-tier system voice.

Guardrails: keep sentence wash + stronger word mark; never dim inactive text; choose
granularity by confidence — word-level only when timings are ASR/calibrated,
3–4-word groups when it is a bare estimate; the highlight must stay decorative (no
`aria-live`) or screen readers will read every word twice.

## Stream AA — onboarding & settings complexity (reported)

The risk is not structure — Read IT already has grouped `Disclosure` rows, a section
TOC and a focus-trapped tour — it is **sequencing**: the first minutes go to setup
instead of reading.

| Pattern | Evidence | Fit | Effort |
|---|---|---|---|
| Progressive disclosure | NN/g; Android settings ≤10–15 items/screen | already done; missing search/reset | S |
| Auto-opening multi-step tour | NN/g n=70: 91% vs 94% success, no time gain, felt *harder* (SEQ 4.92 vs 5.49) | `App.tsx:93` auto-opens a 20-step tour (9 steps with no book) — highest-risk line in the app | S |
| Empty state: status + one action | NN/g | `LibraryPage.tsx:771-803` has 3 steps *and* 2 CTAs, and steers a new user into a 300 MB download | S |
| Starter/sample content | Material blank-slate guidance | no sample book ships, so "open a book" cannot happen first | M |
| Defer large downloads | Android metered-network guidance | already correct, but in the wrong place in the funnel | S |
| Searchable settings | Android/iOS/macOS guidelines | 9 anchor rows, no filter | S |
| Reset to recommended | Android guidelines | no reset anywhere | S |
| Per-book vs global type | KOReader long-press pattern (praised) | global only today | M |
| Option count | Iyengar & Lepper 2000; Scheibehenne 2010 meta (effect ≈0 except when preferences unclear and effort high — i.e. first run) | argues for Basic/Advanced, not fewer features | S |
| Reading defaults | Dyson & Haselgrove 2001 (55 cpl), ≤70 cpl, ≥16 px, 4.5:1, ~1.5 line height | already 18 px / 1.7 / 66 ch — evidence-aligned, don't add knobs | — |
| Error copy | NN/g; WCAG 3.3.3 | `LayoutOverlay.tsx:128` already good — extend to DRM/no-text/download-fail | S |

Top 5: make the tour opt-in (delete the auto-open, keep it in Settings → About);
rebuild the empty state around one action plus a bundled public-domain sample book,
moving the voice download to the first Play press; reading-style presets in the Aa
sheet (Compact 16/1.5, Standard 18/1.7, Large 22/1.9) with reset; searchable
settings and per-row reset; a feedback sheet with a prefilled issue URL and an
explicit opt-in Umami toggle beside the existing update check.

## Stream X — document navigation & cross-references (reported)

| Source | Licence | Idea | Impact | Effort | Reflow-safe | Risk |
|---|---|---|---|---|---|---|
| epub.js `book.js` | BSD-2, existing dep | `navPath || ncxPath` — nav wins, NCX fallback; `navigation.get('#id')` | H | S | yes | none |
| epub.js `locations.js` | BSD-2 | CFI ↔ % via char-count locations, linear spine only | M | S | yes | none |
| foliate-js `progress.js` | MIT | `TOCProgress` via `range.comparePoint` so fragment TOC entries resolve inside a file; `SectionProgress` weights sections by text size and zeroes `linear="no"` | H | S | yes | none |
| foliate-js `footnotes.js` | MIT | `noteref` detection via `epub:type`/`role` or heuristic (`sup`, superscript style, single child) | H | M | yes | none |
| Readium `Locator.kt` | BSD-3 | one position format: `href` + `locations{...}` + `text{before,highlight,after}` | H | S | yes | none |
| Readium `EpubNavigatorFragment` | BSD-3 | on font-size change re-paginate then `go(locator)`; `tocTitleByHref` | M | M | yes | none |
| Thorium `pdf/webview/toc.ts` | BSD-3 | outline href by **page label**: `pageLabels?.[page] ?? page+1` | H | S | n/a | none |
| pdf.js `catalog.js` / `api.js` | Apache-2.0 | `/PageLabels` `/S /D/R/r/A/a` + `/P` + `/St`; `getOutline`, `getDestination`, `getPageIndex`, `getPageLabels`, `getStructTree` | H | S | n/a | none |
| EPUB 3.3 §7.2/7.4 | W3C | exactly one `toc` nav, optional `page-list`, hrefs must hit a doc/fragment | H | — | — | none |
| KOReader `readerlink.lua` / `credocument.lua` | AGPL-3 | same-page note → popup, remote → jump; xpointer compare for "past this entry" | M | M | yes | reimplement |
| calibre `polish/toc.py` | GPL-3 | heading-scoring TOC detection when none exists | M | M | yes | reimplement |

Top 5: one outline model in `ParsedDoc` (`src/import/outline.ts`) — and it **must**
be added to `readDoc()` in `backup.ts` (~618), which rebuilds `ParsedDoc` field by
field, otherwise the outline silently disappears on restore; anchor entries to block
ids (`BlockSeed.anchor`), not offsets; recurse the PDF outline properly with
`getPageLabels()` for printed numbers; `TocPanel.tsx` with current-section tracking
over outline targets only (not 10k sentence nodes); structure-weighted progress so
the percentage survives a font change. Footnote popups live in `src/reader/` with a
back-stack for jumps.

## Stream V — audio pipeline quality / DSP (reported)

Verified in code: `encodeWav` only clamps (`wav.ts:71`); clause WAVs are concatenated
with zero crossfade and no level match (`wavJoin.ts:107`); every sentence gets a
fresh `el.src` so Chromium tears down and re-primes the decoder (`player.ts:588`);
head/tail silence is measured but never removed (`cache.ts:211`); Pocket speed is a
linear resample → pitch shift (`wav.ts:34`, `playback.ts:45`); the 300 MB cache is
**~109 minutes** of 24 kHz audio; per-sentence base64 WAV is ~1.9 MB per 30 s.

| Project | Licence | Idea | Imp | Eff | Risk |
|---|---|---|---|---|---|
| `signalsmith-stretch` | **MIT** | wasm/AudioWorklet stretch+pitch, 232 KB, best 0.75–1.5× | H | M | none |
| `ebur128-wasm` | Apache-2.0 | reference LUFS/true-peak, ~105 KB | M | S | none |
| `bs1770-loudness` | MIT | compact BS.1770 | M | S | low upkeep |
| Media3 `SonicAudioProcessor` | Apache-2.0 | real WSOLA for a native PCM path | H | M | none |
| Marmalade `KokoroDirectEngine` | MIT app | tempo post-process, not the speed tensor; 3.0× requested ≈ 2.2× delivered | H | — | reimplement |
| `time-stretch` | MIT | phasey on speech, unmaintained | L | S | none |
| **soundtouchjs / SoundTouch C++** | **LGPL-2.1 / MPL-2.0** | — | — | — | **blocker** |
| **Rubber Band** | **GPL-2.0 or commercial** | — | — | — | **blocker** |

Targets: **−18 LUFS integrated, −2 dBTP** for mono speech on a phone, ±1 LU.
Per-sentence clips under 3 s use an ungated K-weighted mean (gating per sentence is
unstable). Joins: 10–15 ms equal-power crossfade, 5 ms edge fade, 150–250 ms between
sentences. Trim to 40 ms pre-roll / 80 ms tail, threshold `max(−45 dBFS, peak−35 dB)`.
No dither — quantise once at −2 dBTP.

Top 5 by audible benefit per hour: loudness normalise + true-peak limit baked into
the cache (`src/tts/dsp/loudness.ts`, `finalize.ts`, cache variant bump); one Web
Audio graph instead of per-clip `<audio src>` (`player.ts` — kills the chop and gives
the word clock an exact timeline); trim + fade every clip (removes ~0.7 s dead air
per sentence); fix Pocket speed with own WSOLA (`src/tts/dsp/wsola.ts`) and drop
`rate` from its cache key; rate-aware gaps and one 48 kHz context so
`decodeAudioData` resamples with sinc. Sixth, not audible but enabling: Opus via
WebCodecs for pre-render only (16× smaller cache).

## Stream W — assistive technology interop (reported)

Two premise corrections: screen-reader detection is unreliable and discouraged
(Windows `SPI_GETSCREENREADER` misses Narrator; Thorium shipped auto-detection
then replaced it with an explicit opt-in in 3.3), and `pdf.js` has **no**
`enableAccessibility` option — accessibility is the text layer plus
`getStructTree()`. The industry answer to doubled speech is **position handoff**,
not silencing an engine (DAISY CR-2025-10-11).

| Source | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| DAISY reading-app-ux-reqs CR-20251011 | CC0 | SR starts from SR position; scroll mode for quick keys; queryable position; sleep timer | H | S | none |
| Thorium docs (`212_whereami`) | BSD-3 / docs CC-BY | "Where am I" announces `page 103 · 14/25 · 32% · H1`; explicit SR toggle | H | S | reimplement |
| WCAG 2.2 + ARIA APG | W3C | `aria-current` on the spoken sentence only; never per-word live regions | H | M | none |
| Chromium a11y design doc | BSD-3 | AX tree cost scales with node count — keep the reading surface small | M | S | none |
| css-aam #24 | CC-BY-SA doc | `content-visibility:auto` nodes can drop out of AT nav — never virtualise reading order | M | S | none |
| Android `AccessibilityManager` | Apache-2.0 | `isTouchExplorationEnabled` as a **hint to offer** a prompt, never forced behaviour | M | S | none |
| Tauri #12901 / #15624 | MIT/Apache | `decorations:false` breaks NVDA; WebView2 loses focus after Alt-Tab | H | S | none |
| pdf.js text layer + struct tree | Apache-2.0 | per-page text layer, tagged structure, honest "this is a scan" state | H | M | none |
| axe-core | **MPL-2.0** | CI only, never bundled | M | S | devDep |
| Pa11y | **LGPL-3.0** | — | — | — | avoid |

Gaps verified in the repo: PDF pages are `<canvas role="img" aria-label="Page N">`
with no text for AT; the reading surface is one `div tabIndex={0}` whose
`aria-label` is ignored on `role=generic`; no `aria-current`, no page-turn
announcement, no PageUp/Arrow paging, only two `:focus-visible` rules, no
`forced-colors` block. PlayerBar is already well done — build on it.

Top 5: explicit screen-reader mode (`src/reader/screenReaderMode.ts`, suppress
word live regions, Play starts at focus); `role="doc-chapter"` + `aria-current`
+ one `role="status"` page announcement; PDF text layer over the canvas with
`getStructTree()`; global focus ring, `forced-colors` support, page keys; Android
`isTouchExplorationEnabled` only to seed the prompt.

## Stream P — security / supply chain (reported)

Key point: Read IT **never renders publisher HTML** — `src/import/html.ts` walks to
text blocks, `epubjs` is only used for `open`/`load`, PDFs go to canvas. The
book-JS/XSS class is already closed, which is stronger than an iframe sandbox.

| Item | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| epub.js docs | BSD-2 | scripted content off by default; add a test that `renderTo` is never called | H | S | none |
| pdf.js CVE-2024-4367 | Apache-2.0 | `isEvalSupported` RCE, fixed 4.2.67; we pin 6.5.438 where the option is gone | H | S | none |
| Android `WebSettings` | Apache-2.0 | explicit file/content/universal-access off, no JS popups; Capacitor already serves `https://localhost` | M | S | none |
| Android manifest/FileProvider | Apache-2.0 | **delete dead broad provider** (`external-path path="."`), `allowBackup="false"` | M | S | loses OS device transfer |
| `fflate` zip limits | MIT | entry-count and total-uncompressed caps before `book.open`, reject `..`/absolute names | M | S–M | none |
| JSZip 3.10.2 | MIT OR GPL-3 | CVE-2022-48285 fixed; keep pinned, never float | L | S | none |
| `PdfView` canvas | — | clamp total pixels (~32M) — huge MediaBox allocates a giant canvas | M | S | pathological pages |
| Tauri CSP | MIT/Apache | `frame-src 'none'`; keep `wasm-unsafe-eval`, `worker-src blob:`, `connect-src https:` | M | S | none |
| Tauri localhost plugin | — | "considerable security risks" — stay on the custom protocol | H | S | decision |
| Tauri updater/signing | MIT/Apache | updater refuses unsigned; NSIS is currently unsigned → Azure signing + published SHA-256 | H | M | cert cost |
| pnpm + OSV + CycloneDX | MIT/Apache | `minimumReleaseAge`, `trustPolicy:no-downgrade`, weekly `osv-scanner`, SBOM per release | H | S | none |
| Model weights | — | no hash verification today; add checked-in SHA-256 map before native load | H | S | licence separate |

Top 5 by risk-per-hour: Android manifest/WebView flags and dead FileProvider
removal; Tauri CSP + signed NSIS with checksums; `src/import/zipLimits.ts` before
`book.open`; frozen lockfile + `minimumReleaseAge` + weekly OSV + SBOM; SHA-256
manifest for downloaded weights.

## Stream O — storage / persistence / scaling (reported)

| Project / idea | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| Dexie 4 `version()`/`upgrade()`, `bulkPut`, `*multiEntry` | Apache-2.0 | keep Dexie, add v2, never edit v1 | H | S | none |
| metadata/content split | our design | `books` = metadata only, `bookContent` = compressed doc | H | M | none |
| `fflate` deflate | MIT, existing dep | compress book JSON before storing (~3×) | H | S | none |
| `CompressionStream('deflate-raw')` | Web API | native alternative, feature-detect | M | S | none |
| `storage.estimate()` + `persist()` | Web API | replace hardcoded 300 MB with quota-derived budget | H | S | none |
| `navigator.locks` | Web API | one tab migrates, others wait | M | S | none |
| wa-sqlite 1.0 (`OPFSCoopSyncVFS`) | MIT since Feb 2023 (**pre-1.0 was GPLv3**) | fallback only, pin ≥1.0 | M | L | check build |
| `@sqlite.org/sqlite-wasm` | Apache-2.0 | needs COOP/COEP, single connection | M | L | none |
| `tauri-plugin-sql` | MIT OR Apache-2.0 | real DB file + sqlx migrations; ships no PRAGMAs — set WAL yourself | M | M | none |
| `@capacitor-community/sqlite` | MIT | native DB when IDB loss is unacceptable | M | L | none |
| OPFS | Web API | originals + audio as files; absent in Safari private mode | H | M | none |
| `@capacitor/filesystem` | MIT, existing dep | audio cache on disk, survives eviction | H | M | none |
| Joplin / Anki / calibre / Readest | AGPL / AGPL / GPL / AGPL | one DB + WAL + files for attachments | M | — | reimplement |

### Measured defects in the current code

1. **Library load clones every book.** `LibraryPage.tsx:324` does
   `db.books.orderBy('addedAt').toArray()` and every `BookRecord` carries `parsed`
   **and** `fileBlob`. At ~6.7 ms per MB of `structuredClone`, 5,000 books × 1 MB is
   ~35 s and several GB of peak heap before first paint.
2. **Backup builds the whole library in memory.** `backup.ts:146-166` buffers every
   book's JSON as a `Uint8Array` before zipping — ~5 GB of arrays for 5,000 books.
3. **Audio cache holds 1.7 hours, not a library.** 24 kHz/16-bit WAV is
   172.8 MB/hour, so `DEFAULT_MAX_CACHE_BYTES` (300 MB) is ~1.7 h of speech.
4. **Blobs are 3–5× more expensive than ArrayBuffers** in IndexedDB (up to 40× in
   Firefox/Linux) and **Blob writes abort outright in WebKit ephemeral sessions**.
   Read IT stores both `fileBlob` and audio as `Blob`.
5. **Capacitor WebView IDB is transient.** `persist()` is reportedly always false
   there, and `backup_rules.xml` excludes `app_webview/` — so the zip export is the
   only recovery path today.

Top 5: split `books`/`bookContent` (v2 schema + `contentStore.ts`); stop storing
Blobs (ArrayBuffer + MIME, originals to OPFS/filesystem); streaming verifiable
backup with per-entry SHA-256 in `manifest.json`; quota-aware cache budget +
`navigator.locks` migrations; native SQLite with WAL only where IDB is untrusted
(`tauri-plugin-sql`), behind `src/core/adapters/`.

## Stream Q — market positioning & packaging (reported)

| Product | Price model | Gated | Lesson |
|---|---|---|---|
| Voice Dream Reader | ~$60–90/yr sub (legacy one-time grandfathered) | nearly everything past trial | the forced-subscription switch is the category's most-cited betrayal; being anti-Voice-Dream is a marketing asset |
| Speechify | free / $29 mo, $139 yr | voices, 5× speed, AI | voice quality is the paywall; price umbrella is huge |
| Readwise Reader | $9.99/mo | cloud library, sync, AI | recurring revenue pays for sync/aggregation, not reading |
| Moon+ Pro | $11.99 one-time | TTS, PDF annotation, themes | 1M+ installs; one-time $12 sells at scale with depth |
| ReadEra Premium | $14.99 one-time | background TTS, Drive sync, dictionary | "one-time, under $15" is the stated purchase reason |
| Librera PRO | $5.99–9.99 | ad removal, extras | competes on price, not polish |
| Prestigio | free + ads | ad-free | ads train distrust — don't ship any |
| Readest (AGPL — ideas only) | free; Plus $4.99/mo, Pro $9.99/mo; $19.99 one-time pack | sync storage, premium voices, offline audio | best packaging shape: free core + à la carte, subscription only for server cost |
| BookFusion | free 10 books; $1.99–9.99/mo | storage, shelves | offline TTS is free there — TTS alone can't be the only paid feature |
| Thorium (BSD-3) | free | — | must beat it on TTS and PDF reflow, not on "free" |
| Kindle / Kobo / Apple Books | content subscriptions | catalogue | people pay $8–12/mo for content, so a $35 tool competes with 3 months of that |

Segments that pay: privacy-conscious professionals (lawyers, clinicians, EU public
sector), ADHD/dyslexic adults buying their own tools, education/accessibility site
licences. Acquisition-only: students, commuters.

Top 5: free core + one-time Pro (Windows $34.99, Android $16.99, bundle $44.99)
where Pro's must-have is on-device neural voice with word highlighting; lifetime +
paid major upgrade, with chaptered M4B export as the v2 marquee; education licences
(5 seats $119, 25 seats $449) anchored against Voice Dream's ~$80/seat/yr; optional
E2EE sync/AI add-on at $4/mo that is never required; voice/language packs $6.99
each. Never gate import, export or annotations. Setup complexity is the biggest
one-star risk — a design problem, not a pricing one.

## Stream M — search / retrieval (reported)

| Project | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| MiniSearch 7.2 (5.7 KB gz) | MIT | inverted index, BM25+, prefix/fuzzy/field boost, `addAllAsync`, `toJSON` | H | S | none |
| `Intl.Segmenter` | platform | CJK + Thai/Lao/Khmer/Myanmar word breaks, 0 bytes | H | S | none |
| pdf.js `PDFFindController` | Apache-2.0, existing dep | per-page normalise + `_pageDiffs` + `getOriginalIndex` recovers exact offsets | H | S | none |
| FlexSearch 0.8 (16.8 KB) | Apache-2.0 | persistent IndexedDB index, worker, doc store | M | M | none |
| wa-sqlite / sqlite-wasm | MIT / Apache-2.0 (core PD) | FTS5 `bm25()`/`snippet()` over OPFS | H | L | none |
| `idb` 8 (1.5 KB) | ISC | hand-rolled token→posting store | M | M | none |
| Dexie `*multiEntry` | Apache-2.0 | `token → sentenceId` rows; no scoring, row explosion | M | S | none |
| Orama 3.1 (24.4 KB) | Apache-2.0 | hybrid BM25+vector, heavier than doing cosine | L | M | none |
| Fuse.js 7 | Apache-2.0 | fuzzy library *metadata* only | L | S | none |
| Lunr 2.3 | MIT | immutable index — wrong shape | L | — | none |
| `diacritics` 1.3 | MIT | accent folding | M | S | none |
| calibre `db/fts` | **GPL-3.0** | 2-table + triggers FTS5 pattern | H (idea) | — | reimplement |
| KOReader fulltext / Foliate | AGPL / GPL | index-per-book, CFI-anchored hits | M (idea) | — | reimplement |
| all-MiniLM-L6-v2 | Apache-2.0 weights | hybrid vectors | M | L | none |

Top 5: MiniSearch per book over existing `FlatSentence`s with `{sentenceId,start,end}`
hits in `src/search/index.ts`; `Intl.Segmenter` + own normaliser (CJK/Thai free,
Arabic/Hebrew folding written by us — calibre's is GPL); reuse
`PDFFindController` for PDF highlights (`src/search/pdfFind.ts`); LRU of 3
resident indexes with on-demand deserialisation; SQLite FTS5 (wa-sqlite) as the
library-wide tier with MiniSearch fallback. Semantic search: opt-in per book,
desktop-first.

## Stream N — import formats (reported)

All formats should land as bytes → HTML/`BlockSeed` → the existing pipeline, not a new renderer.

| Format / library | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| `chardet` (runk/node-chardet) | MIT | sniff `.txt`/`.fb2` charset (cp1251, Shift-JIS) | H | S | none |
| `jschardet` ≥4.1 | 0BSD | alternative detector (pin ≥4.1; older was LGPL) | L | S | pin |
| `gray-matter` | MIT | strip YAML/TOML front matter in `.md` | M | S | none |
| `.fb2`/`.fbz` | open XML spec | own DOMParser, drop `<binary>` | H (RU/CIS) | S | none |
| `@lingo-reader/mobi-parser` | MIT (+fflate) | MOBI/KF8/PalmDOC → HTML; port of foliate-js | H | M | low (refuse DRM) |
| `rtf.js` / `rtf-parser` | MIT / ISC | `.rtf` → HTML | M | S | none |
| ODF `.odt` via `fflate` + `content.xml` | ISO 26300 | own parser | M | S | none |
| `.pptx` via `<a:t>` | ISO 29500 | text-only deck import | L | S | none |
| SheetJS `xlsx` 0.18.5 | Apache-2.0 | npm frozen; Pro is proprietary | L | M | medium |
| `exceljs` | MIT | safe `.xlsx` alt (heavy) | L | M | none |
| `.cbz`/`.cb7` via `fflate` | MIT | comic pages → image blocks | H | S | none |
| `libarchive.js` (wrapper MIT, libarchive BSD-2) | MIT/BSD-2 | real `.cbr` RAR incl. RAR5 | H | M | none |
| `node-unrar-js` / `7z-wasm` | MIT wrapper bundling UnRAR; LGPL | — | — | — | **avoid** |
| DjVuLibre / `chmlib` | GPL-2 / LGPL | `.djvu`, `.chm` | L | L | **avoid** |
| `mp4box.js` / `music-metadata` | BSD-3 / MIT | `.m4b` `chpl`/`chap`, mp3 `CHAP` | M | S | none |
| KindleUnpack / libmobi / `ebook-convert` | GPL-3 / LGPL-3 / GPL-3 | ideas only | — | — | **avoid** |

Top 5 by reach ÷ effort: CBZ/CB7/CBR (`src/import/comics.ts` + `archive.ts` with
entry and expansion caps); MOBI/AZW3/PalmDOC (`src/import/mobi.ts`, detect the
header encryption word and refuse DRM explicitly); FB2/FBZ (`src/import/fb2.ts`);
text hardening (`src/import/charset.ts`, front matter — today cp1251 imports as
mojibake); RTF/ODT/PPTX, XLSX last.
Drop outright: `.kfx`, `.lit`, `.lrf`, `.snb`, `.azw4`, DRM `.azw`.

## Stream L — i18n / typography (reported)

| Project | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| CSS `hyphens:auto` + `lang` | built into browser | hyphenation with no JS at all | H | S | none |
| `hypher` engine | BSD-3 | engine only | L | S | **`hyphenation.*` npm packages are LGPL** |
| tex-hyphen patterns | mixed per file | curated fallback | M | S | audit per file; ru = LPPL |
| `linebreak` + `unicode-trie` | MIT | UAX #14 where Segmenter is coarse | M | S | unmaintained |
| `bidi-js` | MIT | UAX #9 for selection/TTS order | M | S | none |
| `Intl.Segmenter` | Unicode/ICU | Thai/Lao/Khmer/JP word breaks | H | S | none |
| `pangu.js` | MIT | CJK↔Latin spacing | M | S | none |
| Noto Latin/Cyr/Greek, Naskh, Hebrew, Deva, Thai | OFL-1.1 | script coverage 25–155 KB each | H | M | none |
| Noto CJK sliced woff2 | OFL-1.1 | 1.8–2.9 MB, lazy per `unicode-range` | H | M | none |
| Amiri / Scheherazade New | OFL-1.1 | Arabic body/pedagogical | M | S | none |
| `fonttools` / `subset-font` | MIT / BSD-3 | subset + slice build step | H | M | none |
| pdf.js | Apache-2.0 | PDF text is content-stream order, no reading order | H | — | none |
| Kokoro-82M (sherpa) | Apache-2.0 | 8 languages: en es fr hi it pt ja zh | H | S | none |
| Pocket TTS | code MIT, weights CC-BY-4.0 | streaming, 6 languages | M | S | attribution |
| Supertonic | OpenRAIL weights | — | L | — | **do not ship** |
| `franc` / `cld3-asm` | MIT | language detection (avoid `cld`, no licence) | H | S | none |

Top 5: hyphenate via CSS not JS (`src/reader/reader.css`); script detection +
lazy OFL font packs (`src/reader/script.ts`, `src/fonts/packs.ts`); RTL as a
first-class mode via logical properties (`src/reader/direction.ts`); CJK
vertical writing + ruby + Segmenter (`src/reader/text/segment.ts`);
language-aware TTS routing + i18next UI (`src/tts/langVoice.ts`, `src/i18n/`).

## Stream K — native shell / background audio (reported)

| Source | Licence | Idea | Imp | Eff | Risk |
|---|---|---|---|---|---|
| androidx.media3 `MediaSessionService` | Apache-2.0 | one service = session + MediaStyle notification + AVRCP/Bluetooth + Assistant/Wear/Auto; self-demotes 10 min after pause | H | M | none |
| media3 `SonicAudioProcessor` | Apache-2.0 | pitch-preserving speed at any factor, unlike `AudioTrack`/`PlaybackParams` | H | S | none |
| `MediaButtonReceiver` + `onPlaybackResumption` | Apache-2.0 | headset restart, resume "chapter 7, sentence 40" after reboot | M | M | none |
| Android 15 behaviour changes | doc | `mediaPlayback` exempt from 6 h FGS cap; API 35 needs focus requested from the FGS | H | S | none |
| SAF `ACTION_OPEN_DOCUMENT` + `takePersistableUriPermission` | platform | import without `MANAGE_EXTERNAL_STORAGE` | H | M | avoids Play trap |
| `ACTION_SEND`/`ACTION_VIEW` + `singleTask`/`onNewIntent` | platform | "Open with Read IT" for epub/pdf | H | S | none |
| `@capacitor/app` `appUrlOpen` | MIT | VIEW-intent handoff into JS | M | S | none |
| `tauri-plugin-single-instance`/`-deep-link`/`-fs` | MIT OR Apache-2.0 | one window; double-click `.epub`; real file IO | M | S | none |
| `tauri-plugin-updater` | MIT OR Apache-2.0 | signed static-JSON updates, no server | M | S | key custody |
| PWA MediaSession / Wake Lock | W3C | parity; wake lock is screen-only, never background audio | M | S | none |

Top 5: adopt `MediaSessionService` (`playback/PlaybackService.java` + manifest
intent-filter); push PCM to `AudioTrack` instead of base64 WAV over the bridge;
make the service a real queue mapping lock-screen next/prev to sentence ids;
SAF import + `ACTION_VIEW`/`ACTION_SEND`; fix audio-focus/ducking for every
engine. Skip `MANAGE_EXTERNAL_STORAGE` (Play rejects "user selects files" as a
use case) and battery-optimisation exemptions (an FGS needs none).

### Defects found during research (real, present in the repo today)

1. **Karaoke highlighting silently dies on Android.** `speechSynthesis.onboundary`
   (`src/tts/system.ts:130`) is not delivered in Android WebView on most builds.
2. **System-voice TTS ignores phone calls and ducking.** `speechSynthesis`
   (`src/tts/system.ts:122`) never routes through an `<audio>` element, so there
   is no audio focus; a call or podcast does not pause reading.
3. **Playback service is unexported and positions are unknown** — no scrubber,
   no seek, no `setSessionActivity`, no focus request; and the paused FGS keeps
   its notification and wake lock forever instead of self-demoting.
4. **`speechSynthesis` + per-sentence base64 WAV** (`KokoroPlugin.java:481`,
   `kokoroNativeEngine.ts:472`) adds start latency and dies if the renderer is
   reclaimed while the screen is off.

## Stream J — export / interop (reported)

| Format / project | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| Readium Annotations | BSD-3 | `{id,type:"Annotation",motivation,body,target,selector[]}` with Fragment/TextQuote/Progression selectors | H | M | none |
| Readium Locator (webpub-manifest) | BSD-3 | locator per sentence: `{href,locations:{fragments,progression,position},text:{before,highlight,after}}` | H | S | none |
| W3C Web Annotation Data Model | W3C REC, RF patent policy | `anno.jsonld` context, `oa:TextualBody` — Hypothesis-compatible output free | H | S | none |
| Hypothesis client | BSD-2 | mirror export keys so our JSON imports there | M | S | none |
| Readwise CSV/Markdown | service, de-facto format | emit their columns + `## book` Markdown block | H | S | none |
| Kindle `My Clippings.txt` | plain text, de-facto | parser only, never AZW3/KFX | H | S | DRM skip |
| Zotero JSON | AGPL code, user data | read/write JSON, reimplement | M | M | code only |
| Calibre `metadata.db` | GPL code, SQLite schema | read-only import of user's own DB | M | M | reimplement |
| citeproc-js / plugin-csl | **AGPL-3.0 / CPAL** | — | — | — | **blocker** |
| citation-js core/BibTeX | MIT | parse BibTeX/RIS/DOI; avoid the CSL plugin | M | S | medium |
| CSL styles | CC-BY-SA-3.0 | fetch at runtime or ship unmodified + attribution | L | S | share-alike |
| satori | **MPL-2.0** | use `html-to-image` (MIT) instead | H | S | **blocker** |
| @ffmpeg/core (wasm) | **GPL-2.0+** | `mp4-muxer` (MIT) + `mp4box.js` (BSD-3) + WebCodecs | H | L | **blocker** |
| ID3v2.4 CHAP/CTOC, MP4 `chpl` | informal spec | chaptered audiobooks with no ffmpeg | M | M | none |
| OPDS 1.2/2.0 | spec free | Komga/Kavita/Calibre-Web via OPDS only | M | M | safe |
| KOReader `.sdr/metadata.epub.lua` | AGPL code, user data | own Lua-table reader for doc_props/annotations | M | M | reimplement |
| pdf-lib | MIT | print/PDF of notes | M | S | none |

Top 5: annotation interchange core (`src/export/annotations.ts` + CSV);
Readwise/Obsidian/Kindle-clippings import (`src/import/highlights/`);
hand-built quote cards rasterised with `html-to-image`; audiobook export via
`mp4-muxer` + WebCodecs (no ffmpeg); OPDS import in `src/import/opds.ts`.

## Stream G — QA / performance / test infrastructure (reported)

| Project | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| pdf.js `test_manifest.json` | Apache-2.0 | corpus manifest `{id,file,md5,rounds,type,partial}` + golden PNG per page | H | M | none |
| pdf.js `unit/clitests.json` | Apache-2.0 | same specs headless in Node **and** browser | H | M | none |
| epubcheck `src/test/resources` | BSD-3 | 24 EPUBs plus unpacked trees — rezip and mutate one file per case | H | M | none (fixtures ok) |
| readability `test/test-pages/` | Apache-2.0 | `source.html` + `expected.html` + `expected-metadata.json` | H | S | none |
| Komga `CodingRulesTest` | MIT | ArchUnit-style structural tests that fail the build | H | S | none |
| Marmalade bench screen | MIT | device bench (RAM/zram/thermal) + phoneme-diff → vocab ablation → STT-WER | H | M | none |
| Playwright | Apache-2.0 | `toHaveScreenshot` across Pixel 7 / iPhone 15 / 1440px | H | M | none |
| @axe-core/playwright | **MPL-2.0** | a11y assertions on Library/Reader/Settings | H | S | devDep only, never bundled |
| IBM accessibility-checker | Apache-2.0 | licence-clean axe alternative | M | S | none |
| Lighthouse CI | Apache-2.0 | LCP/TBT/JS-KB budgets on the PWA build | M | S | none |
| androidx.benchmark + Baseline Profiles | Apache-2.0 | `StartupTimingMetric`, `FrameTimingMetric`, `TraceSectionMetric` | H | L | none |
| jazzer.js | Apache-2.0 | coverage-guided fuzz of raw EPUB/PDF bytes | M | M | none |
| Sentry SDK / server | MIT / **FSL-1.1** | SDK yes; do not ship the FSL server | H | S | excluded |
| GlitchTip | MIT | Sentry-compatible self-host | M | M | none |

Top 5: malformed-file corpus as a pinned manifest (`src/import/__fixtures__/corpus.json`,
assert typed errors, never a crash); golden-image reader tests on a device matrix;
a11y CI (swap to IBM's Apache-2.0 checker if MPL devDep is unwanted); Android
macrobenchmark + Baseline Profile around startup, paging and Kokoro synth;
Lighthouse budgets, coverage thresholds and opt-in redacted crash reporting.
Avoid vendoring `pdf.js/test/pdfs/*` (per-file provenance varies) — generate.

## Stream C — parsing / OCR / layout (reported)

| Project | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| PaddleOCR PP-OCRv6 tiny ONNX (`PP-OCRv6_tiny_{det,rec}_onnx`) | Apache-2.0 code **and** weights | det 1.7 MB + rec 4.3 MB on the ORT-web we already ship | H | M | none |
| PP-DocLayout-L | Apache-2.0 | 23 classes incl. footnote/aside/number — only header/footer used today | H | S | none |
| pdf.js `getStructTree()` | Apache-2.0, existing dep | tagged-PDF structure = real reading order, `/Table`, `/H1..H3` | H | M | none |
| pdfplumber table finder | MIT | edges → merge → intersections → cells → group | H | M | none |
| camelot / tabula-java | MIT | lattice vs stream split; ruling-line detection | M | M | none |
| Unstructured element taxonomy | Apache-2.0 | normalise block kinds (`Footnote`, `NarrativeText`, `Table`) | L/M | S | none |
| Docling | MIT code / CDLA weights | `force_full_page_ocr`, reading-order assignment | M | L | weights off allowlist |
| TableFormer (docling-ibm-models) | MIT code / CDLA weights | row/col spans for merged cells | M | L | flag |
| marker / MinerU | Apache code / OpenRAIL or custom | — | L | — | avoid |
| Surya / LayoutLMv3 / Nougat | Apache code / **CC-BY-NC** weights | — | L | — | avoid |
| MuPDF / PyMuPDF | **AGPL-3.0** | block/line/span text order ideas | M | — | reimplement |
| pdfium | BSD-3 | native text page fallback on Android | L | L | ok (JNI) |
| Donut | MIT code + MIT weights | OCR-free, weak on prose | L | — | ok/weak |

Top 5: on-device OCR with PP-OCRv6 tiny triggered by `charsPerPage < 50`
(`src/import/ocr/`); drop furniture ranges *before* stitching pages;
`getStructTree()` as authoritative order for tagged PDFs; port pdfplumber's
table finder into `src/import/tables.ts`; OCR image-only EPUB spine docs.
Cost: ~6 MB extra weights, same memory profile as the current layout pass.

## Stream H — distribution / monetisation / legal (reported)

| Tool / channel | Licence or terms | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| Paddle | service, 5% + 50¢, MoR VAT | checkout + licence webhooks | H | S | low |
| Polar | code Apache-2.0, service 5%+50¢ | MoR with built-in licence-key API, best fit | H | S | low (don't vendor code) |
| Lemon Squeezy | service | **sign-ups closed 16 Nov 2026, processing ends 31 Mar 2027** | — | — | **do not start** |
| Gumroad | service 10%+50¢ + processing | no activation API | L | S | low |
| Google Play Billing | Apache-2.0 client | from 30 Jun 2026: 20% + 5% billing fee, 10% subs, 25% pre-cutoff installs | H | M | low |
| Apple App Store | policy | 4.2 rejects thin web wrappers; US link-out 0% | H | M | policy |
| Microsoft Store | policy, free signing | 15% or own commerce 0%; Tauri needs MSIX via MakeAppx | M | S | low |
| Keygen | **FCL (source-available)** | hosted licensing + device activation | M | S | flag |
| Own Ed25519 licence file | our code | signed blob verified offline via WebCrypto, no phone-home | H | M | none |
| Tauri updater | MIT OR Apache-2.0 | signed minisign auto-update | H | S | low |
| Azure Artifact Signing | service $9.99/mo | NSIS signing, no EV; SmartScreen still accrues | H | S | low |
| Umami | **MIT** | self-hosted, opt-in aggregate events | M | S | low |
| Plausible | **AGPL-3.0** | — | — | — | do not bundle |
| Sentry | server FSL-1.1, SDK MIT | crash reporting as hosted service | M | M | flag |
| Readium LCP | client BSD-3, **production lib closed** | EDRLab membership €300/yr + certification | L | L | high |
| EAA (EU 2019/882) | law, in force 28 Jun 2025 | accessibility statement; microenterprise exemption | H | M | legal |
| **"Read IT" name** | trademark | CA READIT class 9 (PrüvIT), readit.ai, Play "Read It"/"Readit" | H | S | **high** |

Top 5: offline-first entitlement core (`src/core/entitlement.ts`, Ed25519 + WebCrypto,
14-day trial, gate capabilities not the reader); sell direct via Paddle/Polar
before store IAP; ship the legal pack (privacy policy, Data safety, EAA
accessibility statement); Windows trust chain (updater plugin + Azure signing +
MSIX); fix provenance (CONTRIBUTING with DCO, correct `RELICENSING.md` §3 which
describes ads/Remove-Ads that `PRODUCT.md:80` says are not built) and run a
name search before investing further.

## Stream D — accessibility & product features (reported)

| Source | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| Voice Dream feature list | closed | focused reading mode, spacing controls, built-in dictionary | H | S–M | none |
| OpenDyslexic | OFL-1.1 | dyslexia body font (reserved name) | H | S | low |
| Lexend / Atkinson Hyperlegible | OFL-1.1 | low-fatigue faces | H | S | low |
| Princeton WordNet 3.0 | permissive, attribution | tap-to-define glosses | H | M | low |
| Open English WordNet | CC-BY-4.0 | newer synsets | M | S | low |
| Wiktionary / dictionaryapi.dev | CC-BY-SA + GFDL | richer senses | — | — | **avoid bundling** |
| OPUS-MT | weights CC-BY-4.0 | offline translation | M | L | low-med |
| Argos | MIT code, unlicensed weights | — | — | — | caution |
| CMUdict | BSD-2 | syllables, hyphenation | M | S | low |
| mp4box.js | BSD-3 | chaptered M4B export | M | M | low |
| Beeline / Bionic / Spritz | patented | line-colour, prefix-bold, RSVP | — | — | **avoid** |
| MS US 10,699,072 B2 | — | TTS with dimmed non-active lines | — | — | **avoid line dimming** |
| Irlen | live TMs | coloured overlays | — | — | use "Page tint" only |

Top 5: reading type kit (3 OFL fonts + letter/word spacing + preset);
define-on-tap via WordNet + `compromise` lemma; focus column (no dimming);
local reading habit stats in Dexie; page-tint tokens.

## Stream E — sync / library / storage (reported)

| Project | Licence | Idea | Impact | Effort | Risk |
|---|---|---|---|---|---|
| kosync spec (`kosync-conformance`) | spec CC0/BSD-3, server AGPL-3 | `PUT/GET /syncs/progress/:document`, `x-auth-user`/`x-auth-key`, partialMD5 doc id | H | M | low (spec only) |
| Komga | MIT | OPDS v1+v2, sync + progress reference | M | S | none |
| OPDS 1.2/2.0 + `r2-opds-js` | spec free, parser BSD-3 | "add library from Calibre/Komga/Kavita" | H | M | none |
| Kavita / Calibre-Web | GPL-3 | OPDS browse UX, progress model | M | — | ideas only |
| Readium LCP | BSD-3 | DRM | L | XL | trademark, skip |
| rclone | MIT | provider matrix, E2EE prior art | H | M | none |
| webdav / aws4fetch | MIT | Nextcloud + S3/R2/B2/MinIO | H | S/M | none |
| Syncthing | MPL-2.0 | do not ship; "export to a synced folder" | M | S/M | interop only |
| Yjs / Automerge | MIT | CRDT overkill for LWW positions | L | L | none |
| Joplin E2EE | AGPL-3 | master-key-wraps-item-key design | M | — | ideas only |
| Readest (competitor) | AGPL-3 | read only, never copy | — | — | high |

Top 5: kosync-compatible progress sync (`src/sync/kosync.ts`); per-field
`updatedAt`/`deletedAt` + text-hash position record before any transport;
bring-your-own-cloud backup (S3 SigV4 + WebDAV) reusing the zip schema;
E2EE with Argon2id + AES-256-GCM over opaque UUID names; OPDS import.

## Stream F — AI / local intelligence (reported)

| Project (code licence) | Idea | Impact | Effort | Licence risk |
|---|---|---|---|---|
| transformers.js (Apache-2.0) | one ONNX runtime for everything below; WebGPU + WASM | H | S | none |
| llama.cpp (MIT) | GGUF chat via Tauri Rust + Capacitor JNI | H | L | none (weights separate) |
| ONNX Runtime GenAI (MIT) | KV-cache/greedy-loop reference; no JS binding → reimplement | M | M | none |
| WebLLM / MLC-LLM (Apache-2.0) | WebGPU chat; prebuilt list is almost all Llama | M | M | medium |
| Ollama (MIT) | model download/resume/manager UX | L | S | none |
| **Qwen2.5-0.5B / Qwen3-0.6B (Apache-2.0)** | explain / summarise / Q&A / simplify; 461 MB q4f16 ONNX | H | M | none |
| SmolLM2-135M/360M (Apache-2.0) | instant tier: 100/260 MB, one-line summaries | H | S | none |
| Phi-3-mini / 3.5-mini (MIT) | desktop-only quality tier (2.3 GB q4) | M | M | none |
| Gemma 2/3 (`gemma`, gated, custom terms) | — | — | — | **avoid** |
| Llama 3.2 1B/3B (Llama Community Licence) | — | — | — | **avoid** |
| Marian (MIT) + OPUS-MT weights | per-chapter translation, ~100 MB int8/pair | H | M | varies per pair |
| Bergamot (MPL-2.0 code **and** models) | — | — | — | **avoid** |
| Argos (MIT/CC0) / LibreTranslate (AGPL-3.0) | idea only, weights unlicensed | L | L | high/unknown |
| NLLB, LaMini-Flan-T5 (CC-BY-NC-4.0) | trap — both appear in transformers.js examples | — | — | **avoid** |
| Whisper / whisper.cpp (MIT, weights Apache-2.0) | dictation, quote capture, pronunciation scoring | M | S | none |
| all-MiniLM-L6-v2 (Apache-2.0, 22 MB int8) | RAG index behind Q&A | H | S | none |
| Model2Vec potion (MIT) | static embeddings, chunk routing, no runtime | M | S | none |
| sqlite-vec (Apache-2.0/MIT) / Vectra (MIT) | vector search (Vectra is Node-fs only) | M | M | none |
| byT5-small (Apache-2.0) · Tesseract.js (Apache-2.0) | OCR cleanup, diacritics, scanned-PDF OCR | M | S/M | none |
| CMUdict (BSD-2) · Open English WordNet (CC-BY-4.0) | phonemes + glosses | H | S | attribution only |

Top 5: Qwen2.5-0.5B via transformers.js `src/ai/llm.ts`; MiniLM RAG in a Dexie
table (sqlite-vec on Tauri); SmolLM2-135M tiny tier `src/ai/tiny.ts`;
OPUS-MT per-pair translation `src/ai/translate.ts`; whisper-tiny + CMUdict
pronunciation scoring and OEWN dictionary `src/ai/pronounce.ts`, `src/dict/`.
Phone reality: 0.5B q4 ≈ 10–20 tok/s, 135M ≈ 40+ tok/s, MiniLM ≈ 1–3 ms/chunk;
≥1.5B is desktop-only. Ship zero weights in the APK — user-initiated download.

## Prioritised roadmap

### Tranche 0 — repairs (confirmed defects, no new surface)

Each is a bug a real user hits, is small, and cannot regress the licence
position. Line references come from the research pass and must be re-verified
before editing.

| # | Fix | Why it matters | Files | Effort |
|---|---|---|---|---|
| 1 | Audio focus + ducking for every engine | a phone call or podcast does not pause reading today | `src/tts/system.ts`, native session | M |
| 2 | Karaoke boundary fallback | `onboundary` is not delivered in Android WebView, so highlighting silently dies | `src/tts/system.ts`, reader highlight | M |
| 3 | Blob → `ArrayBuffer` + MIME; originals to OPFS/filesystem | 3–5× cheaper writes (40× on Firefox/Linux) and Blob writes abort in WebKit ephemeral sessions | `src/core/codec.ts`, `src/tts/cache.ts`, `src/core/db.ts` | M |
| 4 | `books` / `bookContent` split, compressed | library load clones every book: ~35 s and GBs of heap for 5,000 books | `src/core/db.ts`, `src/core/contentStore.ts`, `src/pages/LibraryPage.tsx` | M |
| 5 | Streaming, checksummed backup | backup buffers the whole library (~5 GB); the zip is the only recovery path in Capacitor | `src/backup/backup.ts`, `src/backup/integrity.ts` | M |
| 6 | Charset detection for `.txt`/`.fb2` | cp1251 text imports as mojibake today | `src/import/charset.ts`, `txt.ts` | S |
| 7 | Font de-obfuscation | obfuscated EPUB fonts silently fall back to defaults | `src/import/epub/obfuscation.ts` | S |
| 8 | Anchor preservation + nav/page-list/landmarks | ids are dropped on import, so links, notes and TOC positions break | `src/import/html.ts`, `src/import/epub/nav.ts` | M |
| 9 | Zip entry/expansion caps before `book.open` | archive bombs are unbounded today | `src/import/zipLimits.ts` | S |
| 10 | Android WebView flags, dead FileProvider, `allowBackup=false` | removes a broad `external-path` grant and backup leakage of notes | `AndroidManifest.xml`, `res/xml/file_paths.xml`, `MainActivity` | S |
| 11 | Quota-aware audio cache budget | 300 MB is only ~1.7 h of Kokoro speech | `src/core/storage.ts`, `src/tts/cache.ts` | S |
| 12 | Signed NSIS + SHA-256 published per release | the Windows installer is unsigned today | `.github/workflows/*`, `src-tauri/tauri.conf.json` | S/M |
| 13 | Migration lock + `versionchange` reload | two tabs can migrate the same DB | `src/core/migrations.ts` | S |

### Tranche 1 — the paid differentiator

Depends on streams U, V, Z (TTS front-end, audio quality, word sync): accurate
word timing, speed without re-synthesis, loudness/joins, and a bundled small
voice so first speech needs no download.

### Tranche 2 — table stakes to sell

Legal pack and EAA statement, offline entitlement core, updater, name
clearance, accessibility conformance (streams H, I, W).

### Tranche 3 — growth features

Search, OCR, comics/MOBI/FB2, OPDS + kosync, annotation export, font/spacing
kit and dictionary (streams A, C, D, E, J, L, M, N).

