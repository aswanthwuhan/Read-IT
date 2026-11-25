import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOK_SUMMARY_REPAIR_BATCH,
  ReadItDB,
  db,
  listLibraryBooks,
  newId,
  putBookSummary,
  repairBookSummaries,
  summarizeBook,
  summaryChapterTitle,
  summaryProgress,
} from './db';
import type { BookRecord, Highlight } from './types';

const book = (overrides: Partial<BookRecord> = {}): BookRecord => ({
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
        blocks: [{ id: 'b-0', kind: 'p', sentences: [{ id: '0-0-0', text: 'The whale sounded and the line ran out.' }] }],
      },
    ],
  },
  ...overrides,
});

afterEach(async () => {
  vi.restoreAllMocks();
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
      sentenceIds: ['0-0-0'],
      text: 'The whale sounded',
      color: 'yellow',
      createdAt: Date.now(),
    };
    await db.highlights.add(h);

    expect(await db.highlights.get(h.id)).toMatchObject({ sentenceIds: ['0-0-0'], color: 'yellow' });

    const forBook = await db.highlights.where('bookId').equals(b.id).toArray();
    expect(forBook).toHaveLength(1);
    expect(forBook[0]?.text).toBe('The whale sounded');
  });
});

describe('book summaries', () => {
  it('version 4 keeps every older table, adds summaries and indexes audio ownership', () => {
    expect(db.verno).toBe(4);
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'audioCache', 'bookContent', 'bookSummaries', 'bookmarks', 'books', 'highlights', 'lexicon', 'settings',
    ]);
    expect(db.audioCache.schema.indexes.map((index) => index.keyPath)).toEqual(
      expect.arrayContaining(['createdAt', 'bookId', 'engine']),
    );
  });

  it('derives exact counts and progress without copying text or blobs', () => {
    const b = book({
      lastPos: { chapterId: 'ch1', sentenceId: '0-0-0' },
    });
    b.parsed.chapters[0]!.blocks.push({
      id: 'b-1',
      kind: 'p',
      sentences: [{ id: '0-1-0', text: 'Second sentence.' }],
    });

    const summary = summarizeBook(b);

    expect(summary).toMatchObject({ chapterCount: 1, sentenceCount: 2 });
    expect(JSON.stringify(summary)).not.toContain('whale');
    expect(summaryProgress(summary, summary.lastPos)).toBe(50);
    expect(summaryProgress(summary, { chapterId: 'missing', sentenceId: '0-0-0' })).toBeNull();
    expect(summaryProgress(summary, { chapterId: 'ch1', sentenceId: '0-9-0' })).toBeNull();
  });

  it('locates production chapter-block ids in later chapters and blocks', () => {
    const b = book();
    b.parsed.chapters = [
      {
        id: 'ch-0', title: 'Opening', blocks: [
          { id: 'b-0-0', kind: 'p', sentences: [{ id: '0-0-0', text: 'One.' }] },
        ],
      },
      {
        id: 'ch-1', title: 'Middle', blocks: [
          { id: 'b-1-0', kind: 'p', sentences: [{ id: '1-0-0', text: 'Two.' }] },
          { id: 'b-1-1', kind: 'p', sentences: [{ id: '1-1-0', text: 'Three.' }, { id: '1-1-1', text: 'Four.' }] },
        ],
      },
      {
        id: 'ch-2', title: 'Later', blocks: [
          { id: 'b-2-3', kind: 'p', sentences: [{ id: '2-3-0', text: 'Five.' }] },
        ],
      },
    ];
    const summary = summarizeBook(b);

    expect(summaryProgress(summary, { chapterId: 'ch-1', sentenceId: '1-1-0' })).toBe(60);
    expect(summaryProgress(summary, { chapterId: 'ch-1', sentenceId: '1-1-1' })).toBe(80);
    expect(summaryProgress(summary, { chapterId: 'ch-2', sentenceId: '2-3-0' })).toBe(100);
    expect(summaryChapterTitle(summary, '1-1-1')).toBe('Middle');
    expect(summaryChapterTitle(summary, '2-3-0')).toBe('Later');
  });

  it('opens a legacy database without reading books, then repairs lazily', async () => {
    const name = `readit-v2-upgrade-${newId()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      books: 'id, title, addedAt',
      highlights: 'id, bookId, createdAt',
      bookmarks: 'id, bookId',
      lexicon: 'id, source',
      audioCache: 'key, createdAt',
      settings: 'key',
    });
    legacy.version(2).stores({ bookContent: 'id' });
    await legacy.open();
    const original = book({ id: 'legacy', lastPos: { chapterId: 'ch1', sentenceId: '0-0-0' } });
    await legacy.table<BookRecord>('books').add(original);
    await legacy.close();

    const upgraded = new ReadItDB(name);
    const reads: string[] = [];
    let watching = true;
    upgraded.books.hook('reading', (record) => {
      if (watching) reads.push(record.id);
      return record;
    });
    try {
      await upgraded.open();
      expect(upgraded.verno).toBe(4);
      expect(reads).toEqual([]);
      expect(await upgraded.bookSummaries.get('legacy')).toBeUndefined();

      expect(await repairBookSummaries(upgraded)).toBe(1);
      expect(reads).toEqual(['legacy']);
      watching = false;
      expect(await upgraded.books.get('legacy')).toMatchObject({
        id: 'legacy',
        title: 'Moby Dick',
        parsed: original.parsed,
        lastPos: original.lastPos,
      });
      expect(await upgraded.bookSummaries.get('legacy')).toMatchObject({
        id: 'legacy',
        chapterCount: 1,
        sentenceCount: 1,
      });
    } finally {
      watching = false;
      await upgraded.delete();
    }
  });

  it('renders the shelf without reading full book rows once summaries exist', async () => {
    const b = book();
    await db.books.add(b);
    await putBookSummary(b);
    const toArray = vi.spyOn(db.books, 'toArray');
    const bulkGet = vi.spyOn(db.books, 'bulkGet');
    const get = vi.spyOn(db.books, 'get');

    const shelf = await listLibraryBooks();

    expect(shelf).toEqual([{
      id: b.id,
      title: b.title,
      author: b.author,
      format: b.format,
      addedAt: b.addedAt,
      columns: undefined,
      chapterCount: 1,
      progress: null,
      unavailable: false,
    }]);
    expect(toArray).not.toHaveBeenCalled();
    expect(bulkGet).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps shelf queries read-only and repairs one legacy record at a time', async () => {
    const books = Array.from({ length: BOOK_SUMMARY_REPAIR_BATCH + 1 }, (_, at) => book({
      id: `legacy-${at}`,
      addedAt: at + 1,
    }));
    await db.books.bulkAdd(books);
    const realGet = db.books.get.bind(db.books);
    let activeReads = 0;
    let maxActiveReads = 0;
    const get = vi.spyOn(db.books, 'get').mockImplementation((async (key: string) => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      try {
        return await realGet(key);
      } finally {
        activeReads -= 1;
      }
    }) as typeof db.books.get);
    const bulkGet = vi.spyOn(db.books, 'bulkGet');
    const toArray = vi.spyOn(db.books, 'toArray');
    const summaryPut = vi.spyOn(db.bookSummaries, 'put');
    const summaryBulkPut = vi.spyOn(db.bookSummaries, 'bulkPut');

    const first = await listLibraryBooks();
    expect(first.filter((row) => row.unavailable)).toHaveLength(BOOK_SUMMARY_REPAIR_BATCH + 1);
    expect(first.find((row) => row.unavailable)).toMatchObject({
      title: 'Book details unavailable',
      chapterCount: null,
      progress: null,
    });
    expect(get).not.toHaveBeenCalled();
    expect(bulkGet).not.toHaveBeenCalled();
    expect(toArray).not.toHaveBeenCalled();
    expect(summaryPut).not.toHaveBeenCalled();
    expect(summaryBulkPut).not.toHaveBeenCalled();

    expect(await repairBookSummaries()).toBe(BOOK_SUMMARY_REPAIR_BATCH);
    expect(get).toHaveBeenCalledTimes(BOOK_SUMMARY_REPAIR_BATCH);
    expect(maxActiveReads).toBe(1);
    expect(bulkGet).not.toHaveBeenCalled();
    expect(summaryBulkPut).toHaveBeenCalledTimes(1);
    expect(summaryBulkPut.mock.calls[0]?.[0]).toHaveLength(BOOK_SUMMARY_REPAIR_BATCH);
    const second = await listLibraryBooks();
    expect(second.filter((row) => row.unavailable).map((row) => row.id)).toEqual(['legacy-0']);

    expect(await repairBookSummaries()).toBe(1);
    expect(get).toHaveBeenCalledTimes(BOOK_SUMMARY_REPAIR_BATCH + 1);
    expect(maxActiveReads).toBe(1);
    expect(get).toHaveBeenLastCalledWith('legacy-0');
    expect((await listLibraryBooks()).every((row) => !row.unavailable)).toBe(true);
  });

  it.each(['chapter', 'block'] as const)('turns a malformed %s summary into a repairable placeholder', async (kind) => {
    const b = book();
    await db.books.add(b);
    const malformed = summarizeBook(b);
    if (kind === 'chapter') malformed.chapters = [null as never];
    else malformed.chapters[0]!.blocks = [null as never];
    await db.bookSummaries.put(malformed);

    await expect(listLibraryBooks()).resolves.toMatchObject([{ id: b.id, unavailable: true }]);
    expect(await repairBookSummaries()).toBe(1);
    await expect(listLibraryBooks()).resolves.toMatchObject([{ id: b.id, unavailable: false, chapterCount: 1 }]);
  });

  it.each([
    ['author', { author: { nested: true } }],
    ['columns', { columns: 3 }],
    ['lastPos', { lastPos: { chapterId: 1, sentenceId: null } }],
  ] as const)('turns a malformed optional %s field into a repairable placeholder', async (_field, patch) => {
    const b = book();
    await db.books.add(b);
    const malformed = { ...summarizeBook(b), ...patch } as unknown as ReturnType<typeof summarizeBook>;
    await db.bookSummaries.put(malformed);

    await expect(listLibraryBooks()).resolves.toMatchObject([{ id: b.id, unavailable: true }]);
    expect(await repairBookSummaries()).toBe(1);
    await expect(listLibraryBooks()).resolves.toMatchObject([{ id: b.id, unavailable: false }]);
  });

  it('uses the reader position setting so playback progress is not stale', async () => {
    const b = book({ lastPos: { chapterId: 'ch1', sentenceId: '0-0-0' } });
    b.parsed.chapters[0]!.blocks[0]!.sentences.push({ id: '0-0-1', text: 'The sea widened.' });
    await db.books.add(b);
    await putBookSummary(b);
    expect((await listLibraryBooks())[0]?.progress).toBe(50);

    await db.settings.put({
      key: `reader.lastPos.${b.id}`,
      value: { chapterId: 'ch1', sentenceId: '0-0-1' },
    });

    expect((await listLibraryBooks())[0]?.progress).toBe(100);
  });
});
