// The licence guard.
//
// Read IT ships no copyleft code. That is a licence promise, not a preference:
// the app is sold and carries advertising, so the whole point of the Apache-2.0
// relicensing (see RELICENSING.md) is that nothing copyleft reaches the user's
// device. A dependency bump can break that silently, so it is checked here and
// enforced in CI rather than left to review.
//
// Every check below is a hard failure. Run it with `node scripts/check-licences.mjs`.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * Licences that may never appear in the dependency tree, under any branch of a
 * dual licence.
 */
const DENIED = [
  // Strong copyleft. The whole reason this script exists. Packages use both
  // SPDX ("GPL-3.0-or-later") and the older "GPLv3"/"GNU GPL v3" spellings.
  'GPL-1.0',
  'GPL-2.0',
  'GPL-3.0',
  'GPLv1',
  'GPLv2',
  'GPLv3',
  'GPL v3',
  'GNU GPL v3',
  'GNU General Public License',
  'AGPL-1.0',
  'AGPL-3.0',
  'AGPLv3',
  'SSPL-1.0',
  'SSPL',
  // Source-available, not open source.
  'BUSL-1.1',
  'BUSL',
  'Elastic-2.0',
  'Fair',
  'PolyForm',
  'Commons-Clause',
  // Non-commercial. A paid, ad-supported app cannot ship these either.
  'CC-BY-NC-1.0',
  'CC-BY-NC-2.0',
  'CC-BY-NC-3.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC',
  'CC BY NC',
  'CC-BY-NC-ND-4.0',
  'CC-BY-NC-SA-4.0',
  'NOASSERTION',
];

/**
 * Weak copyleft. Not a build failure: LGPL is designed to be combined with
 * permissive licences and does not infect the whole work the way GPL does.
 * It is reported so the choice stays visible.
 */
