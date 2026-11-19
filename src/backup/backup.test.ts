import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../core/db';
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
