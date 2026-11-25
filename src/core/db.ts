import Dexie, { type Table } from 'dexie';
import type { StoredContent } from './contentStore';
import type {
  AudioCacheRecord,
  BookRecord,
  BookSummary,
  Bookmark,
  Highlight,
  LexiconEntry,
  LibraryBook,
  Setting,
} from './types';

/**
 * The single local-first store. Schema changes: add a new `version(n).stores(...)`
 * block and a `.upgrade()` — never edit an existing version, users already have it.
 */
export class ReadItDB extends Dexie {
  books!: Table<BookRecord, string>;
  highlights!: Table<Highlight, string>;
  bookmarks!: Table<Bookmark, string>;
  lexicon!: Table<LexiconEntry, string>;
  audioCache!: Table<AudioCacheRecord, string>;
  settings!: Table<Setting, string>;
  bookContent!: Table<StoredContent, string>;
  bookSummaries!: Table<BookSummary, string>;

  constructor(name = 'ReadItDB') {
    super(name);
    this.version(1).stores({
      books: 'id, title, addedAt',
      highlights: 'id, bookId, createdAt',
      bookmarks: 'id, bookId',
      lexicon: 'id, source',
      audioCache: 'key, createdAt',
      settings: 'key',
    });
    // Documents leave `books` for their own table; version 1 must stay untouched
    // because devices already have it.
    this.version(2).stores({
      bookContent: 'id',
    });
    // A rebuildable shelf index. It starts empty on upgrade; the library repairs
    // legacy rows lazily in bounded batches instead of blocking first launch on
    // every original Blob and parsed document.
    this.version(3).stores({
      bookSummaries: 'id, addedAt',
    });
    // Deleting one book's cached speech must not deserialize every audio Blob.
    this.version(4).stores({
      audioCache: 'key, createdAt, bookId, engine',
    });
  }
}

export const db = new ReadItDB();

/** Ids are UUIDs so separate devices/backups can merge without collisions. */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const READER_POSITION_PREFIX = 'reader.lastPos.';
/** Exceptional legacy/corrupt rows are repaired in small batches, never all at once. */
export const BOOK_SUMMARY_REPAIR_BATCH = 4;

type Position = { chapterId: string; sentenceId: string };

function validPosition(value: unknown): Position | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const pos = value as Partial<Position>;
  return typeof pos.chapterId === 'string' && typeof pos.sentenceId === 'string'
    ? { chapterId: pos.chapterId, sentenceId: pos.sentenceId }
    : undefined;
}

/**
 * Derive only the facts the shelf and notes export need. This walks a document
 * once at an import/re-analysis/upgrade, rather than on every library render.
 */
export function summarizeBook(book: BookRecord): BookSummary {
  const sourceChapters = Array.isArray(book.parsed?.chapters) ? book.parsed.chapters : [];
  let sentenceCount = 0;
  const chapters = sourceChapters.map((chapter) => {
    const sourceBlocks = Array.isArray(chapter.blocks) ? chapter.blocks : [];
    let chapterSentences = 0;
    const blocks = sourceBlocks.map((block) => {
      const count = Array.isArray(block.sentences) ? block.sentences.length : 0;
      chapterSentences += count;
      return { id: block.id, sentenceCount: count };
    });
    sentenceCount += chapterSentences;
    return {
      id: chapter.id,
      title: chapter.title,
      sentenceCount: chapterSentences,
      blocks,
    };
  });

  const summary: BookSummary = {
    id: book.id,
    title: book.title,
    format: book.format,
    addedAt: book.addedAt,
    chapterCount: chapters.length,
    sentenceCount,
    chapters,
  };
  if (book.author !== undefined) summary.author = book.author;
  if (book.columns !== undefined) summary.columns = book.columns;
  const lastPos = validPosition(book.lastPos);
  if (lastPos) summary.lastPos = lastPos;
  return summary;
}

