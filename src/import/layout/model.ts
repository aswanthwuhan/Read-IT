/**
 * The on-device layout model: PP-DocLayout-L (RT-DETR, 23 region classes),
 * exported to ONNX with INT8 weights by `Ralutet/PP-DocLayout-L-onnx-int8`
 * (Apache-2.0; base model `PaddlePaddle/PP-DocLayout-L`).
 *
 * 32 MB is the smallest accurate PP-DocLayout ONNX: the V3 export that
 * OpenReader uses is 124.5 MB FP32 / 64.3 MB FP16 and takes 3× longer and 2.6×
 * the RAM on a phone (see `.tmp/layout/RESEARCH.md` for the comparison), and the
 * 4.7 MB PP-DocLayout-S confuses tables and charts on the very pages we care
 * about. The weights live in Cache Storage, so only the first use is online and
 * a later launch reads them back offline — same bookkeeping as the TTS engines
 * in `src/tts/neural/models.ts`.
 */
import { LABELS } from './engine';

export const LAYOUT_CACHE = 'readit-layout-v1';

export const LAYOUT_MODEL = {
  label: 'PP-DocLayout-L',
  /**
   * Mutable Hugging Face `/resolve/main` URL. `bytes` below is a length guard,
   * not integrity verification: no SHA-256 was available offline. Pin a
   * revision and record a digest before treating the download as immutable.
   */
  url: 'https://huggingface.co/Ralutet/PP-DocLayout-L-onnx-int8/resolve/main/pp-doclayout-l.onnx',
  /** Exact expected byte length, for progress and download/cache validation. */
  bytes: 33_581_278,
  /** Everything is squashed to this square, matching the training transform (`keep_ratio: false`). */
  inputSize: 640,
  threshold: 0.5,
  /** Output class order, from the repo's `labels.json`. */
  labels: LABELS,
} as const;

const MODEL_CONTENT_LENGTH = String(LAYOUT_MODEL.bytes);

/** A complete body plus the exact header that makes later readiness checks cheap. */
function modelResponse(bytes: ArrayBuffer): Response {
  return new Response(bytes, { headers: { 'Content-Length': MODEL_CONTENT_LENGTH } });
}

/**
 * Cache Storage preserves responses written above. Only an OK, unused body with
 * our canonical exact length can skip the body check; everything else is legacy
 * and gets validated once below.
 */
function hasTrustedModelLength(response: Response): boolean {
  const body = response.body;
  return response.ok
    && !response.bodyUsed
    && body !== null
    && !body.locked
    && response.headers.get('content-length') === MODEL_CONTENT_LENGTH;
}

/** The cached weights, validating legacy entries and upgrading them when possible. */
async function cachedModel(): Promise<Response | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(LAYOUT_CACHE);
    const hit = await cache.match(LAYOUT_MODEL.url);
    if (!hit) return null;
    if (hasTrustedModelLength(hit)) return hit;

    // Old versions cached a headerless Response. Read that body once, reject any
    // invalid length, then best-effort add the header so readiness stays cheap.
    const bytes = await readModelBytes(hit);
    const validated = modelResponse(bytes);
    try {
      await cache.put(LAYOUT_MODEL.url, validated.clone());
    } catch {
      // Quota/private-mode failures must not hide an otherwise valid cached model.
    }
    return validated;
  } catch {
    // Private mode, quota errors and invalid cached bodies: treat as "not downloaded".
    return null;
  }
}

/**
 * True when a complete set of weights is cached. Nothing else counts: a
 * remembered "it was downloaded once" survives a restored backup and an evicted
 * cache, and a truncated response can otherwise hide Download while every
 * import silently skips the model.
 */
export async function isLayoutModelReady(): Promise<boolean> {
  return (await cachedModel()) !== null;
}

/** Materialize the complete cached weights, or null when no valid model is cached. */
export async function loadLayoutModelBytes(): Promise<ArrayBuffer | null> {
  const hit = await cachedModel();
  if (!hit) return null;
  try {
    // Even a trusted header is checked against the body when bytes are needed.
    return await readModelBytes(hit);
  } catch {
    return null;
  }
}

/**
 * Fetch exactly the expected number of bytes once and keep them in Cache
 * Storage. The optional signal cancels both the request and a pending body read.
 */
