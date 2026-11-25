/**
 * Full-device backup: every IndexedDB table as JSON plus, optionally, the
 * original book files. One zip, imported back on this or another device.
 *
 * An imported zip is untrusted input from a trust boundary: entry names are
 * whitelisted, sizes are capped and every record field that the app reads later
 * is type-checked before a single row reaches the database.
 */
import {
  Zip,
  ZipDeflate,
  ZipPassThrough,
  strFromU8,
  strToU8,
  unzip,
  type Unzipped,
  type UnzipFileInfo,
} from 'fflate';
import type { Table } from 'dexie';
import { db, summarizeBook } from '../core/db';
import type { StoredContent } from '../core/contentStore';
import { isIos } from '../core/platform';
import { BLOCK_KINDS } from '../core/types';
import type {
  Block,
  BookRecord,
  Chapter,
  DocFormat,
  Highlight,
  ParsedDoc,
  PdfRect,
  Sentence,
  Setting,
} from '../core/types';
import { resetAudioSizeCache } from '../tts/cache';

export const BACKUP_APP = 'Read IT';
/**
 * 2: one `data/books/<id>.json` entry per book instead of one huge books.json.
 * 3: one `content/<id>.bin` entry per compressed document plus its codec in
 *    `data/bookContent.json`.
 */
export const BACKUP_SCHEMA = 3;
/** Format 1 zips (one `data/books.json`) must stay importable. */
const LEGACY_SCHEMA = 1;
/** Format 2 has no content store; it imports with the book rows alone. */
const PREVIOUS_SCHEMA = 2;
const READABLE_SCHEMAS = [LEGACY_SCHEMA, PREVIOUS_SCHEMA, BACKUP_SCHEMA];

/**
 * Private settings are per-device. A credential and the base URL it belongs to
 * must never travel in a backup: importing someone else's zip could otherwise
 * silently point this app at their server.
 */
export const PRIVATE_SETTING_PREFIX = 'private.';

/** Refuse absurd archives before allocating memory for them. */
const MAX_ZIP_BYTES = 2 * 1024 ** 3;
/**
 * What an iPhone or iPad can unzip in a tab. The whole archive is held in memory
 * once and every entry it carries is decompressed beside it, and iOS Safari kills
 * the tab somewhere between 1 GB and 1.5 GB — so the 2 GB a desktop chews
 * through would be a crash, not an import.
 */
const IOS_ZIP_BYTES = 500 * 1024 ** 2;
const MAX_ENTRY_BYTES = 1024 ** 3;
/** Table JSON is parsed in one go, so it gets a tighter cap than book files. */
const MAX_JSON_BYTES = 256 * 1024 ** 2;
/**
 * One parsed book is parsed on its own, so it gets its own cap rather than
 * sharing the table cap with every other book in the library.
 */
const MAX_BOOK_JSON_BYTES = 128 * 1024 ** 2;
const MAX_TOTAL_BYTES = 2 * 1024 ** 3;
const MAX_ROWS = 200_000;

/** Streamed in slices so a big library is never read into memory all at once. */
const READ_CHUNK = 4 * 1024 * 1024;

export type ImportMode = 'merge' | 'replace';

export interface BackupManifest {
  app: string;
  schema: number;
  exportedAt: string;
  counts: Record<string, number>;
}

export interface ImportReport {
  mode: ImportMode;
  /** Rows written, by table: inserted on Merge and overwritten on Replace. */
  counts: Record<string, number>;
  /** Incoming rows not written because of duplicates, collisions or orphan content. */
  skipped: Record<string, number>;
  /** Skipped rows whose id collided locally, with a book aggregate or in the backup itself. */
  collisions: Record<string, number>;
  /** Book ids whose original file was not inside the zip. */
  missingFile: string[];
  /** True only after a successful Replace transaction also cleared cached audio. */
  audioCleared: boolean;
}

const MIME: Record<DocFormat, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
};

const FORMATS = ['pdf', 'epub', 'docx', 'txt', 'md', 'html'] as const satisfies readonly DocFormat[];
const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;

const LEXICON_SOURCES = ['builtin', 'user'] as const;
const BOOK_LAYOUTS = ['model', 'heuristic'] as const;

/** Ids end up in zip paths, so no separators and no "..". */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BOOK_FILE_RE = /^books\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.(pdf|epub|docx|txt|md|html)$/;
/** Schema 2: one book record per entry. The id pattern mirrors ID_RE. */
const BOOK_JSON_RE = /^data\/books\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.json$/;
/** Schema 3: already-compressed document bytes, one entry per book. */
const CONTENT_BIN_RE = /^content\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.bin$/;

/** Every portable table except the audio cache and the rebuildable shelf index. */
function dataTables(): Table[] {
  return db.tables.filter((t) => t.name !== 'audioCache' && t.name !== 'bookSummaries');
}

