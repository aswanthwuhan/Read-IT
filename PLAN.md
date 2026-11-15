# Read IT — plan

Read IT is a general-purpose offline ebook reader for Android, iOS, the web (PWA) and
Windows. Users import their own PDF / EPUB / DOCX / TXT / Markdown / web-article files,
read them with a proper reflowing reader, and **listen** to them with on-device neural
voices — no account, no server for the reading itself.

It is a re-skin and a re-licensing of PharmaReader (the MD-Pharmacology study reader),
not a rewrite. The import pipeline, reader, TTS engines, layout detection, Whisper
aligner, backup, PWA/Capacitor/Tauri shells and the ~600-file test suite all carry over.

---

## 0. Decision record

Everything below was settled in the grill session and is binding unless re-decided.

| # | Area | Decision |
|---|---|---|
| 1 | App licence | **Apache-2.0** (relicensed by the sole copyright holder) |
| 2 | TTS | **Fork kokoro-js** to drop espeak-ng; **sherpa-onnx v2** for native; Pocket TTS everywhere |
| 3 | Audience | **General ebook readers** — not exam candidates |
| 4 | Money | **Free + ads + one-time IAP** ("Remove Ads") |
| 5 | Backend | **Lightweight entitlement backend, no accounts** |
| 6 | Study layer | **Cut entirely** — syllabus tree, FSRS cards, review session |
| 7 | AI | **Dropped entirely** — no BYO-key, no local LLM |
| 8 | Name | **Read IT** (internal/package token `ReadIt`) |
| 9 | Ads | **AdMob + UMP consent, non-personalised, no ATT prompt** |
| 10 | Ad slots | **Library banner + chapter-end interstitial + rewarded** |
| 11 | Rewarded reward | **30-minute ad-free token** |
| 12 | Platforms | **Android + iOS + PWA + Windows (Tauri)** |
| 13 | Repo | **New private repo at launch, public later** |
| 14 | v1 scope | **Full parity with PharmaReader** (minus pharma/study/AI) |
| 15 | Formats | Text PDF, EPUB, DOCX, TXT/MD, web article — **no OCR, no DRM** |
| 16 | Brand | **Ink + amber on paper** |

---

## 1. The delta from PharmaReader

### 1.1 Delete

| Path | Why |
|---|---|
| `src/syllabus/**` | NMC MD-Pharmacology topic tree, topic picker, per-topic progress. No analogue for general readers. |
| `src/study/CardEditor.tsx`, `ReviewSession.tsx`, `ReviewPage.tsx`, `study/api.ts` | FSRS flashcard machinery. `ts-fsrs` dependency goes with it. |
| `src/ai/**` (`AiActions`, `AiSettings`, `client`, `tasks`) | AI dropped. |
| `src/tts/lexicon/pharma-lexicon.json` | Drug names, `t½`, `µg`, CYP3A4. Replaced by a general pronunciation lexicon (§2.4). |
| `src/tts/lexicon/drug-respellings.md`, `medical-respellings.md` | Same. |
| `src/import/layout/__fixtures__/*.json` (bjp-p7, katzung-*, nmc-p12, piezo-p28) | Pharma PDFs. Replaced with book fixtures. |
| `src/import/__fixtures__/nmc-md-pharmacology.pdf`, `pharma-hypertension.docx` | Replaced. |
| `src-tauri/` | **KEPT** — Windows stays (decision 12). |
| `src/tts/native/kokoroPlugin.ts` + `android/app/src/main/java/com/aurapharmlab/pharmareader/kokoro/*` | **Rewritten**, not deleted — see §2.3. |

### 1.2 Keep unchanged

