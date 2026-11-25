#!/usr/bin/env node
// Validate the deployable PWA before CI uploads it. This script is deliberately
// dependency-free: it runs with the same Node 24 toolchain as the build.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUMS_FILE = 'SHA-256SUMS';
const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.map', '.mjs', '.svg', '.txt', '.webmanifest', '.xml',
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeBase(base) {
  if (typeof base !== 'string' || base.length === 0) {
    throw new Error('--base must be a non-empty absolute path');
  }
  if (
    !base.startsWith('/') ||
    !base.endsWith('/') ||
    base.includes('\\') ||
    base.includes('//') ||
    base.includes('?') ||
    base.includes('#')
  ) {
    throw new Error('--base must be an absolute path with a trailing slash, for example /Read-IT/');
  }
  const parsed = new URL(base, 'https://artifact.invalid');
  if (parsed.origin !== 'https://artifact.invalid' || parsed.pathname !== base) {
    throw new Error('--base must be a canonical absolute path without spaces or URL escapes');
  }
  return base;
}

async function listArtifactFiles(distDir) {
  const root = resolve(distDir);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new Error(`artifact path is not a directory: ${root}`);

  const files = [];
  async function walk(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const artifactPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`artifact must not contain symbolic links: ${artifactPath}`);
      }
      if (entry.isDirectory()) {
        await walk(fullPath, artifactPath);
      } else if (entry.isFile()) {
        files.push(artifactPath);
      } else {
        throw new Error(`artifact contains an unsupported file type: ${artifactPath}`);
      }
    }
  }

  await walk(root);
  files.sort();
  return { root, files };
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function writeSha256Sums(distDir, files) {
  const root = resolve(distDir);
  const artifactFiles = files ?? (await listArtifactFiles(root)).files;
  const lines = [];
  for (const artifactPath of artifactFiles) {
    if (artifactPath === SUMS_FILE) continue;
    const digest = await hashFile(join(root, ...artifactPath.split('/')));
    lines.push(`${digest}  ${artifactPath}\n`);
  }
  const sumsPath = join(root, SUMS_FILE);
  await writeFile(sumsPath, lines.join(''), 'utf8');
  return sumsPath;
}

function localUrlStatus(value, base) {
  const trimmed = value.trim();
  if (
    trimmed === '' ||
    trimmed.startsWith('#') ||
    /^(?:data|blob|mailto|tel|javascript):/i.test(trimmed)
  ) {
    return { kind: 'ignored' };
  }

  let url;
  try {
    url = new URL(trimmed, `https://artifact.invalid${base}`);
  } catch {
    return { kind: 'invalid', value: trimmed };
  }
  if (url.origin !== 'https://artifact.invalid') return { kind: 'external' };
  if (!url.pathname.startsWith(base)) return { kind: 'outside-base', value: trimmed };

  let path;
  try {
    path = decodeURIComponent(url.pathname.slice(base.length));
  } catch {
    return { kind: 'invalid', value: trimmed };
  }
  if (path.startsWith('/') || path.split('/').includes('..')) {
    return { kind: 'outside-base', value: trimmed };
  }
  return { kind: 'local', path };
}

function checkLocalUrl(value, base, file, errors) {
  const status = localUrlStatus(value, base);
  if (status.kind === 'outside-base') {
    errors.push(`${file}: URL ${JSON.stringify(status.value)} is outside the exact base ${base}`);
  } else if (status.kind === 'invalid') {
    errors.push(`${file}: invalid local URL ${JSON.stringify(status.value)}`);
  }
}

function htmlAttribute(tag, name) {
  const attribute = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return attribute?.[2] ?? null;
}

function checkIndexBase(indexText, base, errors) {
  const tags = indexText.match(/<(?:link|script)\b[^>]*>/gi) ?? [];
  const manifestHrefs = tags
    .filter((tag) => /^<link\b/i.test(tag) && htmlAttribute(tag, 'rel')?.toLowerCase() === 'manifest')
    .map((tag) => htmlAttribute(tag, 'href'));
  if (!manifestHrefs.includes(`${base}manifest.webmanifest`)) {
    errors.push(`index.html: manifest link must be exactly ${base}manifest.webmanifest`);
  }

  const moduleScripts = tags.filter(
    (tag) => /^<script\b/i.test(tag) && htmlAttribute(tag, 'type')?.toLowerCase() === 'module',
  );
  if (!moduleScripts.some((tag) => htmlAttribute(tag, 'src')?.startsWith(`${base}assets/`))) {
    errors.push(`index.html: no module script uses the exact asset base ${base}`);
  }
}