function sentenceCoordinates(sentenceId: string): [number, number, number] | null {
  const match = /^(\d+)-(\d+)-(\d+)$/.exec(sentenceId);
  if (!match) return null;
  const coordinates = match.slice(1).map(Number) as [number, number, number];
  return coordinates.every(Number.isSafeInteger) ? coordinates : null;
}

/** Production ids are `b-<chapter>-<block>`; accept legacy `b-<block>` too. */
function blockIndexFromId(id: string, chapterIndex: number): number | null {
  const production = /^b-(\d+)-(\d+)$/.exec(id);
  if (production) {
    const chapter = Number(production[1]);
    const block = Number(production[2]);
    return chapter === chapterIndex && Number.isSafeInteger(block) ? block : null;
  }
  const legacy = /^b-(\d+)$/.exec(id);
  if (!legacy) return null;
  const block = Number(legacy[1]);
  return Number.isSafeInteger(block) ? block : null;
}

/** Exact percentage for Read IT's positional sentence ids, or null when unlocatable. */
export function summaryProgress(summary: BookSummary, position: Position | undefined): number | null {
  if (!position || !Array.isArray(summary.chapters)) return null;
  if (summary.sentenceCount === 0) return 0;

  const chapterIndex = summary.chapters.findIndex((chapter) => chapter?.id === position.chapterId);
  if (chapterIndex < 0) return null;
  const coordinates = sentenceCoordinates(position.sentenceId);
  if (!coordinates) return null;
  const [sentenceChapter, blockIndex, sentenceIndex] = coordinates;
  if (sentenceChapter !== chapterIndex) return null;

  const chapter = summary.chapters[chapterIndex]!;
  const blocks = Array.isArray(chapter.blocks) ? chapter.blocks : [];
  const blockAt = blocks.findIndex((block) => block && blockIndexFromId(block.id, chapterIndex) === blockIndex);
  if (blockAt < 0) return null;
  const block = blocks[blockAt]!;
  if (sentenceIndex >= block.sentenceCount) return null;

  let seen = sentenceIndex + 1;
  for (let at = 0; at < chapterIndex; at += 1) seen += summary.chapters[at]!.sentenceCount;
  for (let at = 0; at < blockAt; at += 1) seen += blocks[at]!.sentenceCount;
  return Math.round((seen / summary.sentenceCount) * 100);
}

/** Chapter title for a positional sentence id, used to keep notes export off book blobs. */
export function summaryChapterTitle(summary: BookSummary, sentenceId: string): string | undefined {
  if (!Array.isArray(summary.chapters)) return undefined;
  const coordinates = sentenceCoordinates(sentenceId);
  if (!coordinates) return undefined;
  const [chapterIndex, blockIndex, sentenceIndex] = coordinates;
  const chapter = summary.chapters[chapterIndex];
  if (!chapter || !Array.isArray(chapter.blocks)) return undefined;
  const block = chapter.blocks.find((candidate) => candidate && blockIndexFromId(candidate.id, chapterIndex) === blockIndex);
  return block && sentenceIndex < block.sentenceCount ? chapter.title : undefined;
}

export async function putBookSummary(book: BookRecord): Promise<void> {
  await db.bookSummaries.put(summarizeBook(book));
}