function isPrivateSetting(row: Setting): boolean {
  return row.key.startsWith(PRIVATE_SETTING_PREFIX);
}

/** Hour and minute in the name: a second export the same day must not overwrite the first on the phone. */
export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `readit-backup-${day}-${pad(date.getHours())}${pad(date.getMinutes())}.zip`;
}

/** Setting key written after every successful export. */
export const LAST_EXPORT_SETTING = 'backup.lastExportAt';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Last backup: today / N days ago / never". Calendar days are not used: what
 * matters is how stale the backup is, and a whole day is the right resolution.
 */
export function lastBackupLabel(last: number | undefined, now = Date.now()): string {
  if (typeof last !== 'number' || !Number.isFinite(last) || last <= 0) return 'Last backup: never';
  const days = Math.floor((now - last) / DAY_MS);
  if (days <= 0) return 'Last backup: today';
  return `Last backup: ${days} day${days === 1 ? '' : 's'} ago`;
}

interface ZipEntry {
  name: string;
  data: Uint8Array | Blob;
  /** Content bytes are already deflated; store them instead of deflating twice. */
  store?: boolean;
}

export async function exportBackup({ includeBooks }: { includeBooks: boolean }): Promise<Blob> {
  const entries: ZipEntry[] = [];
  const counts: Record<string, number> = {};

  // Read the books table once: its rows are both the records and the source of
  // the raw files, and a full library is far too big to read twice.
  const books = (await db.books.toArray()) as BookRecord[];
  counts.books = books.length;
  // One small entry per book: a 100 MB books.json would have to be built and
  // parsed in one piece, which a phone cannot do for a full library.
  for (const book of books) {
    const row = stripFileBlob(book);
    entries.push({ name: `data/books/${book.id}.json`, data: strToU8(JSON.stringify(row)) });
  }

  for (const table of dataTables()) {
    if (table.name === 'books' || table.name === 'bookContent') continue;
    let rows: unknown[] = await table.toArray();
    if (table.name === 'settings') rows = rows.filter((row) => !isPrivateSetting(row as Setting));
    counts[table.name] = rows.length;
    entries.push({ name: `data/${table.name}.json`, data: strToU8(JSON.stringify(rows)) });
  }

  // Documents live outside the book rows, one entry each: the bytes are already
  // deflated (or plain UTF-8), so a small manifest records how to read them.
  const contentRows = (await db.bookContent.toArray()) as StoredContent[];
  const contentManifest: { id: string; codec: StoredContent['codec'] }[] = [];
  for (const row of contentRows) {
    const bytes = contentRowBytes(row);
    if (!bytes || !sourceId(row) || (row.codec !== 'deflate-raw' && row.codec !== 'none')) continue;
    contentManifest.push({ id: row.id, codec: row.codec });
    entries.push({ name: `content/${row.id}.bin`, data: new Uint8Array(bytes), store: true });
  }
  counts.bookContent = contentManifest.length;
  if (contentManifest.length) {
    entries.push({ name: 'data/bookContent.json', data: strToU8(JSON.stringify(contentManifest)) });
  }

  if (includeBooks) {
    for (const book of books) {
      // fake-indexeddb (tests) hands blobs back as plain objects.
      if (!(book.fileBlob instanceof Blob)) continue;
      // Already-compressed formats gain nothing from deflate.
      entries.push({ name: `books/${book.id}.${book.format}`, data: book.fileBlob });
    }
  }

  const manifest: BackupManifest = {
    app: BACKUP_APP,
    schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    counts,
  };
  entries.unshift({ name: 'manifest.json', data: strToU8(JSON.stringify(manifest)) });

  return buildZip(entries);
}

/**
 * Stream entries into the archive one slice at a time: `zipSync`/`zip` would
 * hold every book in memory at once, which a phone cannot do for a full library.
 */
async function buildZip(entries: ZipEntry[]): Promise<Blob> {
  // One Blob per chunk, as the compressor produces it. Holding the chunks as
  // Uint8Arrays and building the Blob at the end would put a second full copy of
  // the archive in memory at the worst moment: a 400 MB library then needs 800 MB.
  const parts: Blob[] = [];
  let failure: Error | null = null;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const zip = new Zip((err, chunk, final) => {
    if (err) failure ??= new Error(`Could not build the backup zip: ${err.message}`);
    else if (chunk.length) parts.push(new Blob([chunk as unknown as BlobPart]));
    if (final) finish();
  });

  for (const entry of entries) {
    if (failure) break;
    if (entry.data instanceof Blob) {
      const blob: Blob = entry.data;
      const file = new ZipPassThrough(entry.name);
      zip.add(file);
      if (blob.size === 0) file.push(new Uint8Array(0), true);
      for (let offset = 0; offset < blob.size; offset += READ_CHUNK) {
        const end = Math.min(offset + READ_CHUNK, blob.size);
        const chunk = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
        file.push(chunk, end === blob.size);
      }
    } else {
      const file = entry.store
        ? new ZipPassThrough(entry.name)
        : new ZipDeflate(entry.name, { level: 6 });
      zip.add(file);
      file.push(entry.data, true);
    }
  }

  if (failure) {
    zip.terminate();
    throw failure;
  }
  zip.end();
  await done;
  if (failure) throw failure;
  // The parts are already Blobs, so this concatenates references, not bytes.
  return new Blob(parts, { type: 'application/zip' });
}

