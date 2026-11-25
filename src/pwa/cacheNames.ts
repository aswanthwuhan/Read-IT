/** Runtime caches whose stable URLs need a content-versioned cache name. */
export interface RuntimeCacheNames {
  ort: string;
  lexicon: string;
}

export function runtimeCacheNames(ortVersion: string, lexiconVersion: string): RuntimeCacheNames {
  return {
    ort: `readit-ort-runtime-${ortVersion}`,
    lexicon: `readit-g2p-lexicon-${lexiconVersion}`,
  };
}

/**
 * Select only obsolete Read IT runtime caches. Model, audio, book and Workbox
 * caches use other names and must survive an app update.
 *
 * Keep this function self-contained: vite.config.ts serializes it into the
 * generated service worker's activation listener.
 */
export function selectStaleRuntimeCaches(
  cacheNames: string[],
  currentOrtCache: string,
  currentLexiconCache: string,
): string[] {
  const current = new Set([currentOrtCache, currentLexiconCache]);
  return cacheNames.filter(
    (name) =>
      (name.startsWith('readit-ort-runtime-') || name.startsWith('readit-g2p-lexicon-')) && !current.has(name),
  );
}

/** Unscoped cache names written by older Read IT builds. */
export function selectLegacyRuntimeCaches(cacheNames: string[]): string[] {
  return cacheNames.filter((name) => name.startsWith('ort-runtime-') || name.startsWith('g2p-lexicon-'));
}

/** Source appended to the generated Workbox service worker. */
export function runtimeCacheCleanupSource(current: RuntimeCacheNames): string {
  const selectStale = selectStaleRuntimeCaches.toString();
  const selectLegacy = selectLegacyRuntimeCaches.toString();
  return `
// Read IT: remove obsolete versioned runtime caches, never reader data.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (!self.caches) return;
    const names = await self.caches.keys();
    const stale = (${selectStale})(names, ${JSON.stringify(current.ort)}, ${JSON.stringify(current.lexicon)});
    await Promise.all(stale.map((name) => self.caches.delete(name)));

    // Older builds used generic cache names on a potentially shared origin.
    // Remove only this app's exact-scope ORT/lexicon requests; another app's
    // entries and the shared bucket itself must survive.
    const scopeUrl = new URL(self.registration.scope);
    const scope = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : scopeUrl.pathname + '/';
    const legacy = (${selectLegacy})(names);
    for (const name of legacy) {
      const cache = await self.caches.open(name);
      const requests = await cache.keys();
      const ours = requests.filter((request) => {
        const url = new URL(request.url);
        return url.origin === scopeUrl.origin &&
          (url.pathname.startsWith(scope + 'ort/') || url.pathname.startsWith(scope + 'lexicon/'));
      });
      await Promise.all(ours.map((request) => cache.delete(request)));
      // Leave the legacy bucket itself in place: another app may write to it
      // between our key checks, and Cache API has no conditional bucket delete.
    }
  })());
});
`;
}
