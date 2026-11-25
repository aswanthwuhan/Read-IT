import { db, isBookSummary, newId, summaryChapterTitle } from '../core/db';
import { getParsedContent } from '../core/contentStore';
import type { Bookmark, BookSummary, Highlight, ParsedDoc } from '../core/types';

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

interface NotesBook {
  title: string;
  author?: string;
  chapterOrder: string[];
  parsed?: ParsedDoc;
}

/** Notes as Markdown, grouped by book then chapter, with the highlight's note. */
export async function exportNotesMarkdown(bookId?: string): Promise<string> {
  const highlights = bookId
    ? await db.highlights.where('bookId').equals(bookId).toArray()
    : await db.highlights.toArray();

  const lines = ['# Notes', '', `_Exported ${markdownDate(Date.now())}_`, ''];
  if (highlights.length === 0) {
    lines.push('_No highlights yet._', '');
    return `${lines.join('\n').trimEnd()}\n`;
  }

  // Only books that actually have notes are needed. Their shelf summaries carry
  // titles, authors, chapter order and enough sentence shape to locate normal
  // imported highlights without opening a book row or its original blob.
  const highlightedIds = [...new Set(highlights.map((highlight) => highlight.bookId))];
  const summaries = await db.bookSummaries.bulkGet(highlightedIds);
  const summaryById = new Map<string, BookSummary>();
  const bookById = new Map<string, NotesBook>();
  summaries.forEach((summary, at) => {
    const id = highlightedIds[at];
    if (!summary || summary.id !== id || !isBookSummary(summary)) return;
    summaryById.set(id, summary);
    bookById.set(id, {
      title: summary.title,
      author: summary.author,
      chapterOrder: summary.chapters.map((chapter) => chapter.title),
    });
  });

  const loaded = new Map<string, NotesBook>();
  async function loadNotesBook(id: string): Promise<NotesBook> {
    const ready = loaded.get(id);
    if (ready) return ready;
    const summary = bookById.get(id);
    let parsed = (await getParsedContent(id)) ?? undefined;
    let title = summary?.title;
    let author = summary?.author;
    let chapterOrder = summary?.chapterOrder;

    // Content-store misses are possible on older imports. Read one highlighted
    // legacy book at a time, never the whole library and never an unrelated blob.
    if (!parsed) {
      const book = await db.books.get(id);
      if (book) {
        parsed = book.parsed;
        title = book.title;
        author = book.author;
        chapterOrder = book.parsed.chapters.map((chapter) => chapter.title);
      }
    } else {
      title ??= parsed.title;
      author ??= parsed.author;
      chapterOrder ??= parsed.chapters.map((chapter) => chapter.title);
    }

    const info: NotesBook = { title: title ?? id, author, chapterOrder: chapterOrder ?? [], parsed };
    loaded.set(id, info);
    bookById.set(id, info);
    return info;
  }

  const grouped = new Map<string, Map<string, Highlight[]>>();
  for (const highlight of highlights) {
    const summary = summaryById.get(highlight.bookId);
    let chapter = summary?.chapters.length
      ? highlight.sentenceIds.map((id) => summaryChapterTitle(summary, id)).find((title) => title !== undefined)
      : undefined;
    if (chapter === undefined) {
      const book = await loadNotesBook(highlight.bookId);
      chapter = findChapterTitle(book.parsed, highlight.sentenceIds);
    }
    chapter ??= 'Unlinked';
    const byChapter = grouped.get(highlight.bookId) ?? new Map<string, Highlight[]>();
    const list = byChapter.get(chapter) ?? [];
    list.push(highlight);
    byChapter.set(chapter, list);
    grouped.set(highlight.bookId, byChapter);
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

    const chapterOrder = book?.chapterOrder ?? [];
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
