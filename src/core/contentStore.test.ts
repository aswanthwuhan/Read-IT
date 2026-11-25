import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { contentBytes, deleteContent, getContent, getParsedContent, hydrateBook, putContent } from './contentStore';
import type { BookRecord } from './types';

/** Over 100 KB of realistic parsed-document JSON. */
function sample(): string {
  const chapters = Array.from({ length: 220 }, (_, i) => ({
    id: `ch-${i}`,
    title: `Chapter ${i}`,
    blocks: [
      {
        id: `b-${i}`,
        kind: 'p',
        sentences: Array.from({ length: 8 }, (_, j) => ({
          id: `s-${i}-${j}`,
          text: `Sentence ${i}.${j}: the whale sounded near the dark water and the line ran out while the crew waited.`,
        })),
      },
    ],
  }));
  return JSON.stringify({ title: 'Moby Dick', format: 'txt', chapters });
}

function testBook(): BookRecord {
  return {
    id: 'book-hydrate',
    title: 'Moby Dick',
    format: 'txt',
    addedAt: Date.now(),
    fileBlob: new Blob(['text']),
    parsed: {
      title: 'Moby Dick',
      format: 'txt',
      chapters: [
        {
          id: 'book-ch',
          title: 'Book chapter',
          blocks: [{ id: 'book-b', kind: 'p', sentences: [{ id: 'book-s', text: 'The book own sentence.' }] }],
        },
      ],
    },
  };
}

const canCompress = (() => {
  if (typeof CompressionStream !== 'function') return false;
  try {
    new CompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
})();

afterEach(async () => {
  await db.bookContent.clear();
});

describe('contentStore', () => {
  it('version 4 keeps every portable table and adds content plus summaries', () => {
    expect(db.verno).toBe(4);
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'audioCache', 'bookContent', 'bookSummaries', 'bookmarks', 'books', 'highlights', 'lexicon', 'settings',
    ]);
  });

  it('round-trips a 100 KB JSON string and stores it compressed', async () => {
    const json = sample();
    const original = new TextEncoder().encode(json).byteLength;
    expect(original).toBeGreaterThan(100 * 1024);

    const stored = await putContent('book-1', json);

    expect(stored).toBe(await contentBytes('book-1'));
    expect(await getContent('book-1')).toBe(json);

    if (canCompress) {
      expect(stored).toBeLessThan(original);
      console.info(
        `contentStore: ${original} -> ${stored} bytes (${((stored / original) * 100).toFixed(1)}% of original)`,
      );
    } else {
      // No CompressionStream: the JSON must still round-trip as plain UTF-8.
      expect(stored).toBe(original);
    }
  });

  it('returns null and 0 bytes for a missing id', async () => {
    expect(await getContent('missing')).toBeNull();
    expect(await contentBytes('missing')).toBe(0);
  });

  it('deletes a stored row', async () => {
    await putContent('book-1', '{"title":"Moby Dick"}');
    expect(await getContent('book-1')).not.toBeNull();

    await deleteContent('book-1');

    expect(await getContent('book-1')).toBeNull();
    expect(await contentBytes('book-1')).toBe(0);
  });

  it('returns null for corrupt stored bytes instead of throwing', async () => {
    await db.bookContent.put({
      id: 'broken',
      codec: 'deflate-raw',
      bytes: new TextEncoder().encode('this is not a deflate stream').buffer,
    });

    await expect(getContent('broken')).resolves.toBeNull();
  });

  it('returns null for an unknown codec instead of throwing', async () => {
    await db.bookContent.put({
      id: 'odd',
      codec: 'brotli' as never,
      bytes: new TextEncoder().encode('{}').buffer,
    });

    await expect(getContent('odd')).resolves.toBeNull();
  });

  it('getParsedContent returns a usable document and null for damaged rows', async () => {
    await putContent('parsed', JSON.stringify({ title: 'Notes', format: 'txt', chapters: [] }));
    await expect(getParsedContent('parsed')).resolves.toMatchObject({ title: 'Notes', chapters: [] });

    await putContent('parsed', '{not json');
    await expect(getParsedContent('parsed')).resolves.toBeNull();
    await putContent('parsed', JSON.stringify({ title: 'No chapters' }));
    await expect(getParsedContent('parsed')).resolves.toBeNull();
  });

  it('hydrateBook reads parsed from the content store when a row exists', async () => {
    const book = testBook();
    const stored: BookRecord['parsed'] = {
      title: 'Stored title',
      format: 'txt',
      chapters: [
        {
          id: 'stored-ch',
          title: 'Stored chapter',
          blocks: [{ id: 'stored-b', kind: 'p', sentences: [{ id: 'stored-s', text: 'The stored sentence.' }] }],
        },
      ],
    };
    await putContent(book.id, JSON.stringify(stored));

    const hydrated = await hydrateBook(book);

    expect(hydrated).not.toBe(book);
    expect(hydrated.parsed).toEqual(stored);
  });

  it('hydrateBook falls back to book.parsed when no row exists', async () => {
    const book = testBook();

    await expect(hydrateBook(book)).resolves.toBe(book);
  });

  it('hydrateBook falls back rather than throwing when the stored document is unusable', async () => {
    const book = testBook();
    await putContent(book.id, '{not json');
    await expect(hydrateBook(book)).resolves.toBe(book);

    // A decodable row that is not a document is a miss too.
    await putContent(book.id, JSON.stringify({ title: 'No chapters' }));
    await expect(hydrateBook(book)).resolves.toBe(book);
  });
});
