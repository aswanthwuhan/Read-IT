# Read IT — plan and provenance

Read IT is a general, offline ebook reader for books the reader already owns. The
current scope and the shipped feature list live in **[docs/PLAN.md](docs/PLAN.md)**;
this file records where the project came from and the milestones already completed.

## Provenance

Read IT began as a fork of **PharmaReader**, a GPL-3.0 study reader, and was
relicensed to Apache-2.0 by its sole copyright holder. The original GPL work is
preserved so the provenance is verifiable. See:

- [RELICENSING.md](RELICENSING.md) — the relicensing statement
- [NOTICE](NOTICE) — attribution for every bundled component
- [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) — the generated dependency inventory
- [docs/LICENSING-RUNBOOK.md](docs/LICENSING-RUNBOOK.md) — the licence hygiene procedure

No GPL/copyleft code ships in Read IT. The licence guard
(`node scripts/check-licences.mjs`, enforced in CI) makes that a build failure
rather than a review note.

## Completed milestones

| Milestone | Result |
|---|---|
| M0 — Rebrand | App id `app.readit.reader`, Read IT identity, ink+amber design tokens, Apache-2.0 metadata. |
| M1 — Feature surgery | Study, flashcard, syllabus and AI surfaces removed. Library, reader, highlights, notes, bookmarks, progress, import, backup and settings kept. Book-oriented pronunciation lexicon replaces the old domain lexicon. |
| M2 — Licence-clean TTS | Native sherpa-onnx 2.0.1 (GPL-free, lexicon frontend); web Kokoro engine vendored from upstream Apache-2.0 sources with the phonemiser replaced by Read IT's own CMUdict/NRL G2P; Pocket TTS for other languages; non-commercial voices excluded from the picker and synthesis allowlist (pruned runtime asset still pending). Licence guard, typecheck, tests and builds all green. |

## Next (not implemented yet)

- Advertising: AdMob + UMP, non-personalised, with a one-time "Remove Ads" purchase.
- Store submission: private at launch, privacy policy naming the ad SDKs.
- Optional on-device word alignment improvements and an A/B listening comparison
  of the new G2P against the old reference phonemiser.

See [CHANGELOG.md](CHANGELOG.md) for the released version history.
