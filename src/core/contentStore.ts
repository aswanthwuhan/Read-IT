/**
 * Compressed storage for a book's parsed document.
 *
 * A BookRecord still carries `parsed` today, but a library screen that reads
 * every row clones every parsed document before the first paint. This module
 * gives that document a home of its own, keyed by book id, so a later step can
 * move it out of `books` without changing BookRecord first.
 *
 * Rows are written compressed with the platform's `deflate-raw` support when it
 * exists. iOS 15.4–16.3 has neither `CompressionStream` nor
 * `DecompressionStream`, so those devices store UTF-8 bytes instead and keep
 * reading their own rows; a compressed row from another device reads as `null`
 * there rather than throwing.
 */
import { db } from './db';
import type { BookRecord } from './types';

export interface StoredContent {
  id: string;
  codec: 'deflate-raw' | 'none';
  bytes: ArrayBuffer;
}

/** Some webviews ship the constructor but reject `deflate-raw`; catch both. */
function supportsRawDeflate(): boolean {
  if (typeof CompressionStream !== 'function') return false;
  try {
    new CompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

async function deflate(input: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Response(input.slice().buffer).body!.pipeThrough(new CompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

async function inflate(bytes: ArrayBuffer): Promise<string> {
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/** IndexedDB may hand a view back if a row was written by hand; normalise it. */
function asBytes(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value;
  // fake-indexeddb (tests) clones across realms: instanceof fails but the
  // internal slots and byteLength are real, and the tag still says ArrayBuffer.
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return value as ArrayBuffer;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
  }
  return null;
}

/** Store `json` for `id`; returns the size actually written, in bytes. */
export async function putContent(id: string, json: string): Promise<number> {
  const plain = new TextEncoder().encode(json);
  let codec: StoredContent['codec'] = 'none';
  let bytes: ArrayBuffer = plain.slice().buffer;

  if (supportsRawDeflate()) {
    try {
      bytes = await deflate(plain);
      codec = 'deflate-raw';
    } catch {
      // Compression failed mid-stream (an old webview can do this): keep the
      // bytes readable rather than failing an import's only copy.
      codec = 'none';
      bytes = plain.slice().buffer;
    }
  }

  await db.bookContent.put({ id, codec, bytes });
  return bytes.byteLength;
}

/** The stored JSON, or null when the row is absent or unreadable. */
export async function getContent(id: string): Promise<string | null> {
  let row: StoredContent | undefined;
  try {
    row = (await db.bookContent.get(id)) as StoredContent | undefined;
  } catch {
    return null;
  }
  if (!row || typeof row !== 'object') return null;

  const bytes = asBytes(row.bytes);
  if (!bytes) return null;
  try {
    if (row.codec === 'none') return new TextDecoder().decode(bytes);
    if (row.codec === 'deflate-raw') {
      if (typeof DecompressionStream !== 'function') return null;
      return await inflate(bytes);
    }
    return null;
  } catch {
    // Truncated or otherwise corrupt bytes are a missing document, not a crash.
    return null;
  }
}

/**
 * A book with its parsed document resolved from the content store when a row
 * exists. The book's own `parsed` stays the fallback until every reader reads
 * from here; a row that decodes but is not a usable document is a miss too, so
 * a damaged backup cannot hand the reader an object with no chapters.
 */
export async function hydrateBook(book: BookRecord): Promise<BookRecord> {
  const json = await getContent(book.id);
  if (json === null) return book;
  try {
    const parsed = JSON.parse(json) as BookRecord['parsed'];
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.chapters)) return book;
    return { ...book, parsed };
  } catch {
    return book;
  }
}

export async function deleteContent(id: string): Promise<void> {
  await db.bookContent.delete(id);
}

/** Stored size for `id`; 0 when the row is absent. */
export async function contentBytes(id: string): Promise<number> {
  const row = (await db.bookContent.get(id)) as StoredContent | undefined;
  return asBytes(row?.bytes)?.byteLength ?? 0;
}
