# AGENTS.md — working on Read IT

Read IT is a general, offline ebook reader. This file records the conventions that
matter when changing the pronunciation lexicon and text-to-speech pipeline. Read it
before touching `src/tts/lexicon/`.

## What the app is

- Import PDF, EPUB, DOCX, TXT/Markdown and web articles into a local library.
- Read in a reflowing reader or as PDF pages, with highlights, notes, bookmarks and
  per-book progress.
- Listen with on-device voices: Kokoro-82M, Pocket TTS or the platform voice.
- Everything the reader needs after import runs on the device. There is no account,
  no server and no cloud sync. Ads and an optional one-time purchase are planned for
  later; they are not part of the reading surfaces.

## The lexicon

`src/tts/lexicon/book-lexicon.json` holds a short list of respellings for names that
general speech engines mispronounce — authors, characters, places and unusual words.
The file is deliberately small: every rule is applied to every sentence, so padding
it costs playback time for almost no benefit.

- `src/tts/lexicon/index.ts` seeds the JSON into IndexedDB and applies it before
  synthesis through `expand()`.
- Rows have stable `b-N` ids, a regex `pattern`, a plain-text `replacement` and
  `isRegex: true`. Seeding keeps a reader's on/off choice when the list is refreshed.
- Whole-word rules are written `\b[Tt]olkien\b` so a capitalised name and a lowercase
  mention both match. Replacements use hyphens to show the syllables: `Toll-keen`.
- Whole-word entries are compiled into one map pass; anything else runs as an ordered
  regex. Rules run in file order, user entries first.
- A respelling must be idempotent: applying it to its own output changes nothing.

## Pattern portability

iOS 15.4–16.3 cannot compile lookbehind. `regexFor()` silently skips a row whose
pattern fails to compile, so never use `(?<!…)` or `(?<=…)`. Use a `(^|[^X])` capture
and re-emit it with `$1`. The test *regex portability (iOS 15.4–16.3)* enforces this;
see `regex-portability.md` in the same folder.

## Adding a rule

1. Confirm the name is mispronounced by the default voice on a real device.
2. Add one row with the next free `b-N` id to `book-lexicon.json`.
3. Add a focused case to `src/tts/lexicon/index.test.ts`.
4. Keep the replacement in plain English chunk spelling: no SSML, no IPA, no engine
   syntax. It must sound the same on all three engines.

Reader-created rules live in the same table with `source: 'user'` and always run
before the built-ins, so a personal rule can override a shipped one.

## Licensing constraints

The distributed app is Apache-2.0. Anything added under `src/tts/` must be
Apache-2.0, MIT, CC-BY-4.0, SIL OFL or public domain. A CI licence guard rejects
copyleft dependencies and non-commercial voice data. Provenance is recorded in
`RELICENSING.md` and the component inventory in `THIRD_PARTY_LICENSES.md`.

## Environment notes

- `pnpm typecheck` and `pnpm test` are the gates; fix both before handing work back.
- Under a loaded machine, vitest can occasionally flake; if so, rerun with fewer
  workers before investigating a code failure.
- `.tmp/` is gitignored: scratch scripts and dumps there are not shipped.
- Other sessions may be editing other areas of the tree concurrently. Re-run
  `git status` before editing and do not overwrite unfamiliar changes.

## Files

| path | what |
|---|---|
| `src/tts/lexicon/book-lexicon.json` | the built-in respellings |
| `src/tts/lexicon/index.ts` | seeding, `expand()` and the word map |
| `src/tts/lexicon/index.test.ts` | expansion, seeding and portability tests |
| `src/tts/lexicon/kokoro-native-known.json` | words the Android Kokoro model already says right |
| `src/tts/lexicon/regex-portability.md` | the older-WebView rule and its test |
| `src/tts/lexicon/term-respellings.md` | why the list is shaped the way it is |
| `src/tts/kokoro/g2p/` | the first-party grapheme-to-phoneme step |
