import Dexie, { type Table } from 'dexie';
import type { AudioCacheRecord, BookRecord, Bookmark, Highlight, LexiconEntry, Setting } from './types';

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
  }
}

export const db = new ReadItDB();

/** Ids are UUIDs so separate devices/backups can merge without collisions. */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
