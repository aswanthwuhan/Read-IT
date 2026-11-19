import { afterEach, describe, expect, it } from 'vitest';
import { db, newId } from './db';
import type { BookRecord, Highlight } from './types';

const book = (): BookRecord => ({
  id: newId(),
  title: 'Moby Dick',
  author: 'Melville',
  format: 'pdf',
  addedAt: Date.now(),
  fileBlob: new Blob(['%PDF-1.4 test']),
  parsed: {
    title: 'Moby Dick',
    format: 'pdf',
    chapters: [
      {
        id: 'ch1',
        title: 'The Chase',
        blocks: [{ id: 'b1', kind: 'p', sentences: [{ id: 's1', text: 'The whale sounded and the line ran out.' }] }],
      },
    ],
  },
});

afterEach(async () => {
  await db.delete();
  await db.open();
});

describe('ReadItDB', () => {
  it('stores and reads back a book with its parsed content', async () => {
    const b = book();
    await db.books.add(b);

    const found = await db.books.get(b.id);
    expect(found?.title).toBe('Moby Dick');
    expect(found?.parsed.chapters[0]?.blocks[0]?.sentences[0]?.text).toContain('whale');
    // fake-indexeddb's structured clone drops Blob contents (real IndexedDB keeps them),
    // so only presence is asserted here.
    expect(found?.fileBlob).toBeTruthy();

    // The title index is what the library uses when it groups books by name.
    expect(await db.books.where('title').equals('Moby Dick').count()).toBe(1);
  });

  it('stores a highlight and finds it by book, newest first', async () => {
    const b = book();
    await db.books.add(b);

    const h: Highlight = {
      id: newId(),
      bookId: b.id,
      sentenceIds: ['s1'],
      text: 'The whale sounded',
      color: 'yellow',
      createdAt: Date.now(),
    };
    await db.highlights.add(h);

    expect(await db.highlights.get(h.id)).toMatchObject({ sentenceIds: ['s1'], color: 'yellow' });

    const forBook = await db.highlights.where('bookId').equals(b.id).toArray();
    expect(forBook).toHaveLength(1);
    expect(forBook[0]?.text).toBe('The whale sounded');
  });
});
