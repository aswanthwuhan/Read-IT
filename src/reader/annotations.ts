import { db, newId } from '../core/db';
import type { BookRecord, Bookmark, Highlight, ParsedDoc } from '../core/types';

export type NewHighlight = Omit<Highlight, 'id' | 'createdAt'> & Partial<Pick<Highlight, 'id' | 'createdAt'>>;
export type NewBookmark = Omit<Bookmark, 'id' | 'createdAt'> & Partial<Pick<Bookmark, 'id' | 'createdAt'>>;

export async function addHighlight(input: NewHighlight): Promise<Highlight> {
  const highlight: Highlight = {
    ...input,
    id: input.id ?? newId(),
    createdAt: input.createdAt ?? Date.now(),
  };
  await db.highlights.add(highlight);
  return highlight;
}

export async function updateHighlight(id: string, patch: Partial<Omit<Highlight, 'id'>>): Promise<void> {
  await db.highlights.update(id, patch);
}

/** The highlight covering exactly this sentence range, if one exists. */
export function findRangeHighlight(highlights: Highlight[], sentenceIds: string[]): Highlight | undefined {
  return highlights.find(
    (h) => h.sentenceIds.length === sentenceIds.length && h.sentenceIds.every((id, i) => id === sentenceIds[i]),
  );
}

/**
 * Change a range that is already highlighted instead of stacking a second row
 * on it. A colour tap recolours; adding a note keeps the colour the reader
 * already picked (the note action has no colour of its own).
 */
export function rangeHighlightPatch(
  existing: Highlight,
  color: Highlight['color'],
  note?: string,
): Partial<Omit<Highlight, 'id'>> {
  if (note?.trim()) return { note };
  return existing.color === color ? {} : { color };
}

export async function deleteHighlight(id: string): Promise<void> {
  await db.highlights.delete(id);
}

export async function listHighlights(bookId: string): Promise<Highlight[]> {
  const rows = await db.highlights.where('bookId').equals(bookId).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addBookmark(input: NewBookmark): Promise<Bookmark> {
  const bookmark: Bookmark = {
    ...input,
    id: input.id ?? newId(),
    createdAt: input.createdAt ?? Date.now(),
  };
  await db.bookmarks.add(bookmark);
  return bookmark;
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id);
}

export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  const rows = await db.bookmarks.where('bookId').equals(bookId).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

function findChapterTitle(parsed: ParsedDoc | undefined, sentenceIds: string[]): string | undefined {
  if (!parsed) return undefined;
  for (const chapter of parsed.chapters) {
    for (const block of chapter.blocks) {
      if (block.sentences.some((s) => sentenceIds.includes(s.id))) return chapter.title;
    }
  }
  return undefined;
}

function markdownDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

/** Notes as Markdown, grouped by book then chapter, with the highlight's note. */
export async function exportNotesMarkdown(bookId?: string): Promise<string> {
  // Reading one book's record is enough for a per-book export; loading every
  // record would pull every stored file blob into memory for nothing.
  const [books, highlights] = await Promise.all([
    bookId ? db.books.where('id').equals(bookId).toArray() : db.books.toArray(),
    bookId ? db.highlights.where('bookId').equals(bookId).toArray() : db.highlights.toArray(),
  ]);

  const bookById = new Map<string, BookRecord>(books.map((b) => [b.id, b]));
  const grouped = new Map<string, Map<string, Highlight[]>>();
  for (const highlight of highlights) {
    const book = bookById.get(highlight.bookId);
    const chapter = findChapterTitle(book?.parsed, highlight.sentenceIds) ?? 'Unlinked';
    const byChapter = grouped.get(highlight.bookId) ?? new Map<string, Highlight[]>();
    const list = byChapter.get(chapter) ?? [];
    list.push(highlight);
    byChapter.set(chapter, list);
    grouped.set(highlight.bookId, byChapter);
  }

  const lines = ['# Notes', '', `_Exported ${markdownDate(Date.now())}_`, ''];
  if (grouped.size === 0) {
    lines.push('_No highlights yet._', '');
  }

  const orderedBooks = [...grouped.keys()].sort((a, b) => {
    const titleA = bookById.get(a)?.title ?? a;
    const titleB = bookById.get(b)?.title ?? b;
    return titleA.localeCompare(titleB);
  });

  for (const id of orderedBooks) {
    const book = bookById.get(id);
    const byChapter = grouped.get(id);
    if (!byChapter) continue;
    lines.push(`## ${book?.title ?? id}${book?.author ? ` — ${book.author}` : ''}`, '');

    const chapterOrder = book?.parsed.chapters.map((c) => c.title) ?? [];
    const chapterNames = [...byChapter.keys()].sort((a, b) => {
      const ai = chapterOrder.indexOf(a);
      const bi = chapterOrder.indexOf(b);
      return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi) || a.localeCompare(b);
    });

    for (const chapter of chapterNames) {
      lines.push(`### ${chapter}`, '');
      const list = [...(byChapter.get(chapter) ?? [])].sort((a, b) => a.createdAt - b.createdAt);
      for (const highlight of list) {
        lines.push(`- ${oneLine(highlight.text)}`);
        if (highlight.note?.trim()) lines.push(`  - **Note:** ${oneLine(highlight.note)}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
