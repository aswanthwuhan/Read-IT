# Licensing runbook — Read IT

Concrete steps to get from "the earlier reader (GPL-3.0, ships espeak-ng)" to
"Read IT (Apache-2.0, no GPL anywhere in the distributed binary)".

This is the part of the project where a silent mistake costs you the ability to ship a
paid, ad-supported app. Treat it as a checklist, not a document.

---

## A. Inventory — what carries GPL today

```
grep -rn "phonemizer"            src/ packages/   → web Kokoro (espeak WASM in the npm bundle)
grep -rn "espeak"                src/            → native Kokoro (espeak-ng-data in the AAR)
ls android/app/libs/                                → sherpa-onnx-1.13.8.aar (bundles espeak-ng)
```

Two sources. Both must go.

## B. The three artefacts the app must ship

| Artefact | Licence | Where it comes from |
|---|---|---|
| `LICENSE` | Apache-2.0 | the repo root |
| `NOTICE` | attribution | credits the earlier reader, Kokoro, Pocket TTS, CMUdict, Literata, the libraries |
| `THIRD_PARTY_LICENSES.md` | inventory | every dependency + every downloadable model, its licence, whether it is bundled or downloaded, and whether it needs attribution |

`THIRD_PARTY_LICENSES.md` should be **generated** (see §E), not hand-maintained.

---

## C. Step 1 — native: sherpa-onnx 1.13.8 → 2.0.1

Upstream PR #4055 (merged 2026-10-20) removed espeak-ng and piper-phonemize from the
build. Upstream states sherpa-onnx is GPL-free after that PR.

**1.1** Swap the AAR.

```
delete android/app/libs/sherpa-onnx-1.13.8.aar
curl -L -o android/app/libs/sherpa-onnx-2.0.1.aar \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/sherpa-onnx-2.0.1.aar
```

Update `android/app/build.gradle`:

```diff
-// sherpa-onnx ships x86/x86_64 ONNX runtime builds too, but release only ever runs
-implementation files('libs/sherpa-onnx-1.13.8.aar')
+// sherpa-onnx 2.0.1: Apache-2.0. espeak-ng and piper-phonemize were REMOVED in v2.0.0
+// (upstream PR #4055), so this AAR is GPL-free. Do not downgrade below 2.0.0.
+implementation files('libs/sherpa-onnx-2.0.1.aar')
```

**1.2** Rewrite the plugin. The v2 API changed in ways that break the current code:

| Old (1.13.x) | New (2.0.x) |
|---|---|
| `data_dir` pointing at an `espeak-ng-data` folder | **deprecated and ignored** |
| text → espeak phonemes internally | `lexicon` frontend, **or** `phoneme_codepoints` / `tokens` passed in from outside |
| — | **Pocket TTS** model config now exists natively |

Files to change:

* `android/app/src/main/java/<newpkg>/kokoro/KokoroPlugin.java`
* `.../kokoro/KokoroModel.java`
* `.../kokoro/KokoroStore.java`
* `.../kokoro/KokoroTtsEngine.java`
* `src/tts/native/kokoroPlugin.ts` (the TS bridge)
* `src/tts/native/kokoroNativeEngine.ts`, `kokoroDownloadCore.ts`, `kokoroDownload.ts`

**1.3** Frontend choice:

* **English** → ship sherpa-onnx's `lexicon-en-us.txt` (from the sherpa-onnx `tts-models`
  release tag) and use the `lexicon` frontend. No phonemiser dependency at all.
* **Everything else** → compute phonemes in TypeScript with our own G2P (§D) and pass them
  in as `phoneme_codepoints` / `tokens`.

**1.4** Add native Pocket TTS. No phonemiser required, so it is the safest neural engine on
Android/iOS. Model + voices come from the sherpa-onnx `tts-models` release tag.

## D. Step 2 — web: vendor kokoro-js and drop espeak

`kokoro-js` is still `1.2.1` on npm and still depends on `phonemizer`. GitHub `main` still
has `import { phonemize as espeakng } from "phonemizer"`. There is no upstream release
without espeak, so we fork.

**2.1** Vendor it into the workspace rather than publishing to npm:

```
packages/kokoro-js/          (private workspace package)
  UPSTREAM.md                upstream URL + pinned commit SHA + our diff
  LICENSE                    Apache-2.0 (upstream)
  src/…                      upstream sources, one file changed
```

**2.2** The single functional change — `packages/kokoro-js/src/phonemize.js`:

```diff
-import { phonemize as espeakng } from "phonemizer";
+import { phonemize } from "@readit/g2p";
```

