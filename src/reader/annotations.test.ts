import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, summarizeBook } from '../core/db';
import { putContent } from '../core/contentStore';
import type { BookRecord, Highlight } from '../core/types';
import { exportNotesMarkdown } from './annotations';

function book(id: string, title: string, addedAt: number): BookRecord {
  return {
    id,
    title,
    author: `${title} Author`,
    format: 'txt',
    addedAt,
    fileBlob: new Blob(['original file']),
    parsed: {
      title,
      format: 'txt',
      chapters: [
        {
          id: 'ch-0',
          title: 'First chapter',
          blocks: [{ id: 'b-0-0', kind: 'p', sentences: [{ id: '0-0-0', text: 'First sentence.' }] }],
        },
        {
          id: 'ch-1',
          title: 'Second chapter',
          blocks: [
            { id: 'b-1-0', kind: 'p', sentences: [{ id: '1-0-0', text: 'Second sentence.' }] },
            { id: 'b-1-1', kind: 'p', sentences: [{ id: '1-1-0', text: 'Third sentence.' }] },
          ],
        },
        {
          id: 'ch-2',
          title: 'Later chapter',
          blocks: [{ id: 'b-2-3', kind: 'p', sentences: [{ id: '2-3-0', text: 'Later sentence.' }] }],
        },
      ],
    },
  };
}

function highlight(id: string, bookId: string, sentenceId: string, note?: string): Highlight {
  return {
    id,
    bookId,
    sentenceIds: [sentenceId],
    text: `Highlight ${id}`,
    color: 'yellow',
    note,
    createdAt: Number(id.slice(1)),
  };
}

afterEach(async () => {
  await db.delete();
  await db.open();
});

describe('exportNotesMarkdown', () => {
  it('exports every highlighted book from summaries without reading book rows or blobs', async () => {
    const noted = book('noted', 'Noted book', 1);
    const unrelated = book('unrelated', 'Unread book', 2);
    await db.books.bulkAdd([noted, unrelated]);
    await db.bookSummaries.bulkPut([summarizeBook(noted), summarizeBook(unrelated)]);
    await db.highlights.bulkAdd([
      highlight('h1', 'noted', '1-0-0', 'Keep this note'),
      highlight('h2', 'noted', '0-0-0'),
      highlight('h3', 'noted', '1-1-0'),
      highlight('h4', 'noted', '2-3-0'),
    ]);
    const toArray = vi.spyOn(db.books, 'toArray');
    const get = vi.spyOn(db.books, 'get');
    const contentGet = vi.spyOn(db.bookContent, 'get');

    const markdown = await exportNotesMarkdown();

    expect(markdown).toContain('## Noted book — Noted book Author');
    expect(markdown).toContain('### First chapter');
    expect(markdown).toContain('### Second chapter');
    expect(markdown).toContain('### Later chapter');
    expect(markdown.indexOf('### Second chapter')).toBeLessThan(markdown.indexOf('### Later chapter'));
    expect(markdown).toContain('**Note:** Keep this note');
    expect(markdown).not.toContain('Unread book');
    expect(toArray).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(contentGet).not.toHaveBeenCalled();
  });

  it('does no book work when there are no highlights', async () => {
    await db.books.add(book('unused', 'Unused book', 1));
    const toArray = vi.spyOn(db.books, 'toArray');
    const get = vi.spyOn(db.books, 'get');
    const summaries = vi.spyOn(db.bookSummaries, 'bulkGet');

    await expect(exportNotesMarkdown()).resolves.toContain('_No highlights yet._');
    expect(toArray).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(summaries).not.toHaveBeenCalled();
  });

  it('reads one highlighted legacy book when no summary or content row exists', async () => {
    await db.books.add(book('legacy', 'Legacy book', 1));
    await db.highlights.add(highlight('h1', 'legacy', '1-0-0'));
    const toArray = vi.spyOn(db.books, 'toArray');
    const get = vi.spyOn(db.books, 'get');

    const markdown = await exportNotesMarkdown();

    expect(markdown).toContain('## Legacy book');
    expect(markdown).toContain('### Second chapter');
    expect(toArray).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('legacy');
  });

  it('falls back safely when a highlighted book has a malformed summary', async () => {
    const original = book('damaged-summary', 'Damaged summary', 1);
    await db.books.add(original);
    const summary = summarizeBook(original);
    summary.chapters = [null as never];
    await db.bookSummaries.put(summary);
    await db.highlights.add(highlight('h1', original.id, '1-0-0'));
    const get = vi.spyOn(db.books, 'get');

    const markdown = await exportNotesMarkdown(original.id);

    expect(markdown).toContain('## Damaged summary');
    expect(markdown).toContain('### Second chapter');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(original.id);
  });

  it('falls back to compressed content for an unlocatable summary sentence', async () => {
    const original = book('odd-ids', 'Odd ids', 1);
    await db.books.add(original);
    const summary = summarizeBook(original);
    summary.chapters[0]!.blocks[0]!.id = 'b-9';
    await db.bookSummaries.put(summary);
    await putContent(original.id, JSON.stringify(original.parsed));
    await db.highlights.add(highlight('h1', original.id, '0-0-0'));
    const get = vi.spyOn(db.books, 'get');

    const markdown = await exportNotesMarkdown(original.id);

    expect(markdown).toContain('### First chapter');
    expect(get).not.toHaveBeenCalled();
  });
});
