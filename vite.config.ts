import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import packageJson from './package.json' with { type: 'json' };
import { runtimeCacheCleanupSource, runtimeCacheNames } from './src/pwa/cacheNames.js';

// GitHub Pages serves the PWA from /Read-IT/; dev, Capacitor and Tauri need '/'.
// The build workflow sets VITE_BASE=/Read-IT/ at build time.
const rawBase = process.env.VITE_BASE ?? '/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

/**
 * Runtime-cached assets (ORT and the G2P dictionaries) keep stable URLs, so
 * CacheFirst would serve old bytes forever. Include a short content hash in
 * the cache name: a changed asset gets a fresh cache and a fresh download.
 */
function assetVersion(paths: string[]): string {
  const hash = createHash('sha256');
  for (const path of paths) {
    const file = fileURLToPath(new URL(path, import.meta.url));
    hash.update(existsSync(file) ? readFileSync(file) : path);
  }
  return hash.digest('hex').slice(0, 10);
}

const ortVersion = assetVersion([
  'public/ort/ort.min.mjs',
  'public/ort/ort-wasm-simd-threaded.jsep.mjs',
  'public/ort/ort-wasm-simd-threaded.jsep.wasm',
]);
const lexiconVersion = assetVersion([
  'public/lexicon/lexicon-en-us.txt',
  'public/lexicon/us_gold.json',
  'public/lexicon/en-us.tsv',
]);
const runtimeCaches = runtimeCacheNames(ortVersion, lexiconVersion);
// vite-plugin-pwa owns Workbox, but pnpm does not expose its transitive
// workbox-window package at the app root. Alias the virtual register's import to
// the copy already installed beside the plugin (no new dependency).
const requireFromPwa = createRequire(import.meta.resolve('vite-plugin-pwa'));
const workboxWindowEntry = requireFromPwa.resolve('workbox-window');

/**
 * Workbox expires entries inside a named cache, but changing cacheName leaves
 * the previous cache behind. Append a narrow activation cleanup after Workbox
 * has written sw.js; both this listener and runtimeCaching use runtimeCaches.
 */
function runtimeCacheCleanupPlugin(current: ReturnType<typeof runtimeCacheNames>): Plugin {
  let root = process.cwd();
  let outDir = 'dist';

  return {
    name: 'readit:runtime-cache-cleanup',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      handler(error) {
        if (error) return;
        const swPath = resolve(root, outDir, 'sw.js');
        if (!existsSync(swPath)) return;
        appendFileSync(swPath, runtimeCacheCleanupSource(current), 'utf8');
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  base,
  resolve: { alias: { 'workbox-window': workboxWindowEntry } },
  // Pinned so a Vite upgrade cannot silently raise the floor. iOS 15.4 is the
  // oldest Safari pdf.js runs on (structuredClone, Object.hasOwn); Chrome 110 is
  // the oldest Android WebView supported (see src/import/pdfPolyfill.ts).
  build: { target: ['safari15.4', 'ios15.4', 'chrome110', 'edge110', 'firefox115'] },
  // The What's new sheet and the update check compare against the version that
  // is actually running, so it comes from package.json at build time.
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  plugins: [
    react(),
    VitePWA({
      // native shell bundles its own assets; a service worker there would serve stale code after app updates
      disable: mode === 'native',
      registerType: 'prompt',
      // The app owns the prompt through virtual:pwa-register; never inject a
      // second registration that could reload without asking the reader.
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Read IT',
        short_name: 'Read IT',
        description: 'Offline ebook reader: import your own PDF, EPUB, DOCX and text files, read and listen without a network.',
        theme_color: '#1e2a47',
        background_color: '#faf7f1',
        display: 'standalone',
        // the whole app lives under the deploy path, so the install scope is that path too
        start_url: base,
        scope: base,
        // relative to the manifest, which sits at the base path
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          // iOS and some Android launchers ignore SVG manifest icons
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // TTS models are hundreds of MB and are downloaded at runtime, never precached.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // pdfjs/: decoders, standard fonts and the CMYK profile (~1.2 MB), so Page view works offline
        globPatterns: ['**/*.{js,css,html,woff2}', 'pdfjs/**/*.{wasm,pfb,ttf,icc}'],
        // Worker JavaScript stays precached. Weights and stable-URL runtime
        // assets do not: they are large and have their own versioned caches.
        globIgnores: [
          '**/*.{bin,onnx,safetensors,gguf}',
          'ort/**',
          '**/ort-*',
          'lexicon/**',
          '**/lexicon-*',
        ],
        // SPA deep links (e.g. /Read-IT/read/abc on reload) must land on the shell.
        navigateFallback: `${base}index.html`,
        // onnxruntime-web wasm (~22 MB) is too big to precache; cache on first use so later launches work offline.
        runtimeCaching: [
          {
            // matches only this app's same-origin <base>ort/ assets
            urlPattern: ({ url }) => {
              const scope = new URL((self as unknown as { registration: { scope: string } }).registration.scope);
              return url.origin === scope.origin && url.pathname.startsWith(new URL('ort/', scope).pathname);
            },
            handler: 'CacheFirst',
            options: { cacheName: runtimeCaches.ort, expiration: { maxEntries: 10 } },
          },
          {
            // The 10.9 MB G2P lexicon is fetched at runtime; keep it for offline
            // Kokoro even though it is too large for the 5 MB precache budget.
            urlPattern: ({ url }) => {
              const scope = new URL((self as unknown as { registration: { scope: string } }).registration.scope);
              return url.origin === scope.origin && url.pathname.startsWith(new URL('lexicon/', scope).pathname);
            },
            handler: 'CacheFirst',
            options: { cacheName: runtimeCaches.lexicon, expiration: { maxEntries: 3 } },
          },
        ],
      },
    }),
    ...(mode === 'native' ? [] : [runtimeCacheCleanupPlugin(runtimeCaches)]),
  ],
  // pocket-tts-js spawns its worker via new URL(import.meta.url); esbuild pre-bundling breaks that path
  optimizeDeps: { exclude: ['pocket-tts-js'] },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Scratch work under .tmp/ must never leak into the suite. Node-only script
    // tests use node:test and are run by their own package scripts, not Vitest.
    exclude: [...configDefaults.exclude, '.tmp/**', 'scripts/**'],
    // jsdom-heavy suites need real process isolation. vmThreads is not compatible
    // with the current setup, and an unbounded pool exhausts smaller CI runners.
    pool: 'forks',
    isolate: true,
    maxWorkers: 2,
  },
}));
