import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, putBookSummary } from '../core/db';
import { contentBytes, getContent, putContent } from '../core/contentStore';
import { getSetting, setSetting } from '../core/settings';
import type { AudioCacheRecord, Bookmark, BookRecord, Highlight, LexiconEntry } from '../core/types';
import { cacheSizeBytes, resetAudioSizeCache } from '../tts/cache';
import {
  BACKUP_APP,
  BACKUP_SCHEMA,
  LAST_EXPORT_SETTING,
  backupFileName,
  exportBackup,
  importBackup,
  lastBackupLabel,
  type BackupManifest,
} from './backup';

const NOW = 1_700_000_000_000;

function book(id: string): BookRecord {
  return {
    id,
    title: `Book ${id}`,
    format: 'txt',
    addedAt: NOW,
    fileBlob: new Blob(['ebook text']),
    parsed: { title: `Book ${id}`, format: 'txt', chapters: [] },
  };
}

function highlight(id: string, bookId: string): Highlight {
  return {
    id,
    bookId,
    sentenceIds: ['s-0'],
    text: 'An important sentence.',
    color: 'yellow',
    createdAt: NOW,
  };
}

function bookmark(id: string, bookId: string): Bookmark {
  return {
    id,
    bookId,
    chapterId: 'ch1',
    sentenceId: 's-0',
    createdAt: NOW,
  };
}

function lexicon(id: string, replacement: string): LexiconEntry {
  return {
    id,
    pattern: 'Example',
    replacement,
    isRegex: false,
    source: 'user',
    enabled: true,
  };
}

function audio(key: string): AudioCacheRecord {
  return {
    key,
    engine: 'system',
    // fake-indexeddb drops Blob bodies; cache accounting only reads `.size`.
    audio: { size: 3 } as Blob,
    durationMs: 1,
    createdAt: NOW,
  };
}

function readJson<T>(files: Unzipped, name: string): T {
  const raw = files[name];
  if (!raw) throw new Error(`missing ${name}`);
  return JSON.parse(strFromU8(raw)) as T;
}

async function openZip(blob: Blob): Promise<Unzipped> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

function zipBlob(files: Record<string, Uint8Array>): File {
  return new File([zipSync(files)], 'backup.zip', { type: 'application/zip' });
}

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

interface StoredEntry { name: string; data: Uint8Array; declaredSize?: number }

/**
 * A stored-only zip that can lie about an entry's uncompressed size. Building a
 * real 256 MB entry just to cross the import cap would make the suite allocate
 * a quarter of a gigabyte.
 */
function storedZip(entries: StoredEntry[]): ArrayBuffer {
  // Each local header is immediately followed by its data, as the format needs.
  const body: number[][] = [];
  const centrals: number[][] = [];
  let offset = 0;
  for (const e of entries) {
    const name = strToU8(e.name);
    const crc = crc32(e.data);
    const size = e.declaredSize ?? e.data.length;
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(e.data.length), ...u32(size), ...u16(name.length), ...u16(0), ...name,
    ];
    body.push(local, Array.from(e.data));
    centrals.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(e.data.length), ...u32(size), ...u16(name.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name,
    ]);
    offset += local.length + e.data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ];
  return new Uint8Array([...body.flat(), ...centrals.flat(), ...eocd]).buffer;
}

async function clearAll(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()));
}

beforeEach(async () => {
  await clearAll();
  resetAudioSizeCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAudioSizeCache();
});