export async function importBackup(file: Blob, mode: ImportMode): Promise<ImportReport> {
  const tables = dataTables();
  const files = await readZip(file);
  checkManifest(files);

  // Everything is validated and prepared before the write transaction opens, so
  // a bad record fails with the database untouched.
  const payload = await readPayload(files, tables);
  const bookRows = (payload.get('books') ?? []) as Omit<BookRecord, 'fileBlob'>[];
  checkBookFiles(files, bookRows);

  const missingFile: string[] = [];
  const prepared = new Map<string, unknown[]>();
  for (const [name, rows] of payload) {
    prepared.set(
      name,
      name === 'books' ? await attachBookFiles(bookRows, files, missingFile, mode) : rows,
    );
  }

  const counts: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const collisions: Record<string, number> = {};
  // Replace clears rebuildable audio in the same transaction as the restore.
  // Merge does not include that store, so cached speech survives untouched.
  const transactionTables = mode === 'replace'
    ? [...tables, db.bookSummaries, db.audioCache]
    : [...tables, db.bookSummaries];

  await db.transaction('rw', transactionTables, async () => {
    if (mode === 'replace') {
      // Settings survive on purpose: they hold this device's private config,
      // which the export omits — wiping them would lock the user out.
      for (const table of tables) if (table.name !== 'settings') await table.clear();
      await db.bookSummaries.clear();
      await db.audioCache.clear();
    }

    const bookTable = db.books as Table<unknown, string>;
    const incomingBooks = prepared.get('books') ?? [];
    let writtenBooks: WrittenRows = { insertedKeys: new Set(), rows: [] };
    if (incomingBooks.length > 0) {
      writtenBooks = mode === 'replace'
        ? await replaceRows(bookTable, incomingBooks, counts, skipped, collisions)
        : await mergeRows(bookTable, incomingBooks, counts, skipped, collisions);
    }
    const incomingBookIds = new Set(incomingBooks.map((row) => rowKey(bookTable, row)));
    // Summaries are derived from the rows that actually won the merge/replace,
    // never copied from the archive. This keeps schema 3 (and older zips) portable.
    if (writtenBooks.rows.length) {
      await db.bookSummaries.bulkPut(writtenBooks.rows.map((row) => summarizeBook(row as BookRecord)));
    }

    for (const table of tables) {
      if (table.name === 'books' || table.name === 'bookContent') continue;
      const rows = prepared.get(table.name) ?? [];
      if (rows.length === 0) continue;
      if (mode === 'replace') {
        await replaceRows(table as Table<unknown, string>, rows, counts, skipped, collisions);
      } else {
        await mergeRows(table as Table<unknown, string>, rows, counts, skipped, collisions);
      }
    }

    const contentRows = prepared.get('bookContent') ?? [];
    if (contentRows.length === 0) return;
    const contentTable = db.bookContent as Table<unknown, string>;
    if (mode === 'replace') {
      await replaceContentRows(
        contentTable,
        contentRows,
        writtenBooks.insertedKeys,
        counts,
        skipped,
        collisions,
      );
    } else {
      await mergeContentRows(
        bookTable,
        contentTable,
        contentRows,
        writtenBooks.insertedKeys,
        incomingBookIds,
        counts,
        skipped,
        collisions,
      );
    }
  });

  // The transaction promise resolves only after commit. A failed restore leaves
  // both the rows and the memoised audio size exactly as they were.
  if (mode === 'replace') resetAudioSizeCache();
  return { mode, counts, skipped, collisions, missingFile, audioCleared: mode === 'replace' };
}

interface WrittenRows {
  insertedKeys: Set<string>;
  rows: unknown[];
}

interface UniqueRows {
  rows: Map<string, unknown>;
  duplicateCount: number;
}

/** The validated tables all use a single string primary key. */
function rowKey(table: Table<unknown, string>, row: unknown): string {
  const keyPath = table.schema.primKey.keyPath;
  if (typeof keyPath !== 'string') throw new Error('This backup uses an unsupported primary key.');
  const key = (row as Record<string, unknown>)[keyPath];
  if (typeof key !== 'string') throw new Error('This backup contains a row without a valid id.');
  return key;
}

