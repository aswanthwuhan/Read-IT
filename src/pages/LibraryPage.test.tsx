import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBackBridge } from '../core/backButton';
import { db, putBookSummary } from '../core/db';
import { getSetting } from '../core/settings';
import type { BookRecord, ColumnMode } from '../core/types';
import { deleteBook, importFileDetailed, setBookColumns } from '../import';
import { IMPORT_LAYOUT_KEY } from '../import/importLayout';
import { PASTE_MAX_CHARS, TITLE_MAX_CHARS } from '../import/limits';
import LibraryPage from './LibraryPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

vi.mock('../import', () => ({
  deleteBook: vi.fn(async () => undefined),
  detectFormat: vi.fn((file: { name?: string }) =>
    (file.name ?? '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'txt',
  ),
  importFileDetailed: vi.fn(async () => []),
  importText: vi.fn(async () => ({ bookId: 'x', title: 'x', format: 'txt', warnings: [] })),
  importUrl: vi.fn(async () => ({ bookId: 'x', title: 'x', format: 'html', warnings: [] })),
  setBookColumns: vi.fn(async () => undefined),
}));
vi.mock('../tts/ModelStatusBanner', () => ({ default: () => null }));

/** The layout model's disk and download functions, replaced by a scriptable stand-in. */
const layout = vi.hoisted(() => ({
  ready: false,
  downloads: 0,
  progress: null as null | ((fraction: number) => void),
  finish: null as null | (() => void),
  fail: null as null | ((error: unknown) => void),
}));

vi.mock('../import/layout/model', () => ({
  LAYOUT_MODEL: { label: 'PP-DocLayout-L', bytes: 33_581_278 },
  isLayoutModelReady: () => Promise.resolve(layout.ready),
  downloadLayoutModel: (onProgress?: (fraction: number) => void) => {
    layout.downloads += 1;
    layout.progress = onProgress ?? null;
    return new Promise<void>((resolve, reject) => {
      layout.finish = () => {
        layout.ready = true;
        onProgress?.(1);
        resolve();
      };
      layout.fail = reject;
    });
  },
}));

let container: HTMLDivElement;
let root: Root | null = null;

function makeBook(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: 'book-1',
    title: 'Literature Notes',
    author: 'A. Student',
    format: 'txt',
    addedAt: 1,
    fileBlob: new Blob(['notes'], { type: 'text/plain' }),
    parsed: {
      title: 'Literature Notes',
      format: 'txt',
      chapters: [
        {
          id: 'ch-0',
          title: 'Kinetics',
          blocks: [{ id: 'b-0-0', kind: 'p', sentences: [{ id: '0-0-0', text: 'Absorption is the first step.' }] }],
        },
      ],
    },
    ...overrides,
  };
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`timed out waiting for ${label}`);
}

function renderLibrary(): Promise<void> {
  return act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          {/* A successful single-file import navigates to the reader. */}
          <Route path="/read/:id" element={<p>Reader</p>} />
        </Routes>
      </MemoryRouter>
    );
  });
}

/** The banner and its settings arrive on separate live queries: absence must
 *  be observed for a stretch, not at the first paint after the shelf. */
async function staysHidden(check: () => Element | null, label: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (check() !== null) throw new Error(`${label} appeared after ${attempt * 10}ms`);
  }
}

function continueLink(): HTMLAnchorElement | null {
  return container.querySelector<HTMLAnchorElement>('.lib-continue-btn');
}

function backupBanner(): Element | null {
  return container.querySelector('.lib-backup');
}