describe('exportBackup', () => {
  it('writes a manifest and table data, without the audio cache', async () => {
    await db.books.put(book('b1'));
    await db.highlights.put(highlight('h1', 'b1'));
    await db.settings.put({ key: 'theme', value: 'dark' });
    await db.audioCache.put({ key: 'a1', engine: 'system', audio: new Blob(['x']), durationMs: 1, createdAt: NOW });

    const files = await openZip(await exportBackup({ includeBooks: false }));

    const parsed = readJson<BackupManifest>(files, 'manifest.json');
    expect(parsed.app).toBe(BACKUP_APP);
    expect(parsed.schema).toBe(BACKUP_SCHEMA);
    expect(parsed.counts.books).toBe(1);
    expect(Date.parse(parsed.exportedAt)).toBeGreaterThan(0);

    expect(readJson<Highlight[]>(files, 'data/highlights.json')).toHaveLength(1);
    expect(files['data/audioCache.json']).toBeUndefined();
    expect(files['data/bookSummaries.json']).toBeUndefined();
    expect(parsed.counts.bookSummaries).toBeUndefined();
  });

  it('includes the original book file when requested', async () => {
    const original = book('b1');
    await db.books.put(original);
    // fake-indexeddb clones a Blob into a plain object, and the exporter skips
    // anything that is not a real Blob. Hand it the record with its file intact
    // so the book entry in the archive can actually be checked.
    vi.spyOn(db.books, 'toArray').mockResolvedValue([original]);
    const files = await openZip(await exportBackup({ includeBooks: true }));
    expect(files['books/b1.txt']).toBeTruthy();
  });

  it('always exports book rows and counts content rows exactly', async () => {
    const original = book('b1');
    await db.books.put(original);
    await putContent('b1', '{"title":"Book b1"}');
    vi.spyOn(db.books, 'toArray').mockResolvedValue([original]);

    const withFiles = await openZip(await exportBackup({ includeBooks: true }));
    const withoutFiles = await openZip(await exportBackup({ includeBooks: false }));

    for (const files of [withFiles, withoutFiles]) {
      expect(readJson<BackupManifest>(files, 'manifest.json').counts.bookContent).toBe(1);
      expect(readJson<{ id: string }>(files, 'data/books/b1.json').id).toBe('b1');
      expect(readJson<{ id: string; codec: string }[]>(files, 'data/bookContent.json')).toHaveLength(1);
      expect(files['content/b1.bin']).toBeTruthy();
    }
    expect(withFiles['books/b1.txt']).toBeTruthy();
    expect(withoutFiles['books/b1.txt']).toBeUndefined();
  });
});