/** Keep the first incoming row for an id, but retain duplicates for the report. */
function uniqueRows(table: Table<unknown, string>, rows: unknown[]): UniqueRows {
  const unique = new Map<string, unknown>();
  let duplicateCount = 0;
  for (const row of rows) {
    const key = rowKey(table, row);
    if (unique.has(key)) duplicateCount++;
    else unique.set(key, row);
  }
  return { rows: unique, duplicateCount };
}

function addCount(target: Record<string, number>, table: string, count: number): void {
  if (count > 0) target[table] = (target[table] ?? 0) + count;
}

/** Add only absent keys; an existing local row always wins, regardless of age. */
async function mergeRows(
  table: Table<unknown, string>,
  rows: unknown[],
  counts: Record<string, number>,
  skipped: Record<string, number>,
  collisions: Record<string, number>,
): Promise<WrittenRows> {
  const unique = uniqueRows(table, rows);
  const existingKeys = new Set<string>();
  for (const row of await table.bulkGet([...unique.rows.keys()])) {
    if (row !== undefined) existingKeys.add(rowKey(table, row));
  }
  const absent = [...unique.rows].filter(([key]) => !existingKeys.has(key));
  if (absent.length) await table.bulkAdd(absent.map(([, row]) => row));

  counts[table.name] = absent.length;
  addCount(skipped, table.name, rows.length - absent.length);
  addCount(collisions, table.name, unique.duplicateCount + existingKeys.size);
  return { insertedKeys: new Set(absent.map(([key]) => key)), rows: absent.map(([, row]) => row) };
}

/** Replace still overwrites local keys; repeated incoming ids resolve first-wins. */
async function replaceRows(
  table: Table<unknown, string>,
  rows: unknown[],
  counts: Record<string, number>,
  skipped: Record<string, number>,
  collisions: Record<string, number>,
): Promise<WrittenRows> {
  const unique = uniqueRows(table, rows);
  if (unique.rows.size) await table.bulkPut([...unique.rows.values()]);
  counts[table.name] = unique.rows.size;
  addCount(skipped, table.name, unique.duplicateCount);
  addCount(collisions, table.name, unique.duplicateCount);
  return { insertedKeys: new Set(unique.rows.keys()), rows: [...unique.rows.values()] };
}

/**
 * Content belongs to its book. Merge may add it only beside a book that was
 * actually inserted; a local book keeps both its metadata and its document.
 * A content row with no incoming/local book is an orphan and is left out.
 */
async function mergeContentRows(
  bookTable: Table<unknown, string>,
  table: Table<unknown, string>,
  rows: unknown[],
  insertedBookIds: Set<string>,
  incomingBookIds: Set<string>,
  counts: Record<string, number>,
  skipped: Record<string, number>,
  collisions: Record<string, number>,
): Promise<void> {
  const unique = uniqueRows(table, rows);
  const contentIds = [...unique.rows.keys()];
  const existingKeys = new Set<string>();
  for (const row of await table.bulkGet(contentIds)) {
    if (row !== undefined) existingKeys.add(rowKey(table, row));
  }
  // A content-only archive must not attach itself to a book already here. Look
  // up the aggregate owner inside this same transaction, not before it opens.
  const existingBookIds = new Set<string>();
  for (const row of await bookTable.bulkGet(contentIds)) {
    if (row !== undefined) existingBookIds.add(rowKey(bookTable, row));
  }

  const absent: unknown[] = [];
  let collisionRows = 0;
  for (const [id, row] of unique.rows) {
    const blockedByBook = !insertedBookIds.has(id);
    const aggregateCollision = blockedByBook && (incomingBookIds.has(id) || existingBookIds.has(id));
    const keyCollision = existingKeys.has(id);
    if (aggregateCollision || keyCollision) collisionRows++;
    if (!blockedByBook && !keyCollision) absent.push(row);
  }
  if (absent.length) await table.bulkAdd(absent);

  counts[table.name] = absent.length;
  addCount(skipped, table.name, rows.length - absent.length);
  addCount(collisions, table.name, unique.duplicateCount + collisionRows);
}

/** Replace writes content only for books in the same archive, never orphans. */
async function replaceContentRows(
  table: Table<unknown, string>,
  rows: unknown[],
  writtenBookIds: Set<string>,
  counts: Record<string, number>,
  skipped: Record<string, number>,
  collisions: Record<string, number>,
): Promise<void> {
  const unique = uniqueRows(table, rows);
  const accepted = [...unique.rows].filter(([id]) => writtenBookIds.has(id));
  if (accepted.length) await table.bulkPut(accepted.map(([, row]) => row));
  counts[table.name] = accepted.length;
  addCount(skipped, table.name, rows.length - accepted.length);
  addCount(collisions, table.name, unique.duplicateCount);
}

function stripFileBlob(book: unknown): unknown {
  const copy = { ...(book as BookRecord) } as Partial<BookRecord>;
  delete copy.fileBlob;
  return copy;
}

/** Ids become zip paths, so a row with an unsafe id is never exported. */
function sourceId(row: StoredContent): string | null {
  return typeof row.id === 'string' && ID_RE.test(row.id) && !row.id.includes('..') ? row.id : null;
}

