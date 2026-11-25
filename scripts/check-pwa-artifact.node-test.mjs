import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { normalizeBase, validatePwaArtifact, writeSha256Sums } from './check-pwa-artifact.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifact(t, options = {}) {
  const base = options.base ?? '/Read-IT/';
  const directory = mkdtempSync(join(tmpdir(), 'readit-pwa-artifact-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const index = [
    '<!doctype html>',
    `<link href="${base}manifest.webmanifest" rel="manifest">`,
    `<script type="module" src="${base}assets/app.js"></script>`,
    `<link rel="stylesheet" href="${base}assets/app.css">`,
    '<div id="root"></div>',
    '',
  ].join('\n');
  const files = {
    'index.html': index,
    '404.html': index,
    'manifest.webmanifest': JSON.stringify({
      name: 'Read IT',
      start_url: base,
      scope: base,
      icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    }),
    'sw.js': [
      `precacheAndRoute([{url:"index.html",revision:null},{url:"assets/app.js",revision:null},{url:"assets/app.css",revision:null}]);`,
      `createHandlerBoundToURL("${base}index.html");`,
      '',
    ].join('\n'),
    'assets/app.js': `navigator.serviceWorker.register("${base}sw.js", { scope: "${base}" });\n`,
    'assets/app.css': `body { background-image: url("${base}fonts/readit.woff2"); }\n`,
    'fonts/readit.woff2': 'font-fixture',
    'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    ...options.files,
  };

  for (const [file, contents] of Object.entries(files)) {
    const path = join(directory, ...file.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  }
  return { directory, distDir: directory, base, files };
}

test('base paths must be canonical absolute paths with a trailing slash', () => {
  assert.equal(normalizeBase('/Read-IT/'), '/Read-IT/');
  assert.equal(normalizeBase('/'), '/');
  for (const base of ['', 'Read-IT/', '/Read-IT', 'https://example.com/', '/Read//IT/', '/Read IT/', '/Read-IT/?x=1']) {
    assert.throws(() => normalizeBase(base), undefined, base);
  }
});

test('a valid Pages artifact passes and gets deterministic SHA-256SUMS', async (t) => {
  const fixture = artifact(t);
  const report = await validatePwaArtifact(fixture);

  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.fileCount, 8);

  const sumsPath = await writeSha256Sums(fixture.directory);
  const first = readFileSync(sumsPath, 'utf8');
  const lines = first.trimEnd().split('\n');
  assert.equal(lines.length, 8);
  assert.equal(new Set(lines.map((line) => line.slice(0, 64))).size, 7, 'index and 404 intentionally share bytes');
  for (const line of lines) {
    const [digest, file] = line.split('  ');
    assert.equal(digest, sha256(readFileSync(join(fixture.directory, ...file.split('/')))));
  }
  const checksumPaths = lines.map((line) => line.split('  ')[1]);
  assert.deepEqual([...checksumPaths].sort(), checksumPaths, 'checksum paths must be sorted');

  await writeSha256Sums(fixture.directory);
  assert.equal(readFileSync(sumsPath, 'utf8'), first, 'rerunning must not hash the old sums file');
  assert.equal(existsSync(join(fixture.directory, 'SHA-256SUMS')), true);
});

test('a root-base native/PWA artifact is accepted without requiring a sub-path', async (t) => {
  const fixture = artifact(t, { base: '/' });
  const report = await validatePwaArtifact(fixture);
  assert.equal(report.ok, true, report.errors.join('\n'));
});