Everything else in that file — `normalize_text()`, number words, currency, dates,
abbreviations, possessives — is upstream Apache-2.0 code and is **not** espeak-specific.
Keep it verbatim.

**2.3** Remove the dependency:

```diff
  "dependencies": {
    "@huggingface/transformers": "^3.5.1",
-   "phonemizer": "^1.2.1"
+   "@readit/g2p": "workspace:*"
  }
```

**2.4** Assert it stays gone:

```
grep -rn "phonemizer\|espeak" packages/kokoro-js/ && exit 1
```

## E. Step 3 — our own G2P (`src/tts/g2p/`)

Target: IPA inside Kokoro's tokenizer vocabulary. Get the vocabulary from the model repo
rather than hardcoding it — `tokenizer.json` → `model.vocab`.

**Phase 1 — CMUdict + NRL 7948**

* CMU Pronouncing Dictionary — free for any use.
* NRL Report 7948 letter-to-sound rules — public domain (US government work).
* ARPAbet→IPA table and stress placement — written by us, from scratch.
* Out-of-vocabulary fallback — NRL rules; log the word so the failure rate is measurable.

**Phase 2 — optional:** port `misaki`'s English G2P (Apache-2.0) if the Phase-1 A/B
listening test shows a gap. misaki is what Kokoro was trained against, so it matches best.

**Acceptance test (must pass before M2 closes):** render 20 paragraphs — 10 fiction,
10 non-fiction, including proper nouns, numbers, currency, dates, hyphenation, dialogue —
through both espeak (reference) and our G2P, and listen. Record the failure rate for OOV
words. Ship the pronunciation override table so users can fix the residue.

## F. Step 4 — Pocket TTS licence hygiene

* Code MIT, weights **CC-BY-4.0** → commercial use allowed **with attribution**.
* **Exclude the non-commercial voices:** `cosette` (Expresso, CC-BY-NC-4.0) and `jean`
  (EARS, CC-BY-NC-4.0). They must not be in the app, the model manifest, or the fallback
  list.
* Ship an in-app **Credits** panel carrying the required CC-BY-4.0 attributions
  (VCTK-derived `azelma`/`eponine`/`fantine`, `alba`; `jenny` carries its own terms).
* **No voice-cloning UI.** Kyutai's terms prohibit impersonation without consent.

## G. Step 5 — the relicensing statement

the earlier reader is GPL-3.0. Read IT is Apache-2.0. The sole copyright holder is
`aswanthwuhan` (git history: one author and no other human committers), so the relicensing is valid — but it must be **documented**.

`RELICENSING.md` should state: the original work, its GPL-3.0 licence and date; the
copyright holder's exclusive right to relicense; the terms of the new Apache-2.0 grant;
and that the GPL-3.0 original is preserved (keep a tagged archive of it) so the provenance
is verifiable.

## H. Step 6 — the licence guard in CI

This is the invariant that keeps the whole premise true. Add `.github/workflows/licence.yml`:

1. `pnpm licenses list --json` → enumerate every dependency and its licence.
2. **Fail the build** on any of: `GPL-2.0`, `GPL-3.0`, `AGPL-3.0`, `GPL-2.0+`, `GPL-3.0+`,
   `AGPL-3.0+`, `SSPL-1.0`, `BUSL-*`, or `UNLICENSED`.
3. Assert `packages/kokoro-js` contains no `phonemizer`/`espeak` import.
4. Assert `android/app/libs/` contains no AAR that bundles espeak (the version floor check
   on the sherpa AAR filename is a cheap proxy).
5. Assert the downloadable-model manifest contains no GPL-family model.
6. Regenerate `THIRD_PARTY_LICENSES.md` from the same data and commit it, so the inventory
   cannot rot.

Run it on every push and PR, from M2 onward.

---

## I. One-page checklist before the first store submission

- [ ] `LICENSE` is Apache-2.0; no GPL text left in the tree except in `THIRD_PARTY_LICENSES.md`
- [ ] `NOTICE` credits the earlier reader, Kokoro, Pocket TTS, CMUdict, NRL, Literata
- [ ] `RELICENSING.md` + preserved GPL-3.0 original
- [ ] No `phonemizer` / `espeak` in `packages/`, `src/`, `android/`
- [ ] sherpa-onnx AAR is **2.0.1** or newer
- [ ] Pocket TTS ships **no** CC-BY-NC voices
- [ ] In-app Credits panel carries the CC-BY-4.0 attributions
- [ ] `licence.yml` is green on the release commit
- [ ] Store privacy-policy URL is live and names AdMob, Google Mobile Ads, and the
      entitlement backend