export async function downloadLayoutModel(
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (typeof caches === 'undefined') {
    throw new Error('This browser cannot store the layout model.');
  }

  let response: Response | undefined;
  try {
    response = await waitFor(fetch(LAYOUT_MODEL.url, { signal }), signal);
    throwIfAborted(signal);
    if (!response.ok) throw new Error(`Could not download the layout model (HTTP ${response.status}).`);

    // This is also the hard upper bound: a mutable URL and a Content-Length
    // header are not proof that the body is the model we expect.
    const bytes = await readModelBytes(response, onProgress, signal);
    throwIfAborted(signal);

    // Only a complete, exactly sized body reaches Cache Storage. Cache.put is
    // atomic from readers' perspective, so a failed or cancelled stream cannot
    // leave partial weights for the importer to find.
    const cache = await waitFor(caches.open(LAYOUT_CACHE), signal);
    throwIfAborted(signal);
    await waitFor(cache.put(LAYOUT_MODEL.url, modelResponse(bytes)), signal);
    throwIfAborted(signal);
    if (!(await waitFor(cache.match(LAYOUT_MODEL.url), signal))) {
      throw new Error('Could not store the layout model — the device may be out of space.');
    }

    throwIfAborted(signal);
    onProgress?.(1);
  } catch (error) {
    if (signal?.aborted) throw downloadAborted();
    throw error;
  } finally {
    // HTTP errors and aborts before the first read still own a live body.
    if (response?.body && !response.bodyUsed) cancelStream(response.body);
  }
}

/** Read a model body without ever retaining more than its exact expected size. */
async function readModelBytes(
  response: Response,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let received = 0;

  if (response.body) {
    const reader = response.body.getReader();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await waitFor(reader.read(), signal);
        throwIfAborted(signal);
        if (done) {
          finished = true;
          break;
        }
        if (value.byteLength > LAYOUT_MODEL.bytes - received) {
          throw new Error('The layout model download is larger than expected — try again.');
        }
        chunks.push(value);
        received += value.byteLength;
        // Stop at 99%: the file still has to be written to the cache.
        onProgress?.(Math.min(0.99, received / LAYOUT_MODEL.bytes));
      }
    } finally {
      if (!finished) {
        try {
          void reader.cancel().catch(() => undefined);
        } catch {
          // Preserve the size/abort/read error that caused the cancellation.
        }
      }
    }
  } else {
    const buffer = await waitFor(response.arrayBuffer(), signal);
    throwIfAborted(signal);
    if (buffer.byteLength > LAYOUT_MODEL.bytes) {
      throw new Error('The layout model download is larger than expected — try again.');
    }
    chunks.push(new Uint8Array(buffer));
    received = buffer.byteLength;
    onProgress?.(Math.min(0.99, received / LAYOUT_MODEL.bytes));
  }

  // A truncated file would fail deep inside ONNX Runtime with an unreadable
  // protobuf error and no way for the panel to recover, so reject it here.
  if (received !== LAYOUT_MODEL.bytes) {
    throw new Error('The download stopped early — check the connection and try again.');
  }

  const bytes = new Uint8Array(LAYOUT_MODEL.bytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function downloadAborted(): DOMException {
  return new DOMException('The layout model download was cancelled.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw downloadAborted();
}

/** Race an asynchronous read against cancellation without leaking abort listeners. */
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(downloadAborted()));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (signal.aborted) onAbort();
        else finish(() => resolve(value));
      },
      (error: unknown) => {
        if (signal.aborted) onAbort();
        else finish(() => reject(error));
      },
    );
    // Covers an abort between the initial check and listener registration.
    if (signal.aborted) onAbort();
  });
}

function cancelStream(stream: ReadableStream | null | undefined): void {
  try {
    void stream?.cancel().catch(() => undefined);
  } catch {
    // Best effort: the original download error is more useful than a cancel failure.
  }
}

/** Delete the weights; imports fall back to the text-only layout until re-downloaded. */
export async function deleteLayoutModel(): Promise<void> {
  if (typeof caches !== 'undefined') {
    await caches.delete(LAYOUT_CACHE);
    if (await cachedModel()) throw new Error('Could not delete the downloaded model files');
  }
}