describe('importBackup', () => {
  it('restores books, highlights and settings in merge mode', async () => {
    await db.books.put(book('b1'));
    await db.highlights.put(highlight('h1', 'b1'));
    await db.settings.put({ key: 'theme', value: 'dark' });
    const backup = await exportBackup({ includeBooks: true });

    await clearAll();
    await db.books.put(book('b2'));

    const report = await importBackup(new File([backup], 'backup.zip'), 'merge');

    expect(report.mode).toBe('merge');
    expect((await db.books.toArray()).map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(await db.bookSummaries.get('b1')).toMatchObject({ id: 'b1', title: 'Book b1', chapterCount: 0 });
    expect(await db.highlights.get('h1')).toBeTruthy();
    expect(await getSetting('theme', '')).toBe('dark');
  });

  it('keeps newer local rows and book content when merge ids collide', async () => {
    const incomingBook = { ...book('shared'), title: 'Backup title', addedAt: NOW - 1000 };
    const incomingHighlight = {
      ...highlight('hl-shared', 'shared'),
      text: 'Backup highlight',
      note: 'Backup note',
      createdAt: NOW - 1000,
    };
    const incomingBookmark = { ...bookmark('bm-shared', 'shared'), label: 'Backup bookmark', createdAt: NOW - 1000 };
    const incomingLexicon = lexicon('lex-shared', 'Backup-ling');
    await db.books.put(incomingBook);
    await db.highlights.put(incomingHighlight);
    await db.bookmarks.put(incomingBookmark);
    await db.lexicon.put(incomingLexicon);
    await db.settings.put({ key: 'theme', value: 'dark' });
    await putContent('shared', '{"source":"backup"}');
    const backup = await exportBackup({ includeBooks: false });

    await clearAll();
    const localBook = {
      ...book('shared'),
      title: 'Newer local title',
      addedAt: NOW + 1000,
      lastPos: { chapterId: 'local-ch', sentenceId: 'local-s' },
    };
    const localHighlight = {
      ...highlight('hl-shared', 'shared'),
      text: 'Newer local highlight',
      note: 'Newer local note',
      createdAt: NOW + 1000,
    };
    const localBookmark = { ...bookmark('bm-shared', 'shared'), label: 'Newer local bookmark', createdAt: NOW + 1000 };
    const localLexicon = lexicon('lex-shared', 'Local-ling');
    await db.books.put(localBook);
    await putBookSummary(localBook);
    await db.highlights.put(localHighlight);
    await db.bookmarks.put(localBookmark);
    await db.lexicon.put(localLexicon);
    await db.settings.put({ key: 'theme', value: 'light' });
    await putContent('shared', '{"source":"local"}');
    const storedBook = await db.books.get('shared');

    const report = await importBackup(new File([backup], 'backup.zip'), 'merge');

    expect(await db.books.get('shared')).toEqual(storedBook);
    expect(await db.bookSummaries.get('shared')).toMatchObject({ title: 'Newer local title' });
    expect(await db.highlights.get('hl-shared')).toEqual(localHighlight);
    expect(await db.bookmarks.get('bm-shared')).toEqual(localBookmark);
    expect(await db.lexicon.get('lex-shared')).toEqual(localLexicon);
    expect(await getSetting('theme', '')).toBe('light');
    expect(await getContent('shared')).toBe('{"source":"local"}');
    expect(report.counts).toEqual({ books: 0, highlights: 0, bookmarks: 0, lexicon: 0, settings: 0, bookContent: 0 });
    expect(report.skipped).toEqual({ books: 1, highlights: 1, bookmarks: 1, lexicon: 1, settings: 1, bookContent: 1 });
    expect(report.collisions).toEqual(report.skipped);
    expect(report.audioCleared).toBe(false);
  });

  it('does not read colliding book rows for notes-only merge files', async () => {
    await db.books.put(book('shared'));
    const backup = await exportBackup({ includeBooks: false });
    await clearAll();
    await db.books.put(book('shared'));
    const get = vi.spyOn(db.books, 'get');

    const report = await importBackup(new File([backup], 'backup.zip'), 'merge');

    expect(get).not.toHaveBeenCalled();
    expect(report.counts.books).toBe(0);
    expect(report.missingFile).toContain('shared');
  });

  it('preserves a local file for a notes-only replace', async () => {
    await db.books.put(book('shared'));
    const backup = await exportBackup({ includeBooks: false });
    await clearAll();
    const local = book('shared');
    await db.books.put(local);
    const get = vi.spyOn(db.books, 'get').mockResolvedValue(local);
    const bulkPut = vi.spyOn(db.books, 'bulkPut');

    const report = await importBackup(new File([backup], 'backup.zip'), 'replace');

    expect(get).toHaveBeenCalledWith('shared');
    const written = bulkPut.mock.calls[0]?.[0][0];
    expect(written?.fileBlob).toBe(local.fileBlob);
    expect(report.missingFile).not.toContain('shared');
  });

  it('adds disjoint merge records without replacing local data', async () => {
    await db.books.put(book('from-backup'));
    await db.highlights.put(highlight('hl-backup', 'from-backup'));
    await db.bookmarks.put(bookmark('bm-backup', 'from-backup'));
    await db.lexicon.put(lexicon('lex-backup', 'Backup-ling'));
    await db.settings.put({ key: 'theme', value: 'dark' });
    const backup = await exportBackup({ includeBooks: false });

    await clearAll();
    await db.books.put(book('local'));
    await db.highlights.put(highlight('hl-local', 'local'));
    await db.bookmarks.put(bookmark('bm-local', 'local'));
    await db.lexicon.put(lexicon('lex-local', 'Local-ling'));
    await db.settings.put({ key: 'font', value: 'large' });

    const report = await importBackup(new File([backup], 'backup.zip'), 'merge');

    expect((await db.books.toArray()).map((row) => row.id).sort()).toEqual(['from-backup', 'local']);
    expect(await db.highlights.get('hl-backup')).toBeTruthy();
    expect(await db.highlights.get('hl-local')).toBeTruthy();
    expect(await db.bookmarks.get('bm-backup')).toBeTruthy();
    expect(await db.bookmarks.get('bm-local')).toBeTruthy();
    expect(await db.lexicon.get('lex-backup')).toBeTruthy();
    expect(await db.lexicon.get('lex-local')).toBeTruthy();
    expect(await getSetting('theme', '')).toBe('dark');
    expect(await getSetting('font', '')).toBe('large');
    expect(report.counts).toEqual({ books: 1, highlights: 1, bookmarks: 1, lexicon: 1, settings: 1 });
    expect(report.skipped).toEqual({});
    expect(report.collisions).toEqual({});
  });

  it('counts duplicate incoming ids and keeps the first row', async () => {
    const originalBook = book('duplicate');
    const originalHighlight = { ...highlight('hl-duplicate', 'duplicate'), note: 'First note' };
    const originalBookmark = { ...bookmark('bm-duplicate', 'duplicate'), label: 'First bookmark' };
    const originalLexicon = lexicon('lex-duplicate', 'First-ling');
    await db.books.put(originalBook);
    await db.highlights.put(originalHighlight);
    await db.bookmarks.put(originalBookmark);
    await db.lexicon.put(originalLexicon);
    await db.settings.put({ key: 'theme', value: 'first' });
    await putContent('duplicate', '{"source":"first"}');
    const files = await openZip(await exportBackup({ includeBooks: false }));

    const bookRecord = readJson<Omit<BookRecord, 'fileBlob'>>(files, 'data/books/duplicate.json');
    files['data/books.json'] = strToU8(JSON.stringify([bookRecord, { ...bookRecord, title: 'Second book' }]));
    delete files['data/books/duplicate.json'];
    files['data/highlights.json'] = strToU8(JSON.stringify([originalHighlight, { ...originalHighlight, note: 'Second note' }]));
    files['data/bookmarks.json'] = strToU8(JSON.stringify([originalBookmark, { ...originalBookmark, label: 'Second bookmark' }]));
    files['data/lexicon.json'] = strToU8(JSON.stringify([originalLexicon, { ...originalLexicon, replacement: 'Second-ling' }]));
    files['data/settings.json'] = strToU8(JSON.stringify([
      { key: 'theme', value: 'first' },
      { key: 'theme', value: 'second' },
    ]));
    const contentIndex = readJson<{ id: string; codec: 'none' | 'deflate-raw' }[]>(files, 'data/bookContent.json');
    files['data/bookContent.json'] = strToU8(JSON.stringify([...contentIndex, ...contentIndex]));

    await clearAll();
    const report = await importBackup(zipBlob(files), 'merge');

    expect(report.counts).toEqual({ books: 1, highlights: 1, bookmarks: 1, lexicon: 1, settings: 1, bookContent: 1 });
    expect(report.skipped).toEqual({ books: 1, highlights: 1, bookmarks: 1, lexicon: 1, settings: 1, bookContent: 1 });
    expect(report.collisions).toEqual(report.skipped);
    expect(await db.books.get('duplicate')).toMatchObject({ title: 'Book duplicate' });
    expect(await db.highlights.get('hl-duplicate')).toMatchObject({ note: 'First note' });
    expect(await db.bookmarks.get('bm-duplicate')).toMatchObject({ label: 'First bookmark' });
    expect(await db.lexicon.get('lex-duplicate')).toMatchObject({ replacement: 'First-ling' });
    expect(await getSetting('theme', '')).toBe('first');
    expect(await db.bookContent.count()).toBe(1);
  });

  it('skips orphan content instead of attaching it to an unrelated local book', async () => {
    const manifest: BackupManifest = {
      app: BACKUP_APP,
      schema: BACKUP_SCHEMA,
      exportedAt: new Date().toISOString(),
      counts: {},
    };
    const orphan = zipBlob({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'data/bookContent.json': strToU8(JSON.stringify([{ id: 'orphan', codec: 'none' }])),
      'content/orphan.bin': strToU8('{"source":"orphan"}'),
    });

    const first = await importBackup(orphan, 'merge');
    expect(first.counts.bookContent).toBe(0);
    expect(first.skipped.bookContent).toBe(1);
    expect(first.collisions.bookContent).toBeUndefined();
    expect(await db.bookContent.count()).toBe(0);

    await db.books.put(book('orphan'));
    const second = await importBackup(orphan, 'merge');
    expect(second.counts.bookContent).toBe(0);
    expect(second.skipped.bookContent).toBe(1);
    expect(second.collisions.bookContent).toBe(1);
    expect(await db.bookContent.count()).toBe(0);
  });

  it('replaces existing data and clears cached audio after commit', async () => {
    await db.books.put(book('new'));
    await db.highlights.put(highlight('hl-new', 'new'));
    await db.bookmarks.put(bookmark('bm-new', 'new'));
    await db.lexicon.put(lexicon('lex-shared', 'New-ling'));
    await db.settings.put({ key: 'theme', value: 'dark' });
    const backup = await exportBackup({ includeBooks: false });

    await clearAll();
    await db.books.put(book('old'));
    await putBookSummary(book('old'));
    await db.highlights.put(highlight('hl-old', 'old'));
    await db.bookmarks.put(bookmark('bm-old', 'old'));
    await putContent('old', '{"source":"old"}');
    await db.lexicon.put(lexicon('lex-shared', 'Old-ling'));
    await db.settings.put({ key: 'theme', value: 'light' });
    await db.settings.put({ key: 'private.token', value: 'keep' });
    await db.audioCache.put(audio('audio-old'));
    expect(await cacheSizeBytes()).toBe(3);

    const report = await importBackup(new File([backup], 'backup.zip'), 'replace');

    expect(await db.books.get('old')).toBeUndefined();
    expect(await db.books.get('new')).toBeTruthy();
    expect(await db.bookSummaries.get('old')).toBeUndefined();
    expect(await db.bookSummaries.get('new')).toMatchObject({ id: 'new', title: 'Book new' });
    expect(await db.highlights.get('hl-old')).toBeUndefined();
    expect(await db.highlights.get('hl-new')).toBeTruthy();
    expect(await db.bookmarks.get('bm-old')).toBeUndefined();
    expect(await db.bookmarks.get('bm-new')).toBeTruthy();
    expect(await getContent('old')).toBeNull();
    expect(await db.lexicon.get('lex-shared')).toMatchObject({ replacement: 'New-ling' });
    expect(await getSetting('theme', '')).toBe('dark');
    expect(await getSetting('private.token', '')).toBe('keep');
    expect(await db.audioCache.count()).toBe(0);
    expect(await cacheSizeBytes()).toBe(0);
    expect(report.audioCleared).toBe(true);
    expect(report.skipped).toEqual({});
    expect(report.collisions).toEqual({});
  });

  it('leaves cached audio untouched in merge mode', async () => {
    await db.books.put(book('from-backup'));
    const backup = await exportBackup({ includeBooks: false });

    await clearAll();
    await db.audioCache.put(audio('audio-local'));
    const storedAudio = await db.audioCache.get('audio-local');
    expect(await cacheSizeBytes()).toBe(3);

    const report = await importBackup(new File([backup], 'backup.zip'), 'merge');

    expect(await db.audioCache.get('audio-local')).toEqual(storedAudio);
    expect(await cacheSizeBytes()).toBe(3);
    expect(report.audioCleared).toBe(false);
  });

  it('rolls back a partially applied merge when a write fails', async () => {
    await db.books.put(book('incoming'));
    await db.highlights.put(highlight('hl-incoming', 'incoming'));
    const backup = await exportBackup({ includeBooks: false });

    await clearAll();
    await db.books.put(book('local'));
    await db.highlights.put(highlight('hl-local', 'local'));
    const highlights = db.tables.find((table) => table.name === 'highlights')!;
    const bulkAdd = vi.spyOn(highlights, 'bulkAdd').mockRejectedValueOnce(new Error('injected failure'));

    await expect(importBackup(new File([backup], 'backup.zip'), 'merge')).rejects.toThrow('injected failure');

    expect(bulkAdd).toHaveBeenCalledTimes(1);

    expect((await db.books.toArray()).map((row) => row.id)).toEqual(['local']);
    expect((await db.highlights.toArray()).map((row) => row.id)).toEqual(['hl-local']);
  });

  it('rolls back replace, including audio cleanup, when a later write fails', async () => {
    await db.books.put(book('new'));
    await db.settings.put({ key: 'theme', value: 'dark' });
    await putContent('new', '{"source":"backup"}');
    const backup = await exportBackup({ includeBooks: false });

    await clearAll();
    await db.books.put(book('local'));
    await db.settings.put({ key: 'theme', value: 'light' });
    await db.audioCache.put(audio('audio-local'));
    expect(await cacheSizeBytes()).toBe(3);
    vi.spyOn(db.bookContent, 'bulkPut').mockRejectedValueOnce(new Error('injected failure'));

    await expect(importBackup(new File([backup], 'backup.zip'), 'replace')).rejects.toThrow('injected failure');

    expect((await db.books.toArray()).map((row) => row.id)).toEqual(['local']);
    expect(await getSetting('theme', '')).toBe('light');
    expect(await db.audioCache.count()).toBe(1);
    expect(await cacheSizeBytes()).toBe(3);
  });

  it('round-trips compressed content beside its book', async () => {
    await db.books.put(book('b1'));
    const json = '{"title":"Book b1","format":"txt","chapters":[{"id":"ch1","title":"One","blocks":[]}]}';
    await putContent('b1', json);

    const backup = await exportBackup({ includeBooks: false });
    const files = await openZip(backup);
    expect(readJson<{ id: string; codec: string }[]>(files, 'data/bookContent.json')).toEqual([
      { id: 'b1', codec: expect.stringMatching(/^(deflate-raw|none)$/) },
    ]);
    expect(files['content/b1.bin']).toBeTruthy();

    await clearAll();
    const report = await importBackup(new File([backup], 'backup.zip'), 'merge');

    expect(report.counts.bookContent).toBe(1);
    expect(await getContent('b1')).toBe(json);
    expect(await contentBytes('b1')).toBeGreaterThan(0);
  });

  it('skips corrupt content entries instead of failing the import', async () => {
    await db.books.put(book('b1'));
    await putContent('b1', '{"title":"Book b1"}');
    const files = await openZip(await exportBackup({ includeBooks: false }));
    files['data/bookContent.json'] = strToU8(
      JSON.stringify([
        { id: 'b1', codec: 'deflate-raw' }, // its bytes entry is removed below
        { id: 'ghost', codec: 'none' }, // no bytes entry at all
        { id: 'b2', codec: 'zip' }, // unknown codec
      ]),
    );
    delete files['content/b1.bin'];
    files['content/b2.bin'] = strToU8('{}');

    await clearAll();
    await importBackup(zipBlob(files), 'merge');

    expect(await db.bookContent.count()).toBe(0);
    expect(await db.books.get('b1')).toBeTruthy();
  });

  it('accepts a schema-2 backup with no content store', async () => {
    await db.books.put(book('b1'));
    await putContent('b1', '{"title":"Book b1"}');
    const files = await openZip(await exportBackup({ includeBooks: false }));
    const manifest = readJson<BackupManifest>(files, 'manifest.json');
    manifest.schema = 2;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    delete files['data/bookContent.json'];
    delete files['content/b1.bin'];

    await clearAll();
    await importBackup(zipBlob(files), 'merge');

    expect(await db.books.get('b1')).toBeTruthy();
    expect(await db.bookSummaries.get('b1')).toMatchObject({ id: 'b1', chapterCount: 0 });
    expect(await db.bookContent.count()).toBe(0);
  });

  it('skips a malformed content manifest instead of failing the import', async () => {
    await db.books.put(book('b1'));
    const files = await openZip(await exportBackup({ includeBooks: false }));
    for (const bad of ['{not json', '{"id":"b1"}']) {
      files['data/bookContent.json'] = strToU8(bad);
      await clearAll();
      const report = await importBackup(zipBlob(files), 'merge');
      expect(await db.books.get('b1')).toBeTruthy();
      expect(await db.bookContent.count()).toBe(0);
      expect(report.counts.bookContent).toBeUndefined();
    }
  });

  it('keeps one row when the content manifest repeats an id', async () => {
    await db.books.put(book('b1'));
    const files = await openZip(await exportBackup({ includeBooks: false }));
    files['data/bookContent.json'] = strToU8(JSON.stringify([
      { id: 'b1', codec: 'none' },
      { id: 'b1', codec: 'none' },
    ]));
    files['content/b1.bin'] = strToU8('{"title":"Book b1"}');

    await clearAll();
    const report = await importBackup(zipBlob(files), 'merge');

    expect(report.counts.bookContent).toBe(1);
    expect(await db.bookContent.count()).toBe(1);
    expect(await getContent('b1')).toBe('{"title":"Book b1"}');
  });

  it('skips an oversized content entry instead of failing the import', async () => {
    const manifest: BackupManifest = {
      app: BACKUP_APP,
      schema: BACKUP_SCHEMA,
      exportedAt: new Date().toISOString(),
      counts: {},
    };
    const bytes = storedZip([
      { name: 'manifest.json', data: strToU8(JSON.stringify(manifest)) },
      { name: 'data/bookContent.json', data: strToU8(JSON.stringify([{ id: 'b1', codec: 'none' }])) },
      { name: 'content/b1.bin', data: strToU8('{}'), declaredSize: 300 * 1024 * 1024 },
    ]);

    const report = await importBackup(new File([bytes], 'backup.zip'), 'merge');

    expect(report.counts.bookContent).toBeUndefined();
    expect(await db.bookContent.count()).toBe(0);
  });

  it('imports corrupt deflate bytes without inflating them', async () => {
    await db.books.put(book('b1'));
    await db.bookContent.put({
      id: 'b1',
      codec: 'deflate-raw',
      bytes: new TextEncoder().encode('this is not a deflate stream').buffer,
    });
    const backup = await exportBackup({ includeBooks: false });

    await clearAll();
    const report = await importBackup(new File([backup], 'backup.zip'), 'merge');

    expect(report.counts.bookContent).toBe(1);
    // If import had inflated the payload it would have thrown before this point.
    await expect(getContent('b1')).resolves.toBeNull();
  });

  it('accepts a legacy schema-1 backup', async () => {
    await db.books.put(book('b1'));
    const files = await openZip(await exportBackup({ includeBooks: false }));
    const manifest = readJson<BackupManifest>(files, 'manifest.json');
    manifest.schema = 1;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    // Format 1 kept every book record in a single table file.
    const legacyRecord = JSON.parse(strFromU8(files['data/books/b1.json']!)) as unknown;
    files['data/books.json'] = strToU8(JSON.stringify([legacyRecord]));
    delete files['data/books/b1.json'];
    const legacy = zipBlob(files);

    await clearAll();
    await importBackup(legacy, 'merge');
    expect(await db.books.get('b1')).toBeTruthy();
  });

  it('rejects a zip that is not a Read IT backup', async () => {
    const other = zipBlob({ 'hello.txt': strToU8('nope') });
    await expect(importBackup(other, 'merge')).rejects.toThrow(/not (?:part of )?a Read IT backup/i);
  });
});

describe('backup helpers', () => {
  it('formats the backup file name', () => {
    expect(backupFileName(new Date(2026, 0, 9, 7, 5))).toBe('readit-backup-2026-01-09-0705.zip');
  });

  it('describes the last backup time', () => {
    expect(lastBackupLabel(0)).toBe('Last backup: never');
  });

  it('records the last export time', async () => {
    await setSetting(LAST_EXPORT_SETTING, NOW);
    expect(await getSetting(LAST_EXPORT_SETTING, 0)).toBe(NOW);
  });
});
