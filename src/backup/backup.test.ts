import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../core/db';
import { contentBytes, getContent, putContent } from '../core/contentStore';
import { getSetting, setSetting } from '../core/settings';
import type { BookRecord, Highlight } from '../core/types';
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
});

afterEach(() => {
  vi.restoreAllMocks();
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
    expect(await db.highlights.get('h1')).toBeTruthy();
    expect(await getSetting('theme', '')).toBe('dark');
  });

  it('replaces existing data in replace mode', async () => {
    await db.books.put(book('b1'));
    await db.highlights.put(highlight('h1', 'b1'));
    const backup = await exportBackup({ includeBooks: true });

    await clearAll();
    await db.books.put(book('b2'));
    await importBackup(new File([backup], 'backup.zip'), 'replace');

    expect((await db.books.toArray()).map((b) => b.id)).toEqual(['b1']);
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