const WEAK = ['LGPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'MPL-1.0', 'MPL-2.0', 'EPL-1.0', 'EPL-2.0'];

/** A dependency whose licence is not stated is not allowed either. */
const DENIED_MISSING = new Set(['UNKNOWN', 'UNLICENSED', '']);

/**
 * Packages that must never enter the tree under any spelling of their name —
 * the copyleft phonemisers that were removed when this project relicensed.
 */
const DENIED_PACKAGES = /espeak|phonemizer|piper-phonemize|kokoro-js|ts-fsrs/i;

/**
 * Does this licence string permit a non-copyleft use?
 *
 * Dual licences need real handling, not a substring test:
 *   "MIT OR GPL-3.0-or-later"        the MIT branch is enough, so it is fine
 *   "Apache-2.0 AND LGPL-3.0-or-later" both apply, LGPL is weak copyleft, so it is
 *                                     allowed but reported
 *   "GPL-3.0-only"                   not fine
 *
 * @returns {{ ok: boolean, weak: boolean, why: string }}
 */
/** Remove parentheses that wrap the whole expression, so nesting is parsed. */
function stripOuterParens(text) {
  let value = text.trim();
  while (value.startsWith('(') && value.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === '(') depth += 1;
      else if (value[i] === ')') {
        depth -= 1;
        if (depth === 0 && i < value.length - 1) {
          wraps = false;
          break;
        }
      }
    }
    if (!wraps) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

/** Split on an SPDX operator that is outside any parentheses. */
function splitTopLevel(text, operator) {
  const parts = [];
  const needle = ` ${operator} `;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.slice(i, i + needle.length).toUpperCase() === needle) {
      parts.push(text.slice(start, i));
      i += needle.length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function classify(licence) {
  const text = stripOuterParens(licence);
  if (DENIED_MISSING.has(text)) return { ok: false, weak: false, why: 'no stated licence' };

  // SPDX precedence: AND binds tighter than OR. A parenthesised OR inside an
  // AND must not be allowed to satisfy the whole expression.
  const alternatives = splitTopLevel(text, 'OR');
  if (alternatives.length > 1) {
    const results = alternatives.map((part) => classify(part));
    const allowed = results.filter((result) => result.ok).sort((a, b) => Number(a.weak) - Number(b.weak))[0];
    if (allowed) return allowed;
    return { ok: false, weak: false, why: `${text} (every branch is copyleft)` };
  }

  const requirements = splitTopLevel(text, 'AND');
  if (requirements.length > 1) {
    const parts = requirements.map((part) => classify(part));
    const bad = parts.find((part) => !part.ok);
    if (bad) return { ok: false, weak: false, why: bad.why };
    const weak = parts.some((part) => part.weak);
    return { ok: true, weak, why: weak ? `${text} (weak copyleft applies)` : text };
  }

  const denied = DENIED.find((d) => {
    const pattern = d.replace(/[-.]/g, '[-.]?');
    return new RegExp(`(^|[^a-z])${pattern}([^0-9a-z]|$)`, 'i').test(text);
  });
  if (denied) return { ok: false, weak: false, why: `${text} (${denied} is not allowed)` };

  const weak = WEAK.some((w) => {
    const pattern = w.replace(/[-.]/g, '[-.]?');
    return new RegExp(`(^|[^a-z])${pattern}([^0-9a-z]|$)`, 'i').test(text);
  });
  if (weak) return { ok: true, weak: true, why: `${text} (weak copyleft)` };

  return { ok: true, weak: false, why: text };
}

/**
 * The sherpa-onnx Android archive must be at least this version. Before 2.0.0
 * it bundled espeak-ng, which is GPL-3.0 (upstream PR #4055 removed it).
 */
const MIN_SHERPA_VERSION = '2.0.1';

/**
 * Pocket TTS voices that are non-commercial and must never be offered or
 * fetched. `cosette` is Expresso and `jean` is EARS, both CC-BY-NC-4.0:
 * https://huggingface.co/kyutai/tts-voices
 */
const FORBIDDEN_VOICES = ['cosette', 'jean'];

const failures = [];
const weakCopyleft = [];
const fail = (msg) => failures.push(msg);

// ---------------------------------------------------------------------------
// 1. Dependency licences
// ---------------------------------------------------------------------------

/** @returns {Record<string, {name: string, versions: string[], license: string}[]>} */
function readLicences(prod) {
  const args = ['licenses', 'list', '--json'];
  if (prod) args.push('--prod');
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  // Windows cannot spawn a .cmd without a shell (Node's CVE-2024-27980 fix),
  // and the arguments here are internal constants, never user input.
  const out = execFileSync(pnpm, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  const parsed = JSON.parse(out);
  const flat = [];
  for (const [licence, entries] of Object.entries(parsed)) {
    for (const entry of entries) {
      flat.push({
        name: entry.name,
        versions: entry.versions ?? [],
        license: (entry.license ?? licence ?? '').toString(),
        homepage: entry.homepage ?? '',
        description: entry.description ?? '',
      });
    }
  }
  return flat;
}

let allDeps = [];
let prodDeps = [];
try {
  allDeps = readLicences(false);
  prodDeps = readLicences(true);
} catch (err) {
  fail(`could not read the dependency licences: ${err.message}`);
}

const seen = new Set();
for (const dep of [...allDeps, ...prodDeps]) {
  const key = `${dep.name}@${dep.versions.join(',')}`;
  if (seen.has(key)) continue;
  seen.add(key);

  // Some packages declare a permissive licence while embedding copyleft code.
  // `phonemizer` is the known case: it declares Apache-2.0 but ships espeak-ng
  // (GPL-3.0) as WebAssembly. A licence deny-list cannot see that, so these
  // names are banned outright.
  if (DENIED_PACKAGES.test(dep.name)) {
    fail(`${dep.name}@${dep.versions.join(',')} is a banned copyleft phonemiser / removed dependency`);
    continue;
  }

  const licence = dep.license.trim();
  const verdict = classify(licence);
  if (!verdict.ok) {
    fail(`${dep.name}@${dep.versions.join(',')} is ${verdict.why}`);
  } else if (verdict.weak) {
    weakCopyleft.push(`${dep.name}@${dep.versions.join(',')} - ${verdict.why}`);
  }
}

// ---------------------------------------------------------------------------
// 2. No espeak-ng anywhere in the source or the build scripts
// ---------------------------------------------------------------------------

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx', '.cjs', '.java', '.gradle', '.json', '.rs']);
const CODE_SKIP = new Set(['node_modules', '.git', 'dist', '.tmp', 'target', 'build', '.impeccable', 'public']);

const ESPEAK_PATTERNS = [
  /from\s+['"]phonemizer['"]/,
  /require\(\s*['"]phonemizer['"]/,
  /from\s+['"]@?[^'"]*espeak[^'"]*['"]/,
  /espeak-ng-data/,
  /\bespeakng\b/,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (CODE_SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

for (const file of walk(root)) {
  const ext = file.slice(file.lastIndexOf('.'));
  if (!CODE_EXT.has(ext)) continue;
  // The licence docs and the guard itself name espeak on purpose.
  const rel = relative(root, file).replace(/\\/g, '/');
  if (rel.startsWith('docs/') || rel === 'THIRD_PARTY_LICENSES.md' || rel === 'NOTICE') continue;
  // This script names the patterns it looks for, so it would always match itself.
  if (rel === 'scripts/check-licences.mjs') continue;
  // Temporary staging copies of upstream sources, kept only until the port is
  // finished. They are deleted once the vendored copy is in place.
  if (rel.includes('/upstream/')) continue;
  const text = readFileSync(file, 'utf8');
  for (const pattern of ESPEAK_PATTERNS) {
    if (pattern.test(text)) {
      fail(`${rel} still references espeak-ng (${pattern})`);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The sherpa-onnx archive is new enough to be GPL-free
// ---------------------------------------------------------------------------

const fetchScript = join(root, 'scripts', 'fetch-android-libs.mjs');
if (existsSync(fetchScript)) {
  const text = readFileSync(fetchScript, 'utf8');
  const match = text.match(/sherpa-onnx-(\d+\.\d+\.\d+)\.aar/);
  if (!match) {
    fail('scripts/fetch-android-libs.mjs does not pin a sherpa-onnx archive');
  } else if (compareVersions(match[1], MIN_SHERPA_VERSION) < 0) {
    fail(
      `sherpa-onnx ${match[1]} is pinned; ${MIN_SHERPA_VERSION} or newer is required ` +
        '(versions before 2.0.0 bundle espeak-ng, which is GPL-3.0)',
    );
  }
} else {
  fail('scripts/fetch-android-libs.mjs is missing');
}

const libsDir = join(root, 'android', 'app', 'libs');
if (existsSync(libsDir)) {
  for (const name of readdirSync(libsDir)) {
    const match = name.match(/^sherpa-onnx-(\d+\.\d+\.\d+)\.aar$/);
    if (match && compareVersions(match[1], MIN_SHERPA_VERSION) < 0) {
      fail(`android/app/libs/${name} is older than ${MIN_SHERPA_VERSION} and bundles espeak-ng`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. No non-commercial Pocket voices
// ---------------------------------------------------------------------------

const voicesFile = join(root, 'src', 'tts', 'neural', 'pocketVoices.ts');
if (existsSync(voicesFile)) {
  const text = readFileSync(voicesFile, 'utf8');
  // Only the id list matters: the file's comment names the excluded voices on
  // purpose, to explain why they are gone.
  const list = text.match(/const\s+NAMES\s*=\s*\[([^\]]*)\]/);
  if (!list) {
    fail('src/tts/neural/pocketVoices.ts no longer has a NAMES list');
  } else {
    for (const voice of FORBIDDEN_VOICES) {
      if (new RegExp(`['"\`]${voice}['"\`]`).test(list[1])) {
        fail(`the Pocket voice "${voice}" is CC-BY-NC-4.0 (non-commercial) and must not ship`);
      }
    }
  }
} else {
  fail('src/tts/neural/pocketVoices.ts is missing');
}

// ---------------------------------------------------------------------------
// 5. Rewrite the generated dependency table
// ---------------------------------------------------------------------------

const TABLE_START = '<!-- BEGIN GENERATED: dependencies -->';
const TABLE_END = '<!-- END GENERATED: dependencies -->';
const inventoryFile = join(root, 'THIRD_PARTY_LICENSES.md');

if (existsSync(inventoryFile)) {
  const byLicence = new Map();
  for (const dep of prodDeps) {
    const list = byLicence.get(dep.license) ?? [];
    list.push(dep);
    byLicence.set(dep.license, list);
  }
  const rows = [];
  for (const licence of [...byLicence.keys()].sort()) {
    for (const dep of byLicence.get(licence).sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push(`| \`${dep.name}\` | ${dep.versions.join(', ')} | ${licence} |`);
    }
  }
  const table = [
    TABLE_START,
    '',
    '<!-- Written by scripts/check-licences.mjs. Do not edit by hand. -->',
    '',
    '| Package | Version | Licence |',
    '|---|---|---|',
    ...rows,
    '',
    TABLE_END,
  ].join('\n');

  const text = readFileSync(inventoryFile, 'utf8');
  const start = text.indexOf(TABLE_START);
  const end = text.indexOf(TABLE_END);
  if (start === -1 || end === -1) {
    fail('THIRD_PARTY_LICENSES.md is missing the generated dependency markers');
  } else {
    const next = `${text.slice(0, start)}${table}${text.slice(end + TABLE_END.length)}`;
    if (next !== text) writeFileSync(inventoryFile, next);
  }
} else {
  fail('THIRD_PARTY_LICENSES.md is missing');
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

if (failures.length > 0) {
  console.error('licence check FAILED\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nRead IT ships no copyleft code. See RELICENSING.md and docs/LICENSING-RUNBOOK.md.');
  process.exit(1);
}

if (weakCopyleft.length > 0) {
  console.log('weak copyleft in the tree (allowed, reported so the choice stays visible):');
  for (const w of weakCopyleft) console.log(`  - ${w}`);
}

console.log(`licence check passed: ${prodDeps.length} production dependencies, no copyleft, no espeak-ng.`);