/** IndexedDB hands an ArrayBuffer back unchanged; hand-edited rows may not. */
function contentRowBytes(row: StoredContent): ArrayBuffer | null {
  const bytes: unknown = row.bytes;
  if (bytes instanceof ArrayBuffer) return bytes;
  // fake-indexeddb (tests) clones across realms, so instanceof is not enough.
  if (Object.prototype.toString.call(bytes) === '[object ArrayBuffer]') return bytes as ArrayBuffer;
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice().buffer;
  }
  return null;
}

/** Attach the raw file; books whose file is absent get an empty Blob. */
async function attachBookFiles(
  rows: Omit<BookRecord, 'fileBlob'>[],
  files: Unzipped,
  missing: string[],
  mode: ImportMode,
): Promise<BookRecord[]> {
  const books: BookRecord[] = [];
  for (const record of rows) {
    const name = `books/${record.id}.${record.format}`;
    const bytes = files[name];
    let fileBlob: Blob;
    if (bytes) {
      fileBlob = new Blob([bytes], { type: MIME[record.format] });
      // The Blob keeps its own copy of the bytes, and the unzipped entry is dead
      // weight now: dropping it here means a library is never in memory twice.
      delete files[name];
    } else if (mode === 'replace') {
      // Replace overwrites the row, so retain a local file when this is a
      // notes-only restore. Merge never needs it: an existing id loses the
      // collision, and an absent id cannot already have a file.
      const existing = await db.books.get(record.id);
      if (existing?.fileBlob instanceof Blob) {
        fileBlob = existing.fileBlob;
      } else {
        fileBlob = new Blob([]);
        missing.push(record.id);
      }
    } else {
      fileBlob = new Blob([]);
      missing.push(record.id);
    }
    books.push({ ...record, fileBlob });
  }
  return books;
}

/** A book file may only ship with the book record it belongs to. */
function checkBookFiles(files: Unzipped, books: Omit<BookRecord, 'fileBlob'>[]): void {
  const byId = new Map<string, Omit<BookRecord, 'fileBlob'>>();
  // Duplicate incoming ids resolve first-wins in the transaction; validate the
  // accompanying file against that same record.
  for (const book of books) if (!byId.has(book.id)) byId.set(book.id, book);
  for (const name of Object.keys(files)) {
    const match = BOOK_FILE_RE.exec(name);
    if (!match) continue;
    const book = byId.get(match[1]);
    if (!book) throw new Error('This backup contains a book file that does not belong to any book in it.');
    if (book.format !== match[2]) throw new Error('This backup has a book file of the wrong type.');
  }
}

function checkManifest(files: Unzipped): void {
  const raw = files['manifest.json'];
  if (!raw) throw new Error('This zip is not a Read IT backup (no manifest.json).');
  let parsed: Partial<BackupManifest>;
  try {
    const value: unknown = JSON.parse(strFromU8(raw));
    parsed = (value && typeof value === 'object' ? value : {}) as Partial<BackupManifest>;
  } catch {
    throw new Error('This zip is not a Read IT backup (the manifest is not readable).');
  }
  if (parsed.app !== BACKUP_APP) {
    throw new Error('This zip is not a Read IT backup.');
  }
  if (typeof parsed.schema !== 'number' || !READABLE_SCHEMAS.includes(parsed.schema)) {
    throw new Error(
      `This backup uses format ${String(parsed.schema)}; this app reads formats ${READABLE_SCHEMAS.join(', ')}.`,
    );
  }
}

/**
 * Unzip while checking every entry: unknown names, path traversal and oversized
 * entries are refused, and a refused entry is never decompressed.
 */
async function readZip(file: Blob): Promise<Unzipped> {
  const limit = isIos() ? IOS_ZIP_BYTES : MAX_ZIP_BYTES;
  if (!(file.size <= limit)) {
    throw new Error(
      isIos()
        ? `That backup is too large to open on this device (over ${IOS_ZIP_BYTES / 1024 ** 2} MB). Import it on a computer.`
        : `That backup is too large (over ${gigabytes(MAX_ZIP_BYTES)}).`,
    );
  }
  // The one copy of the archive. fflate needs the whole buffer, and it is
  // released as soon as this function returns — `files` holds only the entries.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problems: string[] = [];
  let total = 0;

  const files = await new Promise<Unzipped>((resolve, reject) => {
    unzip(
      bytes,
      {
        filter: (info) => {
          // Directory entries carry no data and are harmless.
          if (info.name.endsWith('/')) return false;
          // One oversized document must not cost the rest of the backup: drop
          // just its entry. fflate never decompresses an entry the filter drops,
          // so a hostile size here cannot become an allocation either.
          if (CONTENT_BIN_RE.test(info.name) && info.originalSize > MAX_JSON_BYTES) return false;
          const problem = entryProblem(info);
          if (problem) {
            problems.push(problem);
            return false;
          }
          total += info.originalSize;
          // On iOS the expanded size is what the tab must hold, so it gets the same cap.
          const totalLimit = isIos() ? IOS_ZIP_BYTES : MAX_TOTAL_BYTES;
          if (total > totalLimit) {
            problems.push(`the archive expands to more than ${gigabytes(totalLimit)}`);
            return false;
          }
          return true;
        },
      },
      (err, data) => (err ? reject(new Error('That file is not a valid zip archive.')) : resolve(data)),
    );
  });

  if (problems.length) throw new Error(`This backup is not safe to import: ${problems[0]}.`);
  return files;
}