function checkHtmlAndCss(text, file, base, errors) {
  if (extname(file) === '.html') {
    const urlAttributes = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
    for (const match of text.matchAll(urlAttributes)) {
      checkLocalUrl(match[2], base, file, errors);
    }
  }
  if (extname(file) === '.html' || extname(file) === '.css') {
    const cssUrls = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
    for (const match of text.matchAll(cssUrls)) {
      checkLocalUrl(match[2], base, file, errors);
    }
  }
}

function checkRootAssetLiterals(text, file, base, errors) {
  if (base === '/' || extname(file) !== '.js') return;
  const serviceWorkerRuntime = file === 'sw.js' || /^workbox-.*\.js$/.test(file);
  // Workbox intentionally matches the runtime paths /ort/ and /lexicon/ inside
  // its service worker. Every other emitted root asset literal is a base bug.
  const directories = serviceWorkerRuntime ? 'assets|fonts|pdfjs' : 'assets|fonts|pdfjs|ort|lexicon';
  const rootLiteral = new RegExp(`(["'\`])(/(?:${directories})/[^"'\`\\s)]*)\\1`, 'g');
  for (const match of text.matchAll(rootLiteral)) {
    errors.push(`${file}: root-base asset URL ${JSON.stringify(match[2])} must start with ${base}`);
  }
}