test('manifest scope and start_url must exactly match the requested base', async (t) => {
  const fixture = artifact(t);
  writeFileSync(
    join(fixture.directory, 'manifest.webmanifest'),
    JSON.stringify({ start_url: '/', scope: '/', icons: [] }),
  );
  const report = await validatePwaArtifact(fixture);
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /scope must be exactly \/Read-IT\//);
  assert.match(report.errors.join('\n'), /start_url must be exactly \/Read-IT\//);
});

test('Pages HTML, CSS, JS and precache entries cannot use root-base asset URLs', async (t) => {
  const fixture = artifact(t, {
    files: {
      'index.html': '<link rel="manifest" href="/Read-IT/manifest.webmanifest"><script type="module" src="/assets/app.js"></script>',
      '404.html': '<link rel="manifest" href="/Read-IT/manifest.webmanifest"><script type="module" src="/assets/app.js"></script>',
      'assets/app.css': 'body { background: url("/fonts/root.woff2"); }',
      'assets/app.js': 'const rootAsset = "/assets/root.js"; navigator.serviceWorker.register("/Read-IT/sw.js", { scope: "/Read-IT/" });',
      'sw.js': 'precacheAndRoute([{url:"/assets/app.js",revision:null}]); createHandlerBoundToURL("/Read-IT/index.html");',
    },
  });
  const report = await validatePwaArtifact(fixture);
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /index\.html: URL "\/assets\/app\.js" is outside/);
  assert.match(report.errors.join('\n'), /assets\/app\.css: URL "\/fonts\/root\.woff2" is outside/);
  assert.match(report.errors.join('\n'), /assets\/app\.js: root-base asset URL/);
  assert.match(report.errors.join('\n'), /sw\.js precache: URL "\/assets\/app\.js" is outside/);
});

test('404.html is required and must be the exact app shell', async (t) => {
  const missing = artifact(t);
  rmSync(join(missing.directory, '404.html'));
  const missingReport = await validatePwaArtifact(missing);
  assert.equal(missingReport.ok, false);
  assert.match(missingReport.errors.join('\n'), /missing required artifact: 404\.html/);

  const different = artifact(t, { files: { '404.html': '<h1>Not found</h1>' } });
  const differentReport = await validatePwaArtifact(different);
  assert.equal(differentReport.ok, false);
  assert.match(differentReport.errors.join('\n'), /404\.html must be byte-identical/);
});

test('the application bundle must register the exact service-worker URL and scope', async (t) => {
  const missing = artifact(t, { files: { 'assets/app.js': 'console.log("no worker registration");' } });
  const missingReport = await validatePwaArtifact(missing);
  assert.equal(missingReport.ok, false);
  assert.match(missingReport.errors.join('\n'), /no service-worker registration for \/Read-IT\/sw\.js/);

  const wrongScope = artifact(t, {
    files: { 'assets/app.js': 'navigator.serviceWorker.register("/sw.js", { scope: "/" });' },
  });
  const wrongReport = await validatePwaArtifact(wrongScope);
  assert.equal(wrongReport.ok, false);
  assert.match(wrongReport.errors.join('\n'), /no service-worker registration/);
  assert.match(wrongReport.errors.join('\n'), /scope is not exactly/);

  const injected = artifact(t, { files: { 'registerSW.js': 'navigator.serviceWorker.register("/Read-IT/sw.js");' } });
  const injectedReport = await validatePwaArtifact(injected);
  assert.equal(injectedReport.ok, false);
  assert.match(injectedReport.errors.join('\n'), /auto-injected service-worker registration/);
});

test('development URLs and Vite development modules are rejected', async (t) => {
  const fixture = artifact(t, {
    files: {
      'assets/app.js': [
        'navigator.serviceWorker.register("/Read-IT/sw.js", { scope: "/Read-IT/" });',
        'fetch("http://localhost:5173/@vite/client");',
        '',
      ].join('\n'),
    },
  });
  const report = await validatePwaArtifact(fixture);
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /development URL/);
  assert.match(report.errors.join('\n'), /Vite development module/);
});

test('private filesystem and repository paths are rejected', async (t) => {
  const fixture = artifact(t, {
    files: {
      'assets/app.js': [
        'navigator.serviceWorker.register("/Read-IT/sw.js", { scope: "/Read-IT/" });',
        'const windowsPath = "C:\\Users\\example\\secret\\book.pdf";',
        'const linuxPath = "/home/runner/work/Read-IT/private.txt";',
        'const repoPath = "/.git/config";',
        'const sharePath = "\\\\fileserver\\\\private\\\\book.pdf";',
        '',
      ].join('\n'),
    },
  });
  const report = await validatePwaArtifact(fixture);
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /private Windows path/);
  assert.match(report.errors.join('\n'), /private user path/);
  assert.match(report.errors.join('\n'), /private repository path/);
  assert.match(report.errors.join('\n'), /private network share/);
});