`src/import/**` (all extractors, layout detection, segmenter) · `src/reader/**` (reflow +
PDF page view, read-along, selection bar, player bar, audio queue) · `src/tts/**` (engine
interface, player, cache, prerender, Whisper aligner, system TTS, Pocket) · `src/core/**`
(Dexie DB, settings, storage panel, save file, update check) · `src/backup/**` ·
`src/components/**` (tutorial, what's new, install hint, disclosure) · `src/styles.css`
design system (re-tokenised, not rewritten) · `src-tauri/**` · `android/` + `ios/` shells ·
the whole Vitest suite.

### 1.3 Add

| New | Why |
|---|---|
| `src/tts/g2p/**` | Our own GPL-free grapheme→IPA phonemiser (§2.4). |
| `src/tts/kokoro/**` | Vendored fork of `kokoro-js` with espeak removed (§2.5). |
| `src/ads/**` | AdMob wrapper, UMP consent, slot policy, frequency caps, ad-free gating. |
| `src/iap/**` | StoreKit 2 + Play Billing wrappers, entitlement state machine, restore. |
| `src/entitlement/` | Client half of the entitlement backend contract. |
| `android/.../ads/` + `ios/.../Ads/` | Native AdMob/UMP plugin (own Capacitor plugin, §3.1). |
| `ios/` | The Capacitor iOS project — **new**, this is the first iOS shipping target. |
| `packages/kokoro-js/` (in-repo workspace pkg) | Vendored, patched upstream (§2.5). |
| `LICENSE` (Apache-2.0), `NOTICE`, `THIRD_PARTY_LICENSES.md` | §2.6. |
| `docs/STORES.md`, `docs/PRIVACY.md`, `docs/AD_POLICY.md` | §6. |

---

## 2. Licensing — the hard part

This is the reason the app can be Apache-2.0, sold, and ad-supported. It is also the part
most likely to be quietly broken by a dependency bump, so it gets its own CI guard (§7.4).

### 2.1 The GPL problem, stated precisely

Kokoro-82M's **weights** are Apache-2.0 and always were. The GPL-3.0 in PharmaReader came
from **espeak-ng**, the *phonemizer*, which Kokoro needs for grapheme→phoneme conversion:

| Path | espeak? | Status |
|---|---|---|
| `android/app/libs/sherpa-onnx-1.13.8.aar` | bundled | GPL — **must go** |
| `kokoro-js` → `phonemizer` npm → espeak WASM | bundled | GPL — **must go** |
| `kokoro-js` `src/phonemize.js` → `import { phonemize as espeakng } from "phonemizer"` | — | **the single line to remove** |

`kokoro-js` on npm is still `1.2.1` (May 2025) and still depends on `phonemizer`; GitHub
`main` today still has that import. There is no upstream release without espeak.

### 2.2 sherpa-onnx v2 — the native path is now GPL-free

`sherpa-onnx` **v2.0.0** (23 Oct 2026, PR #4055 "Remove espeak-ng and piper-phonemize from
sherpa-onnx") deleted espeak-ng *and* piper-phonemize from the build. Upstream's own words:
*"sherpa-onnx is GPL-free after this PR."*

New text-frontend model:

* **`lexicon`** — built in, no external dependency. sherpa-onnx ships `lexicon-en-us.txt`.
* **`phonemize`** — phonemise outside sherpa-onnx and pass the result in. `misaki` is
  Apache-2.0, `pypinyin` is MIT. `piper-phonemize` is GPL and stays optional.

New API surface (the Kotlin/Java plugin must be rewritten against this):

* `SherpaOnnxGenerationConfig` gains **`phoneme_codepoints`** and **`tokens`**
  (mutually exclusive alternatives to `text`).
* **`data_dir` on TTS model configs is deprecated and ignored** (ABI slot kept).
* **Pocket TTS is now a first-class native model** (`offline-tts-pocket-model-config.cc`)
  — Pocket needs no phonemiser at all.

Also: `sherpa-onnx` v2 adds a **Kokoro WASM build** (`build-wasm-simd-tts.sh`) — relevant
if we ever want one engine everywhere.

**Action:** upgrade `1.13.8.aar` → `2.0.1.aar` (Apache-2.0), rewrite the plugin, switch
the Kokoro frontend from `data_dir` (espeak data) to `lexicon` or externally-supplied
phonemes.

### 2.3 Native engine plan

| Engine | Where | Frontend | Licence |
|---|---|---|---|
| **Kokoro** (English) | Android/iOS via sherpa-onnx 2.0.1 | `lexicon` frontend with `lexicon-en-us.txt` | Apache-2.0 ✅ |
| **Pocket TTS** (all languages) | Android/iOS via sherpa-onnx 2.0.1 | none needed — no phonemiser | MIT code / CC-BY-4.0 weights ✅ |
| **Kokoro** | Web/desktop via vendored fork | our G2P (§2.4) | Apache-2.0 ✅ |
| **Pocket TTS** | Web/desktop via `pocket-tts-js` | none needed | MIT ✅ |
| **System voice** | all | — | OS ✅ |

**Language scope, decided:** native Kokoro becomes **English-only**. Under the old
frontend every non-English Kokoro language (fr/es/hi/it/pt) required espeak-ng, and no
per-language lexicon is published for them — misaki routes them to espeak too.
Non-English native speech is covered by **Pocket TTS**, which needs no phonemiser at
all, and by the OS voice. This is the whole point of the sherpa v2 upgrade: it turns a
GPL-contaminated multi-language engine into a clean English engine plus a clean
multilingual one.

### 2.4 Our own G2P — `src/tts/kokoro/g2p/`

**The lexicon already exists.** sherpa-onnx publishes `lexicon-en-us.txt` (6.305 MB,
sha256 `8b67ae549a465eee78f92ecb74644ad90c3c58ce65f19c68baf85878a10ef73a`) from its
`tts-models` release: 167,907 single-word entries plus 690 multi-word entries, built by
upstream's `build_lexicon.py` from CMUDict (free for any use) plus a proper-noun list.

The decisive property: **the phonemes are already IPA with stress marks**, in the same
style Kokoro was trained on.

```
hello || h ə lˈ oʊ
book  || bˈ ʊ k
read  || ɹˈ iː d
quixote || k iː hˈ oʊ ɾ e ɪ
```

That means:

* **No ARPAbet→IPA table is needed.** The earlier plan assumed CMUdict + a hand-written
  conversion; the sherpa lexicon removes both.
* **One lexicon for both platforms.** The native path passes it to sherpa as the
  `lexicon` frontend; the web path looks words up in the same file. Android and the
  PWA pronounce a book identically, and there is exactly one artefact to fetch,
  version and check.
* **Proper nouns are covered.** `quixote` and `aachen` are in it — precisely the words a
  book reader needs and precisely the words CMUdict alone lacks.

What still has to be built:

1. **The loader** — lazy, parsed once, cached in module scope. The file must not be
   parsed at import time. Measured memory footprint is a reported deliverable.
2. **The OOV fallback** — words absent from the lexicon still have to be pronounced.
   Implement letter-to-sound rules from **NRL Report 7948** (a US government work, so
   public domain) plus a small hand-written table of common English letter and suffix
   patterns.
3. **The inventory constraint** — every emitted phoneme must be inside Kokoro's
   tokenizer vocabulary (`model.vocab` of `onnx-community/Kokoro-82M-v1.0-ONNX`). The
   lexicon certainly contains a few phonemes Kokoro does not know (`ɫ`, `ʔ`). Each one
   is mapped or dropped deliberately, never emitted silently: an unknown token is
   silently skipped by the tokenizer, which is a mispronunciation with no error.
4. **The cache story** — 6.3 MB is over workbox's 5 MB precache limit, so the lexicon is
   a runtime-cached asset, not a precached one.

**Safety net:** the app already has a user-editable pronunciation override table
(`src/tts/lexicon/`). We keep it, re-seed it with literary hard cases (Tolkien,
O'Brien, Cao, Enid, Maeve…) instead of drug names, and surface it as "Pronunciations"
in Settings.

### 2.5 Vendoring kokoro-js

Do **not** publish to npm. Vendor it in-repo as a private workspace package
`packages/kokoro-js/`, pinned to the upstream commit, with:

* `UPSTREAM.md` — upstream URL, commit SHA, and the exact diff we apply.
* `phonemize.js` — the one changed file: `import { phonemize } from "../../src/tts/g2p"`.
* `package.json` — `phonemizer` dependency removed. Apache-2.0 kept, plus upstream NOTICE.
* A CI check that `grep -r "phonemizer" packages/` finds nothing.

This is auditable (`git diff` against upstream is visible), avoids npm publish/registry
churn, and keeps the licence boundary provable.

### 2.6 Licence paperwork

* `LICENSE` — Apache-2.0.
* `NOTICE` — credits PharmaReader (this code's origin), hexgrad/Kokoro, Kyutai/Pocket TTS,
  Xenova/phonemizer's *former* role, CMUdict, and the humans/agents who wrote it.
* `THIRD_PARTY_LICENSES.md` — an inventory of every bundled/downloaded dependency, its
  licence, whether it is bundled in the binary or downloaded at runtime, and whether it
  requires attribution. Modelled on the format used by comparable projects.
* **Relicensing provenance** — PharmaReader is GPL-3.0. The sole copyright holder
  (aswanthwuhan; git history confirms a single author) relicenses the derived work to
  Apache-2.0. Keep a copy of the original GPL-3.0 source alongside the repo (or a tagged
  archive) plus a signed `RELICENSING.md` statement, so the provenance is never in doubt.

### 2.7 Pocket TTS licence specifics

* Code MIT, **weights CC-BY-4.0** → commercial use **allowed with attribution**.
* **Must exclude the non-commercial voices**: `cosette` (Expresso, CC-BY-NC-4.0) and
  `jean` (EARS, CC-BY-NC-4.0). Ship only commercially-safe voices.
* CC-BY-4.0 voices (VCTK-derived `azelma`/`eponine`/`fantine`, `alba`) require visible
  attribution → an About/Credits panel inside the app, not just the README.
* Kyutai's prohibited-use statement: no voice impersonation/cloning without consent. The
  app ships **no voice-cloning UI**.

---

## 3. Monetisation architecture

### 3.1 Ads — AdMob via our own Capacitor plugin

Write our own thin Capacitor plugin wrapping the native Google Mobile Ads SDKs rather than
adding a third-party community plugin. Reasons: the project already writes native
Capacitor plugins (Kokoro, Playback, SystemUi) so the pattern exists; we get exact control
over the request configuration (non-personalised) and the UMP flow; and we avoid a
third-party plugin's own licence and maintenance baggage.

* Android: `com.google.android.gms:play-services-ads` (includes UMP).
* iOS: `GoogleMobileAds` pod (includes `UMPConsentForm`), plus **SKAdNetwork IDs** from
  Google in `Info.plist`.
* **Non-personalised only**: Android `RequestConfiguration.npa = 1`; iOS equivalent via
  the UMP payload. No IDFA → **no ATT prompt, no App Tracking Transparency flow.**
* **UMP consent form** shown before the first ad request in EEA/UK. Note: non-personalised
  is *not* a substitute for consent in the EEA — the consent form still has to run, and
  the privacy policy has to disclose ad storage.

### 3.2 Ad slots and the rules we must not break

| Slot | Placement | Guard |
|---|---|---|
| **Banner** | Library screen only | Never in the reader's reading surface. |
| **Interstitial** | **When the reader finishes a chapter** | Never during playback; never on app open/close; never back-to-back; max 1 per chapter; closeable within 15 s; pre-loaded so it never appears late. |
| **Rewarded** | User-initiated, e.g. "Watch for 30 minutes without ads" | Explicitly opted in → exempt from the interstitial rules. |

Why chapter-end and not "after 2 pages":

* Play *Better Ads Experiences* bans *"ads that appear … during the beginning of a content
  segment"* — which rules out an ad on first TTS playback outright.
* Play *Made for Ads* bans *"an interstitial ad placed after a user action (including but
  not limited to clicks, swipes, etc.) in a consecutive manner"* — a page-turn trigger is a
  swiped action, so every-2-pages is a repeat-offence pattern.
* Play explicitly names the good spot: *"natural breaks in transition, such as at the end
  of the game level or content section… the end of a chapter in an audiobook."*
* Apple: interstitials *"must clearly indicate that they are an ad … and must provide
  easily accessible and visible close/skip buttons"*, and guideline 4.2.2 rejects apps that
  are *"primarily … advertisements"* — so ads must stay a minority of the experience.

Additional rules encoded in `src/ads/policy.ts`: frequency caps, a session max, no ads
while TTS is speaking, no ads for the ad-free purchaser, no ads on the very first
launch (no "beginner banner" per AdMob guidance), and an ad-free token that suppresses
everything for 30 minutes.

### 3.3 "Remove Ads" IAP

* **Product**: one non-consumable, `readit.remove_ads` (₹199 / $2.99 — final price TBD).
* **iOS**: StoreKit 2. Non-consumables are owned by the Apple ID, so restore-across-devices
  comes from the store.
* **Android**: Play Billing Library (current major). Non-consumables are owned by the
  Play account and survive reinstall.
* Both are **non-consumable** and **restorable** — no subscription, no server-side
  subscription state, no licence-server dependency for basic correctness.

### 3.4 Entitlement backend

A tiny service. No accounts, no PII, no book content.

```
POST /entitlement/verify   { platform, productId, receipt|purchaseToken, deviceId, attestation }
  → 200 { token, adFree: true }        signed, short-lived-but-renewable
GET  /entitlement/status?deviceId=…    → { adFree: bool, token }
```

* **Validation**: Apple App Store Server API (sandbox + production) and Google Play
  Developer API `purchases.products.get` (needs a Play **service account** with
  *Financial data* permission in the Play Console).
* **Storage**: Cloudflare **Workers + D1** (SQLite). Cost ≈ $0/month at this scale.
  A single `entitlements(device_id, platform, product_id, receipt_hash, ad_free, created_at)`
  table.
* **Token**: HMAC-signed (or a Worker-issued JWT) so the client can verify offline.
* **Offline behaviour**: the client caches the entitlement token in IndexedDB. If the
  backend is unreachable, the cached token still unlocks ads. The app must never show ads
  to someone who paid because *our server* is down.
* **Anti-abuse**: bind the entitlement to the install via **Play Integrity API** (Android)
  and **App Attest** (iOS). A plain UUID would let anyone reset ads by clearing app data.
* **Restore**: "Restore purchase" re-verifies with the store and re-registers the device.

### 3.5 No AI, so what does a rewarded ad unlock?

A **30-minute ad-free token**. Explicitly opted in, so it is exempt from the interstitial
rules, and it gives the rewarded format a real job now that AI is gone.

---

## 4. Product scope

### 4.1 v1 ships (full parity with PharmaReader minus pharma/study/AI)

Library with cover art and metadata · import PDF/EPUB/DOCX/TXT/MD/web article · reflow
reader + PDF page view with highlight boxes · read-along word highlighting · tap-to-play
from a sentence · highlights / notes / bookmarks · reading progress per book · search ·
typography and both themes · sleep timer · lock-screen and background audio controls ·
audio queue and pre-render · on-device neural voices (Kokoro + Pocket) · Whisper
word-aligner · layout detection at import · backup export/import · PWA · Android · iOS ·
Windows (Tauri) · ads · "Remove Ads" IAP · general pronunciation lexicon.

### 4.2 Out of scope for v1

OCR · DRM / MOBI / AZW3 · AI · cloud sync · accounts · OPDS / online catalogues · social
features · Android Auto / CarPlay · widgets.

### 4.3 Newly-needed product surfaces (not in PharmaReader)

* **Cover art extraction** from EPUB/PDF and manual cover attach — a general library looks
  broken without covers. *(Gap in PharmaReader.)*
* **Book metadata editor** (title/author) — EPUB metadata is often junk. *(Gap.)*
* **TOC / chapter navigation drawer** — exists partly; needs to be first-class for books.
* **"Remove Ads" screen** and the entitlement state machine.
* **Privacy policy, Terms, About/Credits** pages (required by both stores; the Credits
  page now carries the CC-BY-4.0 Pocket TTS attribution).
* **Ad-blocked state** in Settings (ads off / on, consent status, reset consent).

---

## 5. Rebrand

| Item | From | To |
|---|---|---|
| Product name | PharmaReader | **Read IT** (token `ReadIt`) |
| Package id | `com.aurapharmlab.pharmareader` | `app.readit.reader` (needs a domain you control; check both stores for name collisions) |
| Android package dir | `android/app/src/main/java/com/aurapharmlab/pharmareader/` | new package path, all three plugins moved |
| Primary colour | teal `#0f4c5c` | **ink** `#1E2A47` |
| Accent | — | **amber** `#C8811A` (fills) / `#9A5B00` (text-level AA) |
| Light surface | clinical white | **paper** `#FAF7F1` |
| Dark surface | near-black | **night** `#0F1319` |
| Reading font | Literata (SIL OFL 1.1) | keep — OFL is fine, and Literata is the right serif for long reading |

The design-system *structure* in `src/styles.css` and `DESIGN.md` is reused; only the token
values change. Every contrast pair must be re-checked to WCAG 2.2 AA in both themes
(body ≥ 4.5:1, large text ≥ 3:1, UI borders/focus rings ≥ 3:1).

**Icon**: needs a new 1024 px master → Android adaptive icon + iOS icon set. AI-generated
first draft, hand-tuned after.

---

## 6. Store readiness

### 6.1 Apple

* Developer Program membership (paid) + a Mac or macOS CI runner to build.
* App Store Connect record, **IAP product** `readit.remove_ads`, price points.
* **Privacy**: privacy policy URL, nutrition labels, **"Data Used to Track You" = No**,
  App Privacy answers for the ad SDK.
* **4.2 defence** (this app is a WebView app, so plan for it): the review notes must
  explicitly call out what the app does that a website cannot — native document-picker
  import, on-device neural TTS with no network, background audio + lock-screen controls,
  fully offline library, local annotations, backup export. A screen recording showing the
  offline/import/listen flow should be attached.
* SKAdNetwork IDs, `Info.plist` usage strings for the file picker and photo library (cover
  art), ATS settings, export compliance.

### 6.2 Google Play

* Developer account (one-off fee) + **service account** for Play Billing validation.
* **Data safety form**: declare ad data collection and sharing accurately.
* **"Contains ads"** declaration, content rating (IARC), privacy policy URL.
* Target the API level Play currently requires for new apps (check at build time).
* **App Bundle** with **ABI splits** — the sherpa-onnx AAR carries ONNX Runtime for four
  ABIs and is ~50 MB; without splits the download is enormous.
* Tablet and Wear OS declarations, screenshots, store listing copy.

### 6.3 PWA hosting

**Private repo ⇒ GitHub Pages is not available on the free plan.** Host the PWA on
**Cloudflare Pages** (free, deploys from a private repo with an API token) or Netlify.
This is a direct consequence of decision 13 and must not be forgotten.

---

## 7. Repository and CI

### 7.1 Repo

* New repo, **private** at launch → public at store launch. Name TBD after a store
  availability check (`readit` vs `read-it` vs alternatives).
* `LICENSE` (Apache-2.0), `NOTICE`, `THIRD_PARTY_LICENSES.md`, `RELICENSING.md`.
* `README.md`, `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`, `CONTRIBUTORS.md`, `CHANGELOG.md`
  rewritten for Read IT. `docs/` gains `STORES.md`, `PRIVACY.md`, `AD_POLICY.md`.

### 7.2 Workflows

| Workflow | Trigger | Notes |
|---|---|---|
| `ci.yml` | push / PR | pnpm install, typecheck, vitest, web build, native build |
| `pwa.yml` | tag / manual | Cloudflare Pages deploy |
| `android.yml` | tag | signed AAB + APK, keystore in secrets, ABI splits |
| `ios.yml` | tag | macOS runner, `xcodebuild archive` → TestFlight; secrets for the signing cert |
| `licence.yml` | push / PR | **licence guard** (§7.4) |

### 7.3 Existing CI to carry over

`.github/workflows/pages.yml` (retarget to Cloudflare Pages) and the untracked
`.github/workflows/ios-sim.yml` + `scripts/ios-sim/` (promote to a real iOS job).

### 7.4 The licence guard (worth building early)

The entire Apache-2.0 premise rests on no GPL component reaching the binary. A dependency
bump could reintroduce it silently. A CI job that:

1. Enumerates every dependency and downloaded model with its licence
   (`pnpm licenses list --json` + a manifest of model licences).
2. **Fails** if any GPL-family licence (`GPL-2.0`, `GPL-3.0`, `AGPL*`) appears in
   `dependencies`, `optionalDependencies`, or the runtime model manifest.
3. Asserts `packages/kokoro-js` does not import `phonemizer`, and that
   `android/app/libs/` contains no AAR bundling espeak.
4. Writes the inventory into `THIRD_PARTY_LICENSES.md` so it cannot rot.

This turns the licensing work from a one-off into an enforced invariant.

---

## 8. Milestones

Each milestone ends with a runnable, tested build.

| # | Milestone | Done when |
|---|---|---|
| **M0** | Fork & rebrand | Private repo created; Apache-2.0 + NOTICE; package id and app name changed; ink/amber tokens applied; new icon; web build green; all 600+ tests green |
| **M1** | Strip pharma, study and AI | `src/syllabus`, `src/study` cards/review, `src/ai` deleted; pharma lexicon and fixtures replaced with book fixtures and a general pronunciation lexicon; `ts-fsrs` removed; docs rewritten |
| **M2** | **TTS licence clean-up (critical path)** | sherpa-onnx → 2.0.1 (AAR verified: zero espeak/piper artefacts); native plugin rewritten for the `lexicon` frontend and the new `phoneme_codepoints`/`tokens` config; espeak-ng-data deleted at extraction; native Pocket TTS wired; `kokoro-js` vendored and patched; `src/tts/kokoro/g2p` implemented against `lexicon-en-us.txt`; every emitted phoneme proven inside Kokoro's tokenizer vocabulary; **A/B listening test vs espeak on 20 paragraphs of fiction and non-fiction**; `licence.yml` green |
| **M3** | iOS shell | `ios/` project; document-picker import; background audio + lock-screen controls; App Attest; StoreKit 2 scaffolding; SKAdNetwork IDs; builds and runs on device |
| **M4** | Ads | Native AdMob plugin (Android + iOS); UMP consent flow; npa requests; banner + chapter-end interstitial + rewarded; frequency caps; ad-free suppression hooks; offline behaviour (ads fail silently) |
| **M5** | IAP + entitlement | Play Billing + StoreKit 2 purchase flows; Worker + D1 backend validating with Apple/Google; signed entitlement token; offline caching; restore; Play Integrity / App Attest binding |
| **M6** | Store readiness | Privacy policy + terms; data safety form; age rating; screenshots + copy; 4.2 review notes + screen recording; target API; ABI splits; signed AAB; AdMob + Play accounts live |
| **M7** | Ship | Play internal → closed → production; TestFlight → App Store review; PWA live on Cloudflare Pages |
| **M8** | Go public | Repo flipped public with the Apache-2.0 source; CHANGELOG + credits published; announcement |

**M2 is the critical path and the highest technical risk.** Its output — a GPL-free
phonemiser that sounds as good as espeak — gates everything downstream.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Our G2P sounds worse than espeak → users reject the app's core feature | **High** | M2 spike with an A/B listening test *before* committing to the rest. Fallback: ship Pocket TTS as the default voice and treat Kokoro as an upgrade. Phase-2 misaki port if needed. |
| sherpa-onnx v2 API churn breaks the native plugin | High | Rewrite against `2.0.1` in M2; pin the version; the licence CI also pins it |
| Apple rejects a WebView reader under 4.2 | High | Document native capabilities in review notes; attach a screen recording; ensure app-like navigation and offline behaviour |
| A dependency bump reintroduces GPL | Medium | The §7.4 licence guard, wired into CI from M2 |
| Play rejects the target API level or ad declarations | Medium | Check at M6; keep `targetSdk` current in CI |
| Ads never appear because of consent/SDK init failures | Medium | Ads are non-blocking by construction; the reader never waits on them; failures are silent |
| Private repo blocks GitHub Pages | Low | Cloudflare Pages (§6.3) |
| Store name collision on "Read IT" | Low | Availability check before M0; the name is not load-bearing in the code |
| 50 MB AAR × 4 ABIs bloats the download | Medium | App Bundle + ABI splits; consider Play Feature Delivery for the model download (already runtime-downloaded) |
| Entitlement backend down → paying users see ads | Low | Cached signed token works offline; never gate ads on a live server call |
| Reinstall resets ad-free state | Low | Non-consumable purchase is owned by the store account; restore-on-launch + App Attest/Play Integrity binding |

---

## 10. Open items I need decisions or action on

1. **Apple Developer membership** — do you have an account, and a Mac to build on?
   Without both, iOS slips.
2. **AdMob account + app IDs** — must exist before M4 can be tested.
3. **Google Play developer account + service account** for purchase-token validation.
4. **A domain you control** for the privacy-policy URL (and ideally for the package id).
5. **Store name availability check** for "Read IT" — I can run this.
6. **Price points** for "Remove Ads" per market (₹199 / $2.99 default?).
7. **Whether the original GPL-3.0 PharmaReader stays public and untouched** — recommended:
   yes, untouched, with a note in its README pointing to Read IT.
8. **Rewarded-ad token length** — 30 minutes chosen; revisit after launch data.

---

## 11. Licences of everything this app touches

| Component | Licence | Bundled? | Action |
|---|---|---|---|
| Kokoro-82M weights | Apache-2.0 | no (downloaded) | credit |
| `kokoro-js` | Apache-2.0 | yes (vendored) | credit + NOTICE, patch documented |
| `phonemizer` / espeak-ng | Apache-2.0 wrapper / **GPL-3.0** core | **removed** | must not reappear |
| sherpa-onnx 2.0.1 | Apache-2.0 | yes (AAR) | credit |
| Pocket TTS code | MIT | yes | credit |
| Pocket TTS weights | CC-BY-4.0 | no (downloaded) | attribution + exclude NC voices |
| Pocket voices (VCTK, alba) | CC-BY-4.0 | no (downloaded) | in-app attribution |
| Pocket voices (Unmute donations) | CC0 | no (downloaded) | thanks |
| Pocket voices `cosette` (Expresso), `jean` (EARS) | **CC-BY-NC-4.0** | **must not ship** | excluded from the picker; enforced by the licence guard |
| CMU Pronouncing Dictionary | free use | no (data file) | credit |
| NRL Report 7948 | public domain | no | credit |
| sherpa-onnx `lexicon-en-us.txt` | Apache-2.0 (derived from CMUdict + a proper-noun list) | no (runtime asset) | credit |
| `@huggingface/transformers` | Apache-2.0 | yes | credit |
| `pdfjs-dist` | Apache-2.0 | yes | credit |
| `epubjs` | BSD-2-Clause | yes | credit |
| `mammoth` | BSD-2-Clause | yes | credit |
| `dexie` | Apache-2.0 | yes | credit |
| `fflate` | MIT | yes | credit |
| `ts-fsrs` | MIT | **removed** | — |
| `@mozilla/readability` | MPL-2.0 | yes | credit + file-level notices |
| Literata font | SIL OFL 1.1 | yes | credit + OFL text |
| Google Mobile Ads SDK + UMP | proprietary (AdMob ToS) | yes | AdMob account + ToS |
| Apple StoreKit 2 / Google Play Billing | platform terms | yes | store accounts |