function entryProblem(info: UnzipFileInfo): string | null {
  const name = info.name;
  if (
    !name ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    name.split('/').includes('..')
  ) {
    return `the entry "${name}" has an unsafe path`;
  }
  if (info.originalSize > MAX_ENTRY_BYTES) return `the entry "${name}" is too large`;
  if (name === 'manifest.json') return null;
  const book = BOOK_JSON_RE.exec(name);
  if (book) {
    if (info.originalSize > MAX_BOOK_JSON_BYTES) return `the book "${book[1]}" is too large`;
    return null;
  }
  const data = /^data\/([A-Za-z0-9]+)\.json$/.exec(name);
  if (data) {
    if (info.originalSize > MAX_JSON_BYTES) return `the table "${data[1]}" is too large`;
    // Tables from older or other app versions are ignored rather than rejected.
    return null;
  }
  if (BOOK_FILE_RE.test(name)) return null;
  // Oversized content bins are dropped by readZip's filter rather than refused:
  // a damaged document must not cost the books around it.
  if (CONTENT_BIN_RE.test(name)) return null;
  return `the entry "${name}" is not part of a Read IT backup`;
}

async function readPayload(files: Unzipped, tables: Table[]): Promise<Map<string, unknown[]>> {
  const payload = new Map<string, unknown[]>();
  for (const table of tables) {
    if (table.name === 'bookContent') {
      const rows = readContentRows(files);
      if (rows.length > MAX_ROWS) {
        throw new Error(`This backup is too large: "bookContent" has more than ${MAX_ROWS} records.`);
      }
      if (rows.length) payload.set(table.name, rows);
      continue;
    }
    const raw = table.name === 'books' ? readBookRows(files) : readTable(files, table.name);
    if (!raw) continue;
    if (raw.length > MAX_ROWS) {
      throw new Error(`This backup is too large: "${table.name}" has more than ${MAX_ROWS} records.`);
    }
    let rows = raw.map((row) => validateRow(table.name, row)).filter((row) => row !== undefined);
    if (table.name === 'settings') rows = rows.filter((row) => !isPrivateSetting(row as Setting));
    payload.set(table.name, rows as unknown[]);
  }
  return payload;
}

/**
 * Content arrives as one `content/<id>.bin` per document, with the codec in
 * `data/bookContent.json`. An unreadable index, or a row whose id, codec or bytes
 * are unusable, is skipped: a damaged document must not cost the whole backup.
 * Bytes that defeat the decoder are left for `getContent`, which returns null
 * instead of throwing; inflating every document during import would also turn a
 * small deflate bomb into a large allocation on the phone.
 */
function readContentRows(files: Unzipped): StoredContent[] {
  const manifestRaw = files['data/bookContent.json'];
  if (!manifestRaw) return [];
  delete files['data/bookContent.json'];
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(manifestRaw));
  } catch {
    // The books and notes around a damaged index are still worth importing.
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const rows: StoredContent[] = [];
  const consumed = new Set<string>();
  const bytesById = new Map<string, ArrayBuffer>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as { id?: unknown; codec?: unknown };
    const id = typeof entry.id === 'string' && ID_RE.test(entry.id) && !entry.id.includes('..') ? entry.id : null;
    if (!id) continue;
    const codec = entry.codec;
    if (codec !== 'deflate-raw' && codec !== 'none') continue;
    const key = `content/${id}.bin`;
    const bytes = files[key];
    if (!bytes || bytes.byteLength > MAX_JSON_BYTES) continue;
    consumed.add(key);
    // A fresh ArrayBuffer: fflate may hand back a view into a larger buffer.
    // Repeated ids share that copy; only the first row is eventually written.
    let storedBytes = bytesById.get(id);
    if (!storedBytes) {
      storedBytes = new Uint8Array(bytes).buffer;
      bytesById.set(id, storedBytes);
    }
    rows.push({ id, codec, bytes: storedBytes });
  }
  for (const key of consumed) delete files[key];
  return rows;
}

/**
 * Book records arrive either as the schema-1 list (`data/books.json`) or as one
 * entry per book (`data/books/<id>.json`, schema 2). Both are accepted.
 */