export function isBookSummary(value: unknown): value is BookSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<BookSummary>;
  if (
    typeof row.id !== 'string'
    || typeof row.title !== 'string'
    || typeof row.format !== 'string'
    || !['pdf', 'epub', 'docx', 'txt', 'md', 'html'].includes(row.format)
    || typeof row.addedAt !== 'number' || !Number.isFinite(row.addedAt)
    || typeof row.chapterCount !== 'number'
    || typeof row.sentenceCount !== 'number'
    || !Array.isArray(row.chapters)
    || (row.author !== undefined && typeof row.author !== 'string')
    || (row.columns !== undefined && row.columns !== 'auto' && row.columns !== 1 && row.columns !== 2)
    || (row.lastPos !== undefined && !validPosition(row.lastPos))
  ) return false;

  let sentenceCount = 0;
  for (const chapter of row.chapters as unknown[]) {
    if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) return false;
    const item = chapter as Partial<BookSummary['chapters'][number]>;
    if (
      typeof item.id !== 'string'
      || typeof item.title !== 'string'
      || typeof item.sentenceCount !== 'number' || !Number.isSafeInteger(item.sentenceCount) || item.sentenceCount < 0
      || !Array.isArray(item.blocks)
    ) return false;
    let chapterSentences = 0;
    for (const block of item.blocks as unknown[]) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return false;
      const shape = block as Partial<BookSummary['chapters'][number]['blocks'][number]>;
      if (
        typeof shape.id !== 'string'
        || typeof shape.sentenceCount !== 'number'
        || !Number.isSafeInteger(shape.sentenceCount) || shape.sentenceCount < 0
      ) return false;
      chapterSentences += shape.sentenceCount;
    }
    if (item.sentenceCount !== chapterSentences) return false;
    sentenceCount += chapterSentences;
  }
  return row.chapterCount === row.chapters.length && row.sentenceCount === sentenceCount;
}

/**
 * Shelf rows without touching BookRecord. Normal reads are one key cursor plus
 * one small-table lookup. Missing summaries become honest placeholders; the
 * page asks `repairBookSummaries()` to fill one bounded batch at a time.
 */
export async function listLibraryBooks(): Promise<LibraryBook[]> {
  const ids = await db.books.orderBy('addedAt').reverse().primaryKeys();
  const stored = await db.bookSummaries.bulkGet(ids);
  const byId = new Map<string, BookSummary>();
  stored.forEach((row, at) => {
    if (row && isBookSummary(row) && row.id === ids[at]) byId.set(row.id, row);
  });

  const positions = new Map<string, Position>();
  for (const setting of await db.settings.where('key').startsWith(READER_POSITION_PREFIX).toArray()) {
    const position = validPosition(setting.value);
    if (position) positions.set(setting.key.slice(READER_POSITION_PREFIX.length), position);
  }

  return ids.map((id): LibraryBook => {
    const summary = byId.get(id);
    if (!summary) {
      return {
        id,
        title: 'Book details unavailable',
        format: null,
        addedAt: 0,
        chapterCount: null,
        progress: null,
        unavailable: true,
      };
    }
    return {
      id: summary.id,
      title: summary.title,
      author: summary.author,
      format: summary.format,
      addedAt: summary.addedAt,
      columns: summary.columns,
      chapterCount: summary.chapterCount,
      progress: summaryProgress(summary, positions.get(id) ?? summary.lastPos),
      unavailable: false,
    };
  });
}

/** Repair at most one bounded batch; callers rerun after the live query updates. */
export async function repairBookSummaries(database: ReadItDB = db): Promise<number> {
  const ids = await database.books.orderBy('addedAt').reverse().primaryKeys();
  const stored = await database.bookSummaries.bulkGet(ids);
  const present = new Set<string>();
  stored.forEach((row, at) => {
    if (row && isBookSummary(row) && row.id === ids[at]) present.add(row.id);
  });
  const missing = ids.filter((id) => !present.has(id)).slice(0, BOOK_SUMMARY_REPAIR_BATCH);
  if (!missing.length) return 0;

  try {
    const repairs: BookSummary[] = [];
    // One large BookRecord/Blob at a time. Only the small derived rows are kept
    // together for the final bulk write.
    for (const id of missing) {
      const book = await database.books.get(id);
      if (book) repairs.push(summarizeBook(book));
    }
    if (repairs.length) await database.bookSummaries.bulkPut(repairs);
    return repairs.length;
  } catch {
    // A damaged legacy row must not take the shelf down; it stays a placeholder.
    return 0;
  }
}