function findPrivateNetworkShare(text) {
  // Source bundles represent backslashes as escapes, while a real UNC path is
  // literal. Accept both, but ignore Unicode-range regexes such as \u00C0-\u00D6.
  const candidate = /\\{2,}(?:[A-Za-z0-9.-]+)\\+(?:[^\\\s"'`<>]+\\+)+[^\\\s"'`<>\\]+\.[A-Za-z0-9]{1,8}/g;
  for (const match of text.matchAll(candidate)) {
    if (!/\\u[0-9a-f]{4}/i.test(match[0])) return match[0];
  }
  return null;
}

function checkTextArtifacts(textFiles, fileSet, warnings, errors) {
  const checks = [
    {
      pattern: /(?:(?:https?|wss?):)?\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?=\/|$)/i,
      message: 'development URL',
    },
    { pattern: /\/@(?:vite\/client|react-refresh|id|fs)(?:\/|\b)/, message: 'Vite development module' },
    { pattern: /\bimport\.meta\.hot\b/, message: 'Vite development HMR API' },
    {
      pattern: /\b[A-Za-z]:\\(?:Users|Windows|Program Files(?: \(x86\))?)\\[^\s"'`<>]+/,
      message: 'private Windows path',
    },
    {
      pattern: /\b[A-Za-z]:\/(?:Users|Windows|Program Files(?: \(x86\))?)\/[^\s"'`<>]+/,
      message: 'private Windows path',
    },
    {
      pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+\/(?:Documents|Desktop|Downloads|projects?|repos(?:itories)?|src|work|workspace|workspaces|code|dev)(?:\/|$)/,
      message: 'private user path',
    },
    { pattern: /\bfile:\/\/\/(?:Users|home|tmp|var|private)\//i, message: 'private file URL' },
    {
      pattern: /(?:^|["'`])\/(?:\.git|\.github|node_modules|src|src-tauri|android|scripts)\//,
      message: 'private repository path',
    },
  ];

  for (const [file, text] of textFiles) {
    if (extname(file) === '.map') {
      errors.push(`${file}: source map files must not be shipped`);
      continue;
    }
    for (const check of checks) {
      const match = check.pattern.exec(text);
      if (match) errors.push(`${file}: contains ${check.message} ${JSON.stringify(match[0])}`);
    }
    const networkShare = findPrivateNetworkShare(text);
    if (networkShare) {
      errors.push(`${file}: contains private network share ${JSON.stringify(networkShare)}`);
    }

    const sourceMap = /sourceMappingURL\s*=\s*([^\s*]+)/.exec(text);
    if (!sourceMap) continue;
    const target = sourceMap[1];
    if (target.startsWith('data:')) {
      errors.push(`${file}: inline source maps must not be shipped`);
      continue;
    }
    let targetPath;
    try {
      const targetUrl = new URL(target, `https://artifact.invalid/${file}`);
      targetPath = decodeURIComponent(targetUrl.pathname).replace(/^\//, '');
    } catch {
      warnings.push(`${file}: sourceMappingURL target could not be resolved: ${target}`);
      continue;
    }
    if (fileSet.has(targetPath)) {
      errors.push(`${file}: sourceMappingURL ships the source map ${targetPath}`);
    } else {
      // Some vendored runtimes retain an upstream comment without shipping the
      // map. It exposes no source, but keep the dangling reference visible.
      warnings.push(`${file}: dangling sourceMappingURL ${target} (no map file shipped)`);
    }
  }
}

function extractPrecacheUrls(swText) {
  const marker = 'precacheAndRoute(';
  const markerIndex = swText.indexOf(marker);
  if (markerIndex < 0) return null;
  let index = markerIndex + marker.length;
  while (/\s/.test(swText[index] ?? '')) index += 1;
  if (swText[index] !== '[') return null;

  const start = index + 1;
  const stack = [];
  let quote = null;
  let escaped = false;
  for (; index < swText.length; index += 1) {
    const character = swText[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '[' || character === '{') {
      stack.push(character);
    } else if (character === ']' || character === '}') {
      stack.pop();
      if (stack.length === 0) {
        const urls = [];
        const arrayText = swText.slice(start, index);
        const urlEntry = /\burl\s*:\s*(["'`])(.*?)\1/g;
        for (const match of arrayText.matchAll(urlEntry)) urls.push(match[2]);
        return urls;
      }
    }
  }
  return null;
}

function checkPrecache(swText, base, errors) {
  const urls = extractPrecacheUrls(swText);
  if (!urls) {
    errors.push('sw.js: no literal Workbox precache manifest found');
    return;
  }
  if (urls.length === 0) errors.push('sw.js: Workbox precache manifest is empty');

  for (const value of urls) {
    checkLocalUrl(value, base, 'sw.js precache', errors);
    const path = value.split(/[?#]/, 1)[0].toLowerCase();
    const segments = path.split('/').filter(Boolean);
    const basename = segments.at(-1) ?? '';
    if (/\.(?:onnx|ort|bin|safetensors|gguf|pt|pth|ckpt|h5|tflite|npz|model|weights)$/.test(basename)) {
      errors.push(`sw.js precache: model weight ${JSON.stringify(value)} must not be precached`);
    }
    if (
      segments.includes('ort') ||
      basename.startsWith('ort-') ||
      basename === 'ort.min.mjs' ||
      basename.includes('onnxruntime')
    ) {
      errors.push(`sw.js precache: ORT runtime ${JSON.stringify(value)} must not be precached`);
    }
    if (
      segments.includes('lexicon') ||
      basename.startsWith('lexicon-') ||
      basename.endsWith('.tsv') ||
      basename === 'us_gold.json'
    ) {
      errors.push(`sw.js precache: lexicon asset ${JSON.stringify(value)} must not be precached`);
    }
  }
}

function checkServiceWorkerRegistration(appTexts, base, errors) {
  const constructor = `(?:\\bserviceWorker\\s*\\.\\s*register\\s*\\(|\\bnew\\s+[A-Za-z_$][\\w$]*\\s*\\()\\s*["'\`]${escapeRegExp(base)}sw\\.js["'\`]`;
  const registration = new RegExp(constructor);
  const scope = new RegExp(`\\bscope\\s*:\\s*["'\`]${escapeRegExp(base)}["'\`]`);
  if (!appTexts.some((text) => registration.test(text))) {
    errors.push(`application bundle: no service-worker registration for ${base}sw.js`);
  }
  if (!appTexts.some((text) => scope.test(text))) {
    errors.push(`application bundle: service-worker scope is not exactly ${base}`);
  }
}

export async function validatePwaArtifact({ distDir, base }) {
  const normalizedBase = normalizeBase(base);
  const { root, files } = await listArtifactFiles(distDir);
  const fileSet = new Set(files);
  const errors = [];
  const warnings = [];

  for (const required of ['index.html', '404.html', 'manifest.webmanifest', 'sw.js']) {
    if (!fileSet.has(required)) errors.push(`missing required artifact: ${required}`);
  }
  if (fileSet.has('registerSW.js')) {
    errors.push('registerSW.js: auto-injected service-worker registration must not ship');
  }

  const readText = async (file) => {
    if (!fileSet.has(file)) return null;
    return readFile(join(root, file), 'utf8');
  };

  const indexText = await readText('index.html');
  const notFoundText = await readText('404.html');
  if (indexText !== null && notFoundText !== null && indexText !== notFoundText) {
    errors.push('404.html must be byte-identical to index.html');
  }

  if (indexText !== null) checkIndexBase(indexText, normalizedBase, errors);

  const manifestText = await readText('manifest.webmanifest');
  if (manifestText !== null) {
    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      errors.push('manifest.webmanifest: invalid JSON');
    }
    if (manifest !== undefined) {
      if (manifest?.scope !== normalizedBase) {
        errors.push(`manifest.webmanifest: scope must be exactly ${normalizedBase}`);
      }
      if (manifest?.start_url !== normalizedBase) {
        errors.push(`manifest.webmanifest: start_url must be exactly ${normalizedBase}`);
      }
      if (!Array.isArray(manifest?.icons)) {
        errors.push('manifest.webmanifest: icons must be an array');
      } else {
        for (const icon of manifest.icons) {
          if (typeof icon?.src === 'string') {
            checkLocalUrl(icon.src, normalizedBase, 'manifest.webmanifest icon', errors);
          }
        }
      }
    }
  }

  const swText = await readText('sw.js');
  if (swText !== null) {
    checkPrecache(swText, normalizedBase, errors);
    if (!swText.includes(`${normalizedBase}index.html`)) {
      errors.push(`sw.js: navigation fallback must use ${normalizedBase}index.html`);
    }
  }

  const textFiles = [];
  const appTexts = [];
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(extname(file))) continue;
    const text = await readFile(join(root, ...file.split('/')), 'utf8');
    textFiles.push([file, text]);
    if (file.startsWith('assets/') && file.endsWith('.js')) appTexts.push(text);
    checkHtmlAndCss(text, file, normalizedBase, errors);
    checkRootAssetLiterals(text, file, normalizedBase, errors);
  }
  checkTextArtifacts(textFiles, fileSet, warnings, errors);
  checkServiceWorkerRegistration(appTexts, normalizedBase, errors);

  return {
    ok: errors.length === 0,
    base: normalizedBase,
    distDir: root,
    fileCount: files.length,
    errors,
    warnings,
  };
}

function usage() {
  return [
    'Usage: node scripts/check-pwa-artifact.mjs --base /Read-IT/ [--dist dist]',
    '',
    'Validates the Pages artifact and writes dist/SHA-256SUMS only after it passes.',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  let distDir = 'dist';
  let base;
  try {
    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === '--help' || argument === '-h') {
        console.log(usage());
        return 0;
      }
      if (argument === '--dist' || argument === '--base') {
        if (base !== undefined && argument === '--base') throw new Error('duplicate option --base');
        if (argument === '--dist' && argv.slice(0, index).includes('--dist')) {
          throw new Error('duplicate option --dist');
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
        if (argument === '--dist') distDir = value;
        else base = value;
        index += 1;
      } else if (argument.startsWith('--dist=')) {
        if (argv.slice(0, index).some((item) => item === '--dist' || item.startsWith('--dist='))) {
          throw new Error('duplicate option --dist');
        }
        distDir = argument.slice('--dist='.length);
        if (!distDir) throw new Error('--dist requires a non-empty value');
      } else if (argument.startsWith('--base=')) {
        if (base !== undefined) throw new Error('duplicate option --base');
        base = argument.slice('--base='.length);
      } else {
        throw new Error(`unknown argument: ${argument}`);
      }
    }
    if (!base) throw new Error('missing required option --base');
    normalizeBase(base);
  } catch (error) {
    console.error(`pwa-artifact: ${error.message}`);
    console.error(usage());
    return 1;
  }

  try {
    const report = await validatePwaArtifact({ distDir, base });
    for (const warning of report.warnings) console.warn(`pwa-artifact warning: ${warning}`);
    if (!report.ok) {
      for (const error of report.errors) console.error(`pwa-artifact: ${error}`);
      console.error(`PWA artifact validation failed (${report.errors.length} error(s)); SHA-256SUMS was not written.`);
      return 1;
    }
    const sumsPath = await writeSha256Sums(distDir);
    console.log(
      `Validated PWA artifact at ${report.distDir} (base ${report.base}, ${report.fileCount} files).`,
    );
    console.log(`Wrote ${relative(process.cwd(), sumsPath) || SUMS_FILE}.`);
    return 0;
  } catch (error) {
    console.error(`pwa-artifact: ${error.message}`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().then((status) => {
    process.exitCode = status;
  });
}
