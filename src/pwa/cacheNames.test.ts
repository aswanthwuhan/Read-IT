import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  runtimeCacheCleanupSource,
  runtimeCacheNames,
  selectLegacyRuntimeCaches,
  selectStaleRuntimeCaches,
} from './cacheNames';

describe('PWA runtime cache names', () => {
  it('builds app-scoped current names from the asset-version constants', () => {
    expect(runtimeCacheNames('ort123', 'lex456')).toEqual({
      ort: 'readit-ort-runtime-ort123',
      lexicon: 'readit-g2p-lexicon-lex456',
    });
  });

  it('selects only obsolete app-scoped runtime caches', () => {
    const names = [
      'readit-ort-runtime-current',
      'readit-g2p-lexicon-current',
      'readit-ort-runtime-old',
      'readit-g2p-lexicon-older',
      'ort-runtime-old',
      'g2p-lexicon-older',
      'workbox-precache-v2',
      'kokoro-model-weights',
      'pocket-model-cache',
      'readit-audio',
      'readit-books',
      'other-readit-ort-runtime-old',
    ];

    expect(selectStaleRuntimeCaches(names, 'readit-ort-runtime-current', 'readit-g2p-lexicon-current')).toEqual([
      'readit-ort-runtime-old',
      'readit-g2p-lexicon-older',
    ]);
    expect(selectLegacyRuntimeCaches(names)).toEqual(['ort-runtime-old', 'g2p-lexicon-older']);
  });

  it('emits an activation cleanup using the exact current names', () => {
    const source = runtimeCacheCleanupSource({
      ort: 'readit-ort-runtime-current',
      lexicon: 'readit-g2p-lexicon-current',
    });

    expect(source).toContain("self.addEventListener('activate'");
    expect(source).toContain('event.waitUntil');
    expect(source).toContain('"readit-ort-runtime-current"');
    expect(source).toContain('"readit-g2p-lexicon-current"');
    expect(source).toContain('self.caches.delete');
    expect(source).toContain("scope + 'ort/'");
    expect(source).toContain("scope + 'lexicon/'");
  });

  it('deletes obsolete app caches but preserves other apps in legacy shared buckets', async () => {
    const currentOrt = fakeCache(['https://example.test/Read-IT/ort/current.mjs']);
    const legacyOrt = fakeCache([
      'https://example.test/Read-IT/ort/old.mjs',
      'https://example.test/another-app/ort/keep.mjs',
    ]);
    const legacyLexicon = fakeCache([
      'https://example.test/Read-IT/lexicon/old.txt',
      'https://example.test/another-app/lexicon/keep.txt',
    ]);
    const otherApp = fakeCache(['https://example.test/another-app/keep.js']);
    const buckets = new Map<string, ReturnType<typeof fakeCache>>([
      ['readit-ort-runtime-current', currentOrt],
      ['readit-g2p-lexicon-current', fakeCache([])],
      ['readit-ort-runtime-old', fakeCache([])],
      ['ort-runtime-old', legacyOrt],
      ['g2p-lexicon-older', legacyLexicon],
      ['another-app-cache', otherApp],
    ]);
    let activate!: (event: { waitUntil(promise: Promise<unknown>): void }) => void;
    const scope = 'https://example.test/Read-IT/';
    const self = {
      registration: { scope },
      caches: {
        keys: async () => [...buckets.keys()],
        open: async (name: string) => {
          const bucket = buckets.get(name);
          if (!bucket) throw new Error(`missing cache ${name}`);
          return bucket;
        },
        delete: async (name: string) => buckets.delete(name),
      },
      addEventListener: (_type: string, listener: typeof activate) => {
        activate = listener;
      },
    };

    runInNewContext(runtimeCacheCleanupSource({
      ort: 'readit-ort-runtime-current',
      lexicon: 'readit-g2p-lexicon-current',
    }), { self, URL, Request });

    let pending!: Promise<unknown>;
    activate({ waitUntil: (promise) => { pending = promise; } });
    await pending;

    expect(buckets.has('readit-ort-runtime-old')).toBe(false);
    expect(buckets.has('readit-ort-runtime-current')).toBe(true);
    expect(buckets.has('readit-g2p-lexicon-current')).toBe(true);
    expect((await legacyOrt.keys()).map((request) => request.url)).toEqual([
      'https://example.test/another-app/ort/keep.mjs',
    ]);
    expect((await legacyLexicon.keys()).map((request) => request.url)).toEqual([
      'https://example.test/another-app/lexicon/keep.txt',
    ]);
    expect((await otherApp.keys()).map((request) => request.url)).toEqual([
      'https://example.test/another-app/keep.js',
    ]);
  });
});

function fakeCache(urls: string[]) {
  const entries = new Set(urls);
  return {
    keys: async () => [...entries].map((url) => new Request(url)),
    delete: async (request: Request | string) => entries.delete(typeof request === 'string' ? request : request.url),
  };
}
