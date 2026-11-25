import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../core/db';
import { createLayoutDetector } from './detector';
import {
  LAYOUT_CACHE,
  LAYOUT_MODEL,
  downloadLayoutModel,
  isLayoutModelReady,
  loadLayoutModelBytes,
} from './model';

function modelBytes(size: number = LAYOUT_MODEL.bytes): Uint8Array<ArrayBuffer> {
  return new Uint8Array(size);
}

/** Cache Storage with nothing in it, or with the weights. */
function stubCaches(model: Response | null = null) {
  let stored = model;
  const cache = {
    match: vi.fn(async (url: string) => (url === LAYOUT_MODEL.url ? stored?.clone() : undefined)),
    put: vi.fn(async (url: string, response: Response) => {
      if (url !== LAYOUT_MODEL.url) throw new Error('Unexpected cache key');
      stored = response.clone();
    }),
  };
  const open = vi.fn(async (name: string) => {
    if (name !== LAYOUT_CACHE) throw new Error('Unexpected cache name');
    return cache;
  });
  vi.stubGlobal('caches', { open });
  return { open, ...cache };
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await db.delete();
  await db.open();
});

describe('isLayoutModelReady', () => {
  it('validates a legacy cached body once and rewrites it with the exact Content-Length', async () => {
    const cache = stubCaches(new Response(modelBytes()));

    expect(await isLayoutModelReady()).toBe(true);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put.mock.calls[0]?.[1].headers.get('content-length')).toBe(String(LAYOUT_MODEL.bytes));

    const loaded = await loadLayoutModelBytes();
    expect(loaded?.byteLength).toBe(LAYOUT_MODEL.bytes);
    expect(cache.match).toHaveBeenCalledTimes(2);
  });

  it('checks readiness from the exact Content-Length without reading the cached body', async () => {
    const response = new Response(modelBytes(), {
      headers: { 'Content-Length': String(LAYOUT_MODEL.bytes) },
    });
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
    const getReader = vi.spyOn(response.body!, 'getReader');
    const match = vi.fn(async () => response);
    const put = vi.fn();
    vi.stubGlobal('caches', { open: vi.fn(async () => ({ match, put })) });

    expect(await isLayoutModelReady()).toBe(true);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(getReader).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();

    expect((await loadLayoutModelBytes())?.byteLength).toBe(LAYOUT_MODEL.bytes);
    expect(getReader).toHaveBeenCalledTimes(1);
  });

  it('treats a mismatched Content-Length as legacy and validates the body', async () => {
    const cache = stubCaches(new Response(modelBytes(), {
      headers: { 'Content-Length': String(LAYOUT_MODEL.bytes - 1) },
    }));

    expect(await isLayoutModelReady()).toBe(true);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put.mock.calls[0]?.[1].headers.get('content-length')).toBe(String(LAYOUT_MODEL.bytes));
  });

  it.each([
    ['truncated', LAYOUT_MODEL.bytes - 1],
    ['oversized', LAYOUT_MODEL.bytes + 1],
  ] as const)('rejects a %s cached response before reporting ready or loading it', async (_label, size) => {
    const cache = stubCaches(new Response(modelBytes(size)));

    expect(await isLayoutModelReady()).toBe(false);
    expect(await loadLayoutModelBytes()).toBeNull();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('does not believe a "ready" flag that outlived the files', async () => {
    // A backup restored on a new phone carries the settings table, and the
    // browser may evict the cache: either way there is no model to run, and
    // "Ready" would hide the Download button while imports quietly fall back.
    await db.settings.put({ key: 'import.layout.ready', value: true });
    stubCaches(null);

    expect(await isLayoutModelReady()).toBe(false);
  });
});

describe('downloadLayoutModel', () => {
  it('caches an exactly sized response and preserves progress through the cache write', async () => {
    const cache = stubCaches();
    stubFetch(new Response(modelBytes()));
    const progress = vi.fn();

    await downloadLayoutModel(progress);

    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put.mock.calls[0]?.[1].headers.get('content-length')).toBe(String(LAYOUT_MODEL.bytes));
    expect(progress).toHaveBeenCalledWith(0.99);
    expect(progress).toHaveBeenLastCalledWith(1);
    expect(await isLayoutModelReady()).toBe(true);
    expect((await loadLayoutModelBytes())?.byteLength).toBe(LAYOUT_MODEL.bytes);
  });

  it('rejects a nearly complete stream without writing partial weights', async () => {
    const cache = stubCaches();
    stubFetch(new Response(modelBytes(LAYOUT_MODEL.bytes - 1)));
    const progress = vi.fn();

    await expect(downloadLayoutModel(progress)).rejects.toThrow('The download stopped early');

    expect(cache.put).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalledWith(1);
    expect(await isLayoutModelReady()).toBe(false);
  });

  it('stops and cancels an oversized stream before it can be cached', async () => {
    const cache = stubCaches();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(modelBytes());
        // One byte past the exact bound must fail immediately, not be retained.
        controller.enqueue(new Uint8Array([0]));
      },
      cancel,
    });
    stubFetch(new Response(body));

    await expect(downloadLayoutModel()).rejects.toThrow('larger than expected');

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cache.put).not.toHaveBeenCalled();
    expect(await isLayoutModelReady()).toBe(false);
  });

  it('rejects a pre-aborted signal without fetching or opening the cache', async () => {
    const cache = stubCaches();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(downloadLayoutModel(undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.open).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('passes the signal to fetch and promptly cancels a pending response body', async () => {
    const cache = stubCaches();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const fetchMock = stubFetch(new Response(body));
    const controller = new AbortController();
    let firstChunk!: () => void;
    const chunkRead = new Promise<void>((resolve) => {
      firstChunk = resolve;
    });
    const progress = vi.fn((fraction: number) => {
      if (fraction > 0) firstChunk();
    });

    const pending = downloadLayoutModel(progress, controller.signal);
    await chunkRead;
    expect(fetchMock).toHaveBeenCalledWith(LAYOUT_MODEL.url, { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cache.put).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalledWith(1);
  });
});

describe('createLayoutDetector', () => {
  it('stops the worker when the model cannot be loaded', async () => {
    stubCaches(new Response(modelBytes()));
    const terminate = vi.fn();
    class FailingWorker extends EventTarget {
      terminate = terminate;
      postMessage(message: { type: string }): void {
        if (message.type !== 'load') return;
        queueMicrotask(() =>
          this.dispatchEvent(new MessageEvent('message', { data: { type: 'failed', message: 'bad protobuf' } })),
        );
      }
    }
    vi.stubGlobal('Worker', FailingWorker);

    await expect(createLayoutDetector()).rejects.toThrow('bad protobuf');
    // Otherwise every import with a corrupt download strands a worker holding the 32 MB file.
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
