# Relicensing statement

**From:** GNU General Public License, Version 3.0 only (`GPL-3.0-only`)
**To:** Apache License, Version 2.0 (`Apache-2.0`)
**Original work:** PharmaReader — https://github.com/aswanthwuhan/pharmareader
**Derivative work:** Read IT — this repository
**Date:** 2026-11-15
**Copyright holder:** Dr. Aswanth Krishnan (`aswanthwuhan`)

---

## 1. Facts

1. PharmaReader was authored and published under `GPL-3.0-only` by
   Dr. Aswanth Krishnan, who is the sole holder of copyright in it.
2. The commit history of the upstream repository contains commits from exactly one
   human author. The other credited contributors were AI systems (DeepSeek V4.1
   Flash, Claude Opus) acting as tools under the copyright holder's direction;
   AI-generated output is not a separate copyright holder and is owned by the
   person who commissioned and controlled it.
3. Section 5 of the GPL-3.0 permits the copyright holder to license the work
   under different terms. Section 7 and the GPL's own FAQ confirm that only the
   copyright holder may grant such an exception, and that the holder may license
   the same work under multiple terms simultaneously.
4. Read IT is a derivative of PharmaReader. The original GPL-3.0 source of
   PharmaReader is preserved unmodified at the upstream repository and at the
   `pharmareader-v0.4.1` tag, so the provenance of this work is verifiable from
   either direction.

## 2. The relicensing

As the sole copyright holder of PharmaReader, the holder hereby relicenses the
work — in its original form and in all modified versions, including the versions
contained in this repository — under the Apache License, Version 2.0.

The GPL-3.0 licensed copy at the upstream repository remains available and
unmodified under `GPL-3.0-only`. Nothing in this statement revokes it.

## 3. Why

PharmaReader is a free, offline study tool and GPL-3.0 was the right licence for
it. Read IT is a different product with a different purpose — a general-purpose
ebook reader that is distributed through the Apple App Store and Google Play,
carries advertising, and sells a one-time "Remove Ads" purchase.

GPL-3.0 requires that every distributed binary be accompanied by its complete
corresponding source and that every recipient receive the right to copy, modify
and redistribute it. A user who buys the app can therefore fork it, strip the
ads, and publish the result for free, which is incompatible with the way Read IT
pays for itself. Apache-2.0 permits commercial use, does not impose a source
disclosure obligation on the distributed binary, and adds an express patent
grant, which suits a product shipped through app stores.

## 4. What this statement does not do

* It does not claim that any third-party component changed licence.
* It does not grant any licence over trademarks, product names or other rights
  not held by the copyright holder.
* It is not legal advice. Anyone redistributing this software should satisfy
  themselves that the facts above hold for their own use.

## 5. Third-party components

The relicensing covers this project's own code only. Every bundled and every
runtime-downloaded third-party component keeps its own licence, listed with its
exact terms in `THIRD_PARTY_LICENSES.md` and `NOTICE`. In particular, the
dependency inventory is enforced in CI by `.github/workflows/licence.yml`, which
fails the build if any copyleft component reappears in the dependency tree or in
the prebuilt Android archive.