function moreButton(title = 'Literature Notes'): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[aria-label="More actions for ${title}"]`);
}

function sheet(): HTMLElement | null {
  return container.querySelector<HTMLElement>('.sheet');
}

async function openMenu(title = 'Literature Notes'): Promise<HTMLButtonElement> {
  await waitFor(() => moreButton(title) !== null, 'row menu button');
  const trigger = moreButton(title);
  if (!trigger) throw new Error('row menu button missing');
  await act(async () => {
    trigger.click();
  });
  await waitFor(() => sheet() !== null, 'book sheet');
  return trigger;
}

function sheetAction(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('.sheet-actions .btn')].find(
    (button) => button.textContent === label,
  );
}

/** What the sheet's column picker must offer, in order. */
const COLUMN_CHOICES: { value: ColumnMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 1, label: 'One column' },
  { value: 2, label: 'Two columns' },
];

function columnsControl(): HTMLSelectElement | null {
  return container.querySelector<HTMLSelectElement>('.lib-columns select');
}

async function chooseColumns(value: string): Promise<void> {
  const select = columnsControl();
  if (!select) throw new Error('column control missing');
  await act(async () => {
    // React tracks the select's value; going through the native setter makes the
    // change event carry the new value it compares against.
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setValue?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/* --- The PDF-kind question ------------------------------------------------- */

function questionSheet(): HTMLElement | null {
  return container.querySelector<HTMLElement>('.import-sheet');
}

function questionButton(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('.import-choice')].find(
    (button) => button.querySelector('.import-choice-title')?.textContent === label,
  );
}

function makeFile(name: string, type = 'application/pdf'): File {
  return new File(['%PDF-1.4'], name, { type });
}

async function pickFiles(...files: File[]): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input missing');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

async function answerQuestion(label: string, remember = false): Promise<void> {
  const box = container.querySelector<HTMLInputElement>('.import-remember input[type="checkbox"]');
  await act(async () => {
    if (remember && box) box.click();
    questionButton(label)?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(async () => {
  vi.mocked(deleteBook).mockClear();
  vi.mocked(setBookColumns).mockClear();
  vi.mocked(importFileDetailed).mockReset();
  vi.mocked(importFileDetailed).mockResolvedValue({ bookId: 'new-book' });
  // jsdom has no Cache Storage; the model module is mocked, but the page still
  // asks whether this device can store a model at all.
  (globalThis as { caches?: unknown }).caches = {};
  layout.ready = false;
  layout.downloads = 0;
  layout.progress = null;
  layout.finish = null;
  layout.fail = null;
  await db.delete();
  await db.open();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
    root = null;
  }
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as { caches?: unknown }).caches;
  await db.delete();
  await db.open();
});

describe('library: lightweight shelf', () => {
  it('converges on legacy rows in bounded repair batches', async () => {
    const books = Array.from({ length: 5 }, (_, at) => makeBook({
      id: `legacy-${at}`,
      title: `Legacy ${at}`,
      addedAt: at + 1,
    }));
    await db.books.bulkAdd(books);
    await renderLibrary();

    await waitFor(() => {
      const titles = [...container.querySelectorAll('.lib-title')].map((node) => node.textContent);
      return titles.length === books.length && titles.every((title) => title?.startsWith('Legacy '));
    }, 'all legacy summaries');
    expect(await db.bookSummaries.count()).toBe(books.length);
    expect(container.textContent).not.toContain('Book details unavailable');
  });

  it('does not load full book rows when a summary exists', async () => {
    const book = makeBook();
    await db.books.put(book);
    await putBookSummary(book);
    const toArray = vi.spyOn(db.books, 'toArray');
    const bulkGet = vi.spyOn(db.books, 'bulkGet');
    const get = vi.spyOn(db.books, 'get');

    await renderLibrary();

    await waitFor(() => container.querySelector('.lib-open') !== null, 'loaded book');
    expect(container.querySelector('.lib-title')?.textContent).toBe('Literature Notes');
    expect(toArray).not.toHaveBeenCalled();
    expect(bulkGet).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('library: continue listening', () => {
  it('offers the last book with a play link that starts playback', async () => {
    await db.books.put(makeBook());
    await db.settings.put({ key: 'reader.lastBook', value: { bookId: 'book-1', at: Date.now() } });
    await renderLibrary();

    await waitFor(() => continueLink()?.textContent?.includes('Literature Notes') === true, 'continue button');
    const link = continueLink();
    expect(link?.textContent).toContain('Continue:');
    expect(link?.textContent).toContain('Literature Notes');
    expect(link?.getAttribute('href')).toBe('/read/book-1?play=1');
  });

  it('hides the button when that book has been deleted', async () => {
    await db.books.put(makeBook({ id: 'book-2', title: 'Another book' }));
    await db.settings.put({ key: 'reader.lastBook', value: { bookId: 'book-1', at: Date.now() } });
    await renderLibrary();

    await waitFor(() => container.querySelector('.lib-list .lib-row') !== null, 'shelf');
    expect(continueLink()).toBeNull();
  });
});

describe('library: reading progress', () => {
  it('shows the saved sentence position as a percentage', async () => {
    const book = makeBook({ lastPos: { chapterId: 'ch-0', sentenceId: '0-0-0' } });
    book.parsed.chapters[0].blocks[0].sentences.push({ id: '0-0-1', text: 'Distribution comes next.' });
    await db.books.put(book);
    await renderLibrary();
    await waitFor(() => container.querySelector('.lib-pct') !== null, 'reading percentage');
    expect(container.querySelector('.lib-pct')?.textContent).toBe('50%');
  });

  it('updates progress from the reader position without reloading the book', async () => {
    const book = makeBook();
    book.parsed.chapters[0].blocks[0].sentences.push({ id: '0-0-1', text: 'Distribution comes next.' });
    await db.books.put(book);
    await putBookSummary(book);
    await renderLibrary();
    await waitFor(() => container.querySelector('.lib-open') !== null, 'loaded book');
    expect(container.querySelector('.lib-pct')).toBeNull();

    await act(async () => {
      await db.settings.put({
        key: `reader.lastPos.${book.id}`,
        value: { chapterId: 'ch-0', sentenceId: '0-0-1' },
      });
    });

    await waitFor(() => container.querySelector('.lib-pct')?.textContent === '100%', 'updated percentage');
  });

  it('shows progress for production chapter-block ids after chapter 0', async () => {
    const book = makeBook({
      lastPos: { chapterId: 'ch-1', sentenceId: '1-1-0' },
    });
    book.parsed.chapters = [
      {
        id: 'ch-0', title: 'Opening', blocks: [
          { id: 'b-0-0', kind: 'p', sentences: [{ id: '0-0-0', text: 'Opening sentence.' }] },
        ],
      },
      {
        id: 'ch-1', title: 'Middle', blocks: [
          { id: 'b-1-0', kind: 'p', sentences: [{ id: '1-0-0', text: 'Middle sentence.' }] },
          { id: 'b-1-1', kind: 'p', sentences: [{ id: '1-1-0', text: 'Later block sentence.' }] },
        ],
      },
    ];
    await db.books.put(book);
    await renderLibrary();
    await waitFor(() => container.querySelector('.lib-pct')?.textContent === '100%', 'later-chapter percentage');
  });

  it.each([
    { chapterId: 'missing-chapter', sentenceId: '0-0-0' },
    { chapterId: 'ch-0', sentenceId: 'missing-sentence' },
  ])('does not report completion for a missing saved position: $chapterId / $sentenceId', async (lastPos) => {
    await db.books.put(makeBook({ lastPos }));
    await renderLibrary();
    await waitFor(() => container.querySelector('.lib-open') !== null, 'loaded book');
    expect(container.querySelector('.lib-pct')).toBeNull();
  });
});

describe('library: backup reminder', () => {
  it('reminds when books exist and no export was ever made', async () => {
    await db.books.put(makeBook());
    await renderLibrary();

    await waitFor(() => backupBanner() !== null, 'backup banner');
    expect(backupBanner()?.textContent).toContain('Back up your notes');
    expect(backupBanner()?.querySelector('a')?.getAttribute('href')).toBe('/settings#backup');
  });

  it('stays quiet while the last export is recent', async () => {
    await db.books.put(makeBook());
    await db.settings.put({ key: 'backup.lastExportAt', value: Date.now() - 24 * 60 * 60 * 1000 });
    await renderLibrary();

    await waitFor(() => container.querySelector('.lib-list .lib-row') !== null, 'shelf');
    await staysHidden(backupBanner, 'backup banner');
  });

  it('reminds again once the export is more than a week old', async () => {
    await db.books.put(makeBook());
    await db.settings.put({ key: 'backup.lastExportAt', value: Date.now() - WEEK_MS - 1000 });
    await renderLibrary();

    await waitFor(() => backupBanner() !== null, 'backup banner');
  });

  it('dismisses for a week by storing the dismissal time', async () => {
    await db.books.put(makeBook());
    await db.settings.put({ key: 'backup.reminderDismissedAt', value: Date.now() - 1000 });
    await renderLibrary();

    await waitFor(() => container.querySelector('.lib-list .lib-row') !== null, 'shelf');
    await staysHidden(backupBanner, 'backup banner');
  });

  it('records the dismissal and hides the banner immediately', async () => {
    await db.books.put(makeBook());
    await renderLibrary();
    await waitFor(() => backupBanner() !== null, 'backup banner');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Dismiss the backup reminder"]')?.click();
    });
    await waitFor(() => backupBanner() === null, 'banner dismissed');
    const row = await db.settings.get('backup.reminderDismissedAt');
    expect(typeof row?.value).toBe('number');
  });

  it('shows nothing on an empty library', async () => {
    await renderLibrary();
    await waitFor(() => container.querySelector('.empty-state') !== null, 'empty state');
    expect(backupBanner()).toBeNull();
    expect(continueLink()).toBeNull();
  });
});

describe('library: errors', () => {
  it('labels a failed import as an import failure', async () => {
    vi.mocked(importFileDetailed).mockRejectedValueOnce(new Error('The file could not be read'));
    await renderLibrary();

    await pickFiles(makeFile('notes.txt', 'text/plain'));
    await waitFor(() => container.querySelector('.banner-error') !== null, 'import error');

    const banner = container.querySelector('.banner-error');
    expect(banner?.querySelector('.banner-title')?.textContent).toBe('Could not import');
    expect(banner?.textContent).toContain('notes.txt: The file could not be read');
  });

  it('labels a failed delete as a delete failure, not an import failure', async () => {
    await db.books.put(makeBook());
    vi.mocked(deleteBook).mockRejectedValueOnce(new Error('The database is locked'));
    await renderLibrary();
    await openMenu();

    await act(async () => {
      sheetAction('Delete book')?.click();
    });
    await waitFor(() => container.querySelector('.banner-error') !== null, 'delete error');

    const banner = container.querySelector('.banner-error');
    expect(banner?.querySelector('.banner-title')?.textContent).toBe('Could not delete book');
    expect(banner?.textContent).toContain('Could not delete “Literature Notes”: The database is locked');
    expect(banner?.textContent).not.toContain('Could not import');
  });
});

describe('library: row actions', () => {
  const elevenAuthors =
    'Smith, Jones, Patel, Chen, Okafor, Rossi, Kim, Haddad, Silva, Novak, Adeyemi';

  it('opens the book sheet from the More actions button', async () => {
    await db.books.put(makeBook({ author: elevenAuthors }));
    await renderLibrary();
    const trigger = await openMenu();

    const dialog = sheet();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.querySelector('.sheet-title')?.textContent).toBe('Literature Notes');
    const describedBy = dialog?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(dialog?.querySelector(`#${describedBy}`)?.textContent).toBe(
      'Its highlights, bookmarks and notes go with it.',
    );
    expect(sheetAction('Cancel')?.className).toContain('btn-secondary');
    expect(sheetAction('Delete book')?.className).toContain('btn-danger');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(sheetAction('Cancel'));

    // A long author keeps one clamped line; the whole name survives in the tooltip,
    // and the facts beside it stay on screen.
    const authors = container.querySelector<HTMLElement>('.lib-authors');
    expect(authors?.getAttribute('title')).toBe(elevenAuthors);
    expect(authors?.textContent).toBe(elevenAuthors);
    expect(container.querySelector('.lib-facts')?.textContent).toContain('1 chapter');
  });

  it('keeps Tab and Shift+Tab inside the sheet', async () => {
    await db.books.put(makeBook());
    await renderLibrary();
    await openMenu();

    const cancel = sheetAction('Cancel')!;
    const remove = sheetAction('Delete book')!;

    // Tab from the last button wraps to the first instead of leaving the dialog.
    remove.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true });
    await act(async () => {
      document.dispatchEvent(forward);
    });
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);

    // Shift+Tab from the first button wraps back to the last.
    const backward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      cancelable: true,
      bubbles: true,
    });
    await act(async () => {
      document.dispatchEvent(backward);
    });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(remove);
  });

  it('moves focus to the page heading after the row is deleted', async () => {
    await db.books.put(makeBook());
    await renderLibrary();
    await openMenu();

    await act(async () => {
      sheetAction('Delete book')?.click();
    });
    await waitFor(() => sheet() === null, 'sheet closed');
    const heading = container.querySelector('h1');
    expect(heading?.getAttribute('tabindex')).toBe('-1');
    await waitFor(() => document.activeElement === heading, 'focus on the page heading');
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    await db.books.put(makeBook());
    await renderLibrary();
    const trigger = await openMenu();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await waitFor(() => sheet() === null, 'sheet closed');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the backdrop is tapped', async () => {
    await db.books.put(makeBook());
    await renderLibrary();
    const trigger = await openMenu();

    await act(async () => {
      container.querySelector<HTMLElement>('.sheet-backdrop')?.click();
    });
    await waitFor(() => sheet() === null, 'sheet closed');
    expect(document.activeElement).toBe(trigger);
  });

  it('cancels without deleting the book', async () => {
    await db.books.put(makeBook());
    await renderLibrary();
    await openMenu();

    await act(async () => {
      sheetAction('Cancel')?.click();
    });
    await waitFor(() => sheet() === null, 'sheet closed');
    expect(deleteBook).not.toHaveBeenCalled();
  });

  it('deletes the book from the sheet and closes it', async () => {
    await db.books.put(makeBook());
    await renderLibrary();
    const trigger = await openMenu();

    await act(async () => {
      sheetAction('Delete book')?.click();
    });
    await waitFor(() => sheet() === null, 'sheet closed');
    expect(deleteBook).toHaveBeenCalledTimes(1);
    expect(deleteBook).toHaveBeenCalledWith('book-1');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on the Android back key instead of leaving the library', async () => {
    await db.books.put(makeBook());
    await renderLibrary();
    await openMenu();
    const navigate = vi.fn();
    const dispose = installBackBridge(navigate, () => '/');

    try {
      await act(async () => {
        window.__readitBack?.();
      });
      expect(sheet()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});

describe('library: a PDF book\'s columns', () => {
  it('offers the three column choices, labelled, for a PDF only', async () => {
    await db.books.put(makeBook({ format: 'pdf' }));
    await renderLibrary();
    await openMenu();

    const select = columnsControl();
    if (!select) throw new Error('column control missing');
    const label = container.querySelector(`label[for="${select.id}"]`);
    expect(label?.textContent).toBe('Columns');
    expect([...select.options].map((option) => ({ value: option.value, label: option.textContent }))).toEqual(
      COLUMN_CHOICES.map((choice) => ({ value: String(choice.value), label: choice.label })),
    );
    expect(select.value).toBe('auto');
    expect(container.querySelector('.lib-columns .field-hint')?.textContent).toBe(
      'Use Two if the voice jumps between columns; One for single-column books.',
    );
    // The column picker comes before the two actions, so Tab reaches it first.
    expect(select.compareDocumentPosition(container.querySelector('.sheet-actions')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the stored choice and reads the book again with a new one', async () => {
    await db.books.put(makeBook({ format: 'pdf', columns: 1 }));
    let finish = (): void => {};
    vi.mocked(setBookColumns).mockImplementationOnce(async (_id, _columns, onProgress) => {
      onProgress?.('Analysing layout: page 10 of 20');
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await renderLibrary();
    await openMenu();
    expect(columnsControl()?.value).toBe('1');

    await chooseColumns('2');

    expect(setBookColumns).toHaveBeenCalledTimes(1);
    expect(setBookColumns).toHaveBeenCalledWith('book-1', 2, expect.any(Function));
    // Busy while the book is being re-read, with the parser's note and no second change possible.
    expect(columnsControl()?.value).toBe('2');
    expect(columnsControl()?.disabled).toBe(true);
    await waitFor(
      () => container.querySelector('.lib-columns-note')?.textContent === 'Reading the book again — Analysing layout: page 10 of 20…',
      'progress note',
    );

    await act(async () => {
      finish();
    });
    await waitFor(() => columnsControl()?.disabled === false, 'the control re-enabled');
    expect(container.querySelector('.lib-columns-error')).toBeNull();
  });

  it('puts the choice back and says why when the book cannot be re-read', async () => {
    await db.books.put(makeBook({ format: 'pdf' }));
    vi.mocked(setBookColumns).mockRejectedValueOnce(
      new Error('The original file is no longer available — re-import it to use Page view and Re-analyse'),
    );
    await renderLibrary();
    await openMenu();

    await chooseColumns('2');

    await waitFor(() => container.querySelector('.lib-columns-error') !== null, 'error message');
    expect(container.querySelector('.lib-columns-error')?.getAttribute('role')).toBe('alert');
    expect(container.querySelector('.lib-columns-error')?.textContent).toBe(
      'Could not change the columns: The original file is no longer available — re-import it to use Page view and Re-analyse',
    );
    // Nothing was stored, so the picker shows what the book still is.
    expect(columnsControl()?.value).toBe('auto');
    expect(columnsControl()?.disabled).toBe(false);
  });

  it('has no column control for a book that is not a PDF', async () => {
    await db.books.put(makeBook());
    await renderLibrary();
    await openMenu();

    expect(container.querySelector('.lib-columns')).toBeNull();
    expect(columnsControl()).toBeNull();
  });
});

describe('library: voice-model links', () => {
  it('keeps one quiet link to voice models in the empty state', async () => {
    await renderLibrary();
    await waitFor(() => container.querySelector('.empty-state') !== null, 'empty state');

    const links = [...container.querySelectorAll<HTMLAnchorElement>('a[href="/settings#voice-models"]')];
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe('Choose a voice in Settings');
    expect(container.querySelector('.empty-state ol')).toBeNull();
    expect(container.querySelector('.empty-state-actions .btn-primary')).toBeNull();
    expect(container.textContent).not.toContain('on the ward');
    expect(container.textContent).toContain('Image-only PDFs are rejected');
    expect(container.textContent).toContain('very little selectable text can import with a warning');
  });
});

describe('library: paste input bounds', () => {
  it('caps the title and text controls at the import limits', async () => {
    await renderLibrary();
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === 'Paste text')
        ?.click();
    });
    await waitFor(() => container.querySelector('#lib-text-panel textarea') !== null, 'paste panel');

    const title = container.querySelector<HTMLInputElement>('#lib-text-panel input[type="text"]');
    const text = container.querySelector<HTMLTextAreaElement>('#lib-text-panel textarea');
    expect(title?.maxLength).toBe(TITLE_MAX_CHARS);
    expect(text?.maxLength).toBe(PASTE_MAX_CHARS);
  });
});

describe('library: the Android back key', () => {
  it('closes an open import panel before leaving the library', async () => {
    await db.books.put(makeBook());
    await renderLibrary();
    await waitFor(() => container.querySelector('.lib-list .lib-row') !== null, 'shelf');
    const navigate = vi.fn();
    const dispose = installBackBridge(navigate, () => '/');

    try {
      await act(async () => {
        [...container.querySelectorAll<HTMLButtonElement>('button')]
          .find((button) => (button.textContent ?? '').includes('Add from web'))
          ?.click();
      });
      expect(container.querySelector('#lib-web-panel')).not.toBeNull();

      await act(async () => {
        window.__readitBack?.();
      });
      expect(container.querySelector('#lib-web-panel')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();

      // The library is the menu: nothing open means the press is not handled.
      await act(async () => {
        window.__readitBack?.();
      });
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});

describe('library: update banner', () => {
  function updateBanner(): HTMLElement | null {
    return container.querySelector<HTMLElement>('.lib-update');
  }

  function releaseResponse(tag: string): Response {
    return {
      ok: true,
      status: 200,
      json: async () => [
        {
          tag_name: tag,
          html_url: `https://github.com/aswanthwuhan/Read-IT/releases/tag/${tag}`,
          draft: false,
          prerelease: true,
        },
      ],
    } as unknown as Response;
  }

  async function optIn(): Promise<void> {
    await db.settings.put({ key: 'app.updateCheck', value: true });
  }

  it('shows the banner for a newer release the reader opted in to check', async () => {
    await db.books.put(makeBook());
    await optIn();
    const fetchMock = vi.fn(async () => releaseResponse('v9.9.9'));
    vi.stubGlobal('fetch', fetchMock);
    await renderLibrary();

    await waitFor(() => updateBanner() !== null, 'update banner');
    expect(updateBanner()?.textContent).toContain('Read IT 9.9.9 is available');
    // The banner carries the design's leading icon, decorative and hidden.
    expect(updateBanner()?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    const download = updateBanner()?.querySelector<HTMLAnchorElement>('a');
    expect(download?.textContent).toBe('Download');
    expect(download?.getAttribute('href')).toBe(
      'https://github.com/aswanthwuhan/Read-IT/releases/tag/v9.9.9',
    );
    expect(download?.getAttribute('target')).toBe('_blank');
    expect(download?.getAttribute('rel')).toContain('noopener');
  });

  it('stays quiet when the update check is off, even with a newer release', async () => {
    await db.books.put(makeBook());
    const fetchMock = vi.fn(async () => releaseResponse('v9.9.9'));
    vi.stubGlobal('fetch', fetchMock);
    await renderLibrary();

    await waitFor(() => container.querySelector('.lib-list .lib-row') !== null, 'shelf');
    await staysHidden(updateBanner, 'update banner');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides the banner and remembers the version on "Not now"', async () => {
    await db.books.put(makeBook());
    await optIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => releaseResponse('v9.9.9')),
    );
    await renderLibrary();
    await waitFor(() => updateBanner() !== null, 'update banner');

    const notNow = [...(updateBanner()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (button) => button.textContent === 'Not now',
    );
    await act(async () => {
      notNow?.click();
    });
    await waitFor(() => updateBanner() === null, 'banner dismissed');
    const row = await db.settings.get('app.updateDismissed');
    expect(row?.value).toBe('9.9.9');
  });
});

describe('library: the PDF-kind question', () => {
  function importCalls(): number {
    return vi.mocked(importFileDetailed).mock.calls.length;
  }

  it('explains sparse PDF text without claiming that the imported book is unreadable', async () => {
    layout.ready = true;
    vi.mocked(importFileDetailed).mockResolvedValueOnce({
      bookId: 'sparse-pdf', warning: 'Looks scanned — OCR not supported yet',
    });
    await renderLibrary();
    await pickFiles(makeFile('Sparse.pdf'));
    await waitFor(() => questionSheet() !== null, 'PDF question');
    await answerQuestion('Simple book');
    await waitFor(() => container.querySelector('.banner-warning') !== null, 'PDF warning');
    const warning = container.querySelector('.banner-warning')?.textContent ?? '';
    expect(warning).not.toContain('has no text layer');
    expect(warning).toContain('Available text can still be read and listened to');
  });

  it('does not ask when no PDF is picked', async () => {
    await renderLibrary();
    await pickFiles(makeFile('notes.txt', 'text/plain'));

    await waitFor(() => importCalls() === 1, 'import');
    expect(questionSheet()).toBeNull();
    // No answer, no override: other formats import exactly as before.
    expect(vi.mocked(importFileDetailed).mock.calls[0][2]).toEqual({ pdfLayout: undefined });
  });

  it('asks about a PDF and reads it with detection', async () => {
    layout.ready = true;
    await renderLibrary();
    await pickFiles(makeFile('Katzung.pdf'));

    await waitFor(() => questionSheet() !== null, 'PDF question');
    expect(questionSheet()?.textContent).toContain('What kind of PDF is this?');
    expect(questionButton('Textbook or complex pages')).toBeDefined();
    expect(questionButton('Simple book')).toBeDefined();
    // The model is on disk, so the sheet has no download to offer.
    expect(questionSheet()?.textContent).not.toContain('about 32 MB');

    await answerQuestion('Textbook or complex pages');
    await waitFor(() => importCalls() === 1, 'import');
    expect(vi.mocked(importFileDetailed).mock.calls[0][2]).toEqual({ pdfLayout: 'auto' });
    expect(questionSheet()).toBeNull();
  });

  it('locks the file picker synchronously while checking PDF settings', async () => {
    layout.ready = true;
    await renderLibrary();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('file input missing');
    await act(async () => {
      for (const name of ['first.pdf', 'second.pdf']) {
        Object.defineProperty(input, 'files', { value: [makeFile(name)], configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await waitFor(() => questionSheet() !== null, 'PDF question');
    await answerQuestion('Simple book');

    await waitFor(() => importCalls() === 1, 'first import');
    expect(vi.mocked(importFileDetailed).mock.calls[0][0].name).toBe('first.pdf');
    expect(questionSheet()).toBeNull();
  });

  it('asks once for several PDFs and applies the same answer to all', async () => {
    layout.ready = true;
    await renderLibrary();
    await pickFiles(makeFile('one.pdf'), makeFile('two.pdf'));

    await waitFor(() => questionSheet() !== null, 'PDF question');
    expect(questionSheet()?.textContent).toContain('The same answer is used for all 2 PDFs you picked.');
    expect(questionSheet()?.textContent).toContain('What kind of PDFs are these?');

    await answerQuestion('Simple book');
    await waitFor(() => importCalls() === 2, 'both imports');
    for (const call of vi.mocked(importFileDetailed).mock.calls) {
      expect(call[2]).toEqual({ pdfLayout: 'heuristic' });
    }
    expect(layout.downloads).toBe(0);
  });

  it('imports a simple book without the model, and says so', async () => {
    await renderLibrary();
    await pickFiles(makeFile('Novel.pdf'));

    await waitFor(() => questionSheet() !== null, 'PDF question');
    expect(questionSheet()?.textContent).toContain(
      'Layout detection uses PP-DocLayout-L, about 32 MB. It downloads once, then works offline.',
    );

    await answerQuestion('Simple book');
    await waitFor(() => importCalls() === 1, 'import');
    expect(vi.mocked(importFileDetailed).mock.calls[0][2]).toEqual({ pdfLayout: 'heuristic' });
    expect(layout.downloads).toBe(0);
  });

  it('downloads the model for a textbook when it is missing', async () => {
    await renderLibrary();
    await pickFiles(makeFile('Katzung.pdf'));
    await waitFor(() => questionSheet() !== null, 'PDF question');

    await answerQuestion('Textbook or complex pages');
    await waitFor(() => layout.downloads === 1, 'download started');
    expect(questionSheet()?.textContent).toContain('Downloading the layout model — 0 of 32 MB…');

    await act(async () => {
      layout.progress?.(0.5);
    });
    expect(questionSheet()?.textContent).toContain('16 of 32 MB');

    await act(async () => {
      layout.finish?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await waitFor(() => importCalls() === 1, 'import after download');
    expect(vi.mocked(importFileDetailed).mock.calls[0][2]).toEqual({ pdfLayout: 'auto' });
  });

  it('keeps the fallback warning visible when the layout model cannot download', async () => {
    await renderLibrary();
    await pickFiles(makeFile('Katzung.pdf'));
    await waitFor(() => questionSheet() !== null, 'PDF question');
    await answerQuestion('Textbook or complex pages');

    const dialog = questionSheet();
    expect(document.activeElement).toBe(dialog);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog?.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);

    await act(async () => {
      layout.fail?.(new Error('Offline'));
    });
    await waitFor(() => container.querySelector('.banner-warning') !== null, 'download warning');
    expect(importCalls()).toBe(1);
    expect(container.querySelector('.banner-warning')?.textContent).toContain('Offline');
    expect(container.querySelector('h1')?.textContent).toBe('Library');
  });

  it('remembers the answer and skips the question next time', async () => {
    layout.ready = true;
    await renderLibrary();
    await pickFiles(makeFile('one.pdf'), makeFile('two.pdf'));
    await waitFor(() => questionSheet() !== null, 'first question');

    await answerQuestion('Simple book', true);
    await waitFor(() => importCalls() === 2, 'first imports');
    expect(await getSetting(IMPORT_LAYOUT_KEY, 'ask')).toBe('simple');

    await pickFiles(makeFile('three.pdf'), makeFile('four.pdf'));
    await waitFor(() => importCalls() === 4, 'second imports');
    expect(questionSheet()).toBeNull();
    expect(vi.mocked(importFileDetailed).mock.calls[2][2]).toEqual({ pdfLayout: 'heuristic' });
  });

  it('does not ask where the model cannot run', async () => {
    delete (globalThis as { caches?: unknown }).caches;
    await renderLibrary();
    await pickFiles(makeFile('Katzung.pdf'));

    await waitFor(() => importCalls() === 1, 'import');
    expect(questionSheet()).toBeNull();
    expect(vi.mocked(importFileDetailed).mock.calls[0][2]).toEqual({ pdfLayout: undefined });
    // Nothing was answered, so the question is still owed next time.
    expect(await getSetting(IMPORT_LAYOUT_KEY, 'ask')).toBe('ask');
  });

  it('still imports, with a warning, when detection fails', async () => {
    layout.ready = true;
    vi.mocked(importFileDetailed).mockResolvedValue({
      bookId: 'new-book',
      warning: 'The layout model failed on 2 pages and was stopped; those pages were read with the text layout only.',
    });
    await renderLibrary();
    await pickFiles(makeFile('Katzung.pdf'));
    await waitFor(() => questionSheet() !== null, 'PDF question');

    await answerQuestion('Textbook or complex pages');
    await waitFor(() => container.querySelector('.banner-warning') !== null, 'warning banner');
    const banner = container.querySelector('.banner-warning');
    expect(banner?.textContent).toContain('Imported with a note');
    expect(banner?.textContent).toContain('Katzung.pdf');
    expect(banner?.textContent).toContain('read with the text layout only');
    expect(questionSheet()).toBeNull();
  });
});