test('source map payloads and inline maps are rejected', async (t) => {
  const mapFile = artifact(t, { files: { 'assets/app.js.map': '{"version":3}' } });
  const mapReport = await validatePwaArtifact(mapFile);
  assert.equal(mapReport.ok, false);
  assert.match(mapReport.errors.join('\n'), /source map files must not be shipped/);

  const inline = artifact(t, {
    files: {
      'assets/app.js': [
        'navigator.serviceWorker.register("/Read-IT/sw.js", { scope: "/Read-IT/" });',
        '//# sourceMappingURL=data:application/json;base64,e30=',
        '',
      ].join('\n'),
    },
  });
  const inlineReport = await validatePwaArtifact(inline);
  assert.equal(inlineReport.ok, false);
  assert.match(inlineReport.errors.join('\n'), /inline source maps must not be shipped/);
});

test('a dangling upstream sourceMappingURL is visible but does not ship a map', async (t) => {
  const fixture = artifact(t, {
    files: {
      'assets/app.js': [
        'navigator.serviceWorker.register("/Read-IT/sw.js", { scope: "/Read-IT/" });',
        '//# sourceMappingURL=missing.map',
        '',
      ].join('\n'),
    },
  });
  const report = await validatePwaArtifact(fixture);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.match(report.warnings.join('\n'), /dangling sourceMappingURL missing\.map/);
});

test('model weights, ORT and lexicon assets cannot enter the precache', async (t) => {
  const fixture = artifact(t, {
    files: {
      'sw.js': [
        'precacheAndRoute([',
        '{url:"models/model.onnx",revision:null},',
        '{url:"ort/ort-wasm-simd-threaded.jsep.wasm",revision:null},',
        '{url:"lexicon/en-us.tsv",revision:null},',
        '{url:"index.html",revision:null}',
        ']);',
        'createHandlerBoundToURL("/Read-IT/index.html");',
        '',
      ].join('\n'),
    },
  });
  const report = await validatePwaArtifact(fixture);
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /model weight .*model\.onnx/);
  assert.match(report.errors.join('\n'), /ORT runtime .*ort-wasm/);
  assert.match(report.errors.join('\n'), /lexicon asset .*en-us\.tsv/);
});

test('runtime ORT and lexicon files may ship outside the precache', async (t) => {
  const fixture = artifact(t, {
    files: {
      'ort/ort.min.mjs': 'export const runtime = true;',
      'lexicon/en-us.tsv': 'word\tphonemes',
    },
  });
  const report = await validatePwaArtifact(fixture);
  assert.equal(report.ok, true, report.errors.join('\n'));
});

test('a malformed or missing precache manifest and wrong fallback are rejected', async (t) => {
  const missing = artifact(t, { files: { 'sw.js': 'self.skipWaiting();' } });
  const missingReport = await validatePwaArtifact(missing);
  assert.equal(missingReport.ok, false);
  assert.match(missingReport.errors.join('\n'), /no literal Workbox precache manifest/);

  const wrongFallback = artifact(t, {
    files: { 'sw.js': 'precacheAndRoute([{url:"index.html",revision:null}]); createHandlerBoundToURL("/index.html");' },
  });
  const fallbackReport = await validatePwaArtifact(wrongFallback);
  assert.equal(fallbackReport.ok, false);
  assert.match(fallbackReport.errors.join('\n'), /navigation fallback must use \/Read-IT\/index\.html/);
});

test('validation failures do not create a checksum file', async (t) => {
  const fixture = artifact(t, { files: { '404.html': 'wrong shell' } });
  const report = await validatePwaArtifact(fixture);
  assert.equal(report.ok, false);
  assert.equal(existsSync(join(fixture.directory, 'SHA-256SUMS')), false);
});