function readBookRows(files: Unzipped): unknown[] {
  const rows: unknown[] = [];
  const legacy = readTable(files, 'books');
  if (legacy) rows.push(...legacy);
  for (const name of Object.keys(files)) {
    const match = BOOK_JSON_RE.exec(name);
    if (!match) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(strFromU8(files[name]!));
    } catch {
      throw new Error(`This backup is damaged: ${name} is not readable.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`This backup is damaged: ${name} is not a book record.`);
    }
    // The entry name is part of the format: a record must be filed under its own id.
    // Otherwise a backup can claim one book and deliver another.
    const id = (parsed as { id?: unknown }).id;
    if (typeof id === 'string' && id !== match[1]) {
      throw new Error(`This backup is damaged: ${name} does not hold book "${match[1]}".`);
    }
    // Parsed and validated: an iPhone importing a full library cannot keep the
    // encoded records in memory next to the parsed ones.
    delete files[name];
    rows.push(parsed);
  }
  return rows;
}

function readTable(files: Unzipped, name: string): unknown[] | undefined {
  const key = `data/${name}.json`;
  const raw = files[key];
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(raw));
  } catch {
    throw new Error(`This backup is damaged: data/${name}.json is not readable.`);
  }
  // The rows are plain objects now; the encoded bytes are one copy too many.
  delete files[key];
  if (!Array.isArray(parsed)) throw new Error(`This backup is damaged: data/${name}.json is not a list.`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Record validation. Every field the app reads later is checked here.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function validateRow(table: string, value: unknown): unknown {
  const raw = asObject(value, `a "${table}" record`);
  switch (table) {
    case 'books':
      return validateBook(raw, `a "books" record`);
    case 'highlights':
      return validateHighlight(raw, `a "highlights" record`);
    case 'bookmarks':
      return validateBookmark(raw, `a "bookmarks" record`);
    case 'lexicon':
      return validateLexicon(raw, `a "lexicon" record`);
    case 'settings':
      return validateSetting(raw, `a "settings" record`);
    default:
      // Tables removed from this app in an older build are ignored.
      return undefined;
  }
}

function fail(where: string, field: string): never {
  throw new Error(`This backup is damaged: ${where} has an invalid "${field}" field.`);
}

function asObject(value: unknown, where: string, field = 'record'): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, field);
  return value as Row;
}

function readId(value: unknown, where: string, field: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value) || value.includes('..')) fail(where, field);
  return value;
}

function readString(value: unknown, where: string, field: string, max = 4096): string {
  if (typeof value !== 'string' || value.length > max) fail(where, field);
  return value;
}

function readOptionalString(value: unknown, where: string, field: string, max = 4096): string | undefined {
  if (value === undefined || value === null) return undefined;
  return readString(value, where, field, max);
}

function readOptionalEnum<T extends string>(
  value: unknown,
  where: string,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined || value === null) return undefined;
  return readEnum(value, where, field, allowed);
}

function readNumber(value: unknown, where: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(where, field);
  return value;
}

function readBool(value: unknown, where: string, field: string): boolean {
  if (typeof value !== 'boolean') fail(where, field);
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  where: string,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(where, field);
  return value as T;
}

function readArray(value: unknown, where: string, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(where, field);
  return value;
}

function readStrings(value: unknown, where: string, field: string, max = 10_000): string[] {
  return readArray(value, where, field, max).map((item, i) => readString(item, where, `${field}[${i}]`));
}

function validateBook(raw: Row, where: string): Omit<BookRecord, 'fileBlob'> {
  const book: Omit<BookRecord, 'fileBlob'> = {
    id: readId(raw.id, where, 'id'),
    title: readString(raw.title, where, 'title', 1000),
    format: readEnum(raw.format, where, 'format', FORMATS),
    addedAt: readNumber(raw.addedAt, where, 'addedAt'),
    parsed: readDoc(raw.parsed, where),
    };
  const author = readOptionalString(raw.author, where, 'author', 1000);
  if (author !== undefined) book.author = author;
  const layout = readOptionalEnum(raw.layout, where, 'layout', BOOK_LAYOUTS);
  if (layout !== undefined) book.layout = layout;
  // Anything else (an older backup, a hand-edited file) means "detect".
  if (raw.columns === 'auto' || raw.columns === 1 || raw.columns === 2) book.columns = raw.columns;
  const lastPos = readLastPos(raw.lastPos, where);
  if (lastPos) book.lastPos = lastPos;
  return book;
}

function readLastPos(value: unknown, where: string): { chapterId: string; sentenceId: string } | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = asObject(value, where, 'lastPos');
  return {
    chapterId: readString(raw.chapterId, where, 'lastPos.chapterId', 200),
    sentenceId: readString(raw.sentenceId, where, 'lastPos.sentenceId', 200),
  };
}

function readDoc(value: unknown, where: string): ParsedDoc {
  const raw = asObject(value, where, 'parsed');
  const doc: ParsedDoc = {
    title: readString(raw.title, where, 'parsed.title', 1000),
    format: readEnum(raw.format, where, 'parsed.format', FORMATS),
    chapters: readArray(raw.chapters, where, 'parsed.chapters', 5000).map((chapter, i) =>
      readChapter(chapter, where, `parsed.chapters[${i}]`),
    ),
  };
  const author = readOptionalString(raw.author, where, 'parsed.author', 1000);
  if (author !== undefined) doc.author = author;
  // Export keeps this field; drop it on import and an EPUB with unreadable
  // spine files loses its "imported with a note" warning on the new device.
  const warning = readOptionalString(raw.warning, where, 'parsed.warning', 2000);
  if (warning !== undefined) doc.warning = warning;
  return doc;
}

function readChapter(value: unknown, where: string, field: string): Chapter {
  const raw = asObject(value, where, field);
  return {
    id: readString(raw.id, where, `${field}.id`, 200),
    title: readString(raw.title, where, `${field}.title`, 1000),
    blocks: readArray(raw.blocks, where, `${field}.blocks`, 50_000).map((block, i) =>
      readBlock(block, where, `${field}.blocks[${i}]`),
    ),
  };
}

function readBlock(value: unknown, where: string, field: string): Block {
  const raw = asObject(value, where, field);
  return {
    id: readString(raw.id, where, `${field}.id`, 200),
    kind: readEnum(raw.kind, where, `${field}.kind`, BLOCK_KINDS),
    sentences: readArray(raw.sentences, where, `${field}.sentences`, 50_000).map((sentence, i) =>
      readSentence(sentence, where, `${field}.sentences[${i}]`),
    ),
  };
}

function readSentence(value: unknown, where: string, field: string): Sentence {
  const raw = asObject(value, where, field);
  const sentence: Sentence = {
    id: readString(raw.id, where, `${field}.id`, 200),
    text: readString(raw.text, where, `${field}.text`, 20_000),
  };
  if (raw.pdfRects !== undefined && raw.pdfRects !== null) {
    sentence.pdfRects = readArray(raw.pdfRects, where, `${field}.pdfRects`, 5000).map((rect, i) =>
      readRect(rect, where, `${field}.pdfRects[${i}]`),
    );
  }
  const cfi = readOptionalString(raw.cfi, where, `${field}.cfi`, 2000);
  if (cfi !== undefined) sentence.cfi = cfi;
  return sentence;
}

function readRect(value: unknown, where: string, field: string): PdfRect {
  const raw = asObject(value, where, field);
  return {
    page: readNumber(raw.page, where, `${field}.page`),
    x: readNumber(raw.x, where, `${field}.x`),
    y: readNumber(raw.y, where, `${field}.y`),
    w: readNumber(raw.w, where, `${field}.w`),
    h: readNumber(raw.h, where, `${field}.h`),
  };
}

function validateHighlight(raw: Row, where: string): Highlight {
  const highlight: Highlight = {
    id: readId(raw.id, where, 'id'),
    bookId: readId(raw.bookId, where, 'bookId'),
    sentenceIds: readStrings(raw.sentenceIds, where, 'sentenceIds'),
    text: readString(raw.text, where, 'text', 100_000),
    color: readEnum(raw.color, where, 'color', HIGHLIGHT_COLORS),
    createdAt: readNumber(raw.createdAt, where, 'createdAt'),
  };
  const note = readOptionalString(raw.note, where, 'note', 100_000);
  if (note !== undefined) highlight.note = note;
  return highlight;
}

function validateBookmark(raw: Row, where: string) {
  const bookmark = {
    id: readId(raw.id, where, 'id'),
    bookId: readId(raw.bookId, where, 'bookId'),
    chapterId: readString(raw.chapterId, where, 'chapterId', 200),
    sentenceId: readString(raw.sentenceId, where, 'sentenceId', 200),
    createdAt: readNumber(raw.createdAt, where, 'createdAt'),
  };
  const label = readOptionalString(raw.label, where, 'label', 1000);
  return label === undefined ? bookmark : { ...bookmark, label };
}



function validateLexicon(raw: Row, where: string) {
  return {
    id: readId(raw.id, where, 'id'),
    pattern: readString(raw.pattern, where, 'pattern', 2000),
    replacement: readString(raw.replacement, where, 'replacement', 2000),
    isRegex: readBool(raw.isRegex, where, 'isRegex'),
    source: readEnum(raw.source, where, 'source', LEXICON_SOURCES),
    enabled: readBool(raw.enabled, where, 'enabled'),
  };
}

function validateSetting(raw: Row, where: string): Setting {
  if (!('value' in raw)) fail(where, 'value');
  return { key: readString(raw.key, where, 'key', 200), value: raw.value };
}

function gigabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 ** 3)} GB`;
}



