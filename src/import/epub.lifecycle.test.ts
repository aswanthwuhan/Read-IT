import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { EPUB_MAX_HREF_LENGTH, EPUB_MAX_SPINE_ENTRIES } from './limits';
import type { ZipValidationReply, ZipValidationRequest } from './zipValidate';

const epub = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('epubjs', () => ({ default: epub.create }));
vi.mock('./limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./limits')>()),
  // Tiny production-independent budgets make UTF-8 and aggregate checks synthetic.
  EPUB_TEXT_MAX_BYTES: 4,
  EPUB_MAX_CHAPTER_BYTES: 4,
}));

import { parseEpub } from './epub';

class PendingWorker {
  static instances: PendingWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: Array<{ message: ZipValidationRequest; transfer: Transferable[] }> = [];
  terminated = false;

  constructor() {
    PendingWorker.instances.push(this);
  }

  postMessage(message: ZipValidationRequest, transfer: Transferable[] = []): void {
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(reply: ZipValidationReply): void {
    this.onmessage?.({ data: reply } as MessageEvent);
  }
}

beforeEach(() => {
  vi.stubGlobal('Worker', undefined);
  PendingWorker.instances = [];
  epub.create.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parseEpub lifecycle and resource bounds', () => {
  it('parses normally, disables network replacement, and unloads/destroys once', async () => {
    const section = { href: 'chapter.xhtml', unload: vi.fn() };
    const book = installBook([section], { 'chapter.xhtml': documentWithText('éé') });
    const data = archive();

    const doc = await parseEpub(data, 'fallback');

    expect(doc.title).toBe('Synthetic title');
    expect(doc.chapters).toHaveLength(1);
    expect(book.open).toHaveBeenCalledWith(data, 'binary');
    expect(epub.create).toHaveBeenCalledWith(expect.objectContaining({ replacements: 'none', requestMethod: expect.any(Function) }));
    expect(section.unload).toHaveBeenCalledTimes(1);
    expect(book.destroy).toHaveBeenCalledTimes(1);
  });

  it('counts UTF-8 bytes rather than UTF-16 code units', async () => {
    const section = { href: 'chapter.xhtml', unload: vi.fn() };
    const book = installBook([section], { 'chapter.xhtml': documentWithText('ééé') });

    // Three é characters are three UTF-16 code units but six UTF-8 bytes.
    await expect(parseEpub(archive(), 'fallback')).rejects.toThrow(/500 MB of text/);
    expect(section.unload).toHaveBeenCalledTimes(1);
    expect(book.destroy).toHaveBeenCalledTimes(1);
  });

  it('enforces the aggregate text budget and unloads every attempted section', async () => {
    const first = { href: 'first.xhtml', unload: vi.fn() };
    const second = { href: 'second.xhtml', unload: vi.fn() };
    const book = installBook([first, second], {
      'first.xhtml': documentWithText('éé'),
      'second.xhtml': documentWithText('éé'),
    });

    await expect(parseEpub(archive(), 'fallback')).rejects.toThrow(/500 MB of text/);
    expect(first.unload).toHaveBeenCalledTimes(1);
    expect(second.unload).toHaveBeenCalledTimes(1);
    expect(book.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized spine document from ZIP metadata before loading it', async () => {
    const section = { href: 'chapter.xhtml', unload: vi.fn() };
    const book = installBook([section], { 'chapter.xhtml': documentWithText('ok') });
    book.archive.zip.files['OEBPS/chapter.xhtml'] = { _data: { uncompressedSize: 5 } };

    await expect(parseEpub(archive(), 'fallback')).rejects.toThrow(/chapter that is too large/);
    expect(book.load).not.toHaveBeenCalled();
    expect(section.unload).toHaveBeenCalledTimes(1);
    expect(book.destroy).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending chapter load and still unloads and destroys', async () => {
    const section = { href: 'chapter.xhtml', unload: vi.fn() };
    const book = installBook([section]);
    let started!: () => void;
    const loadStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    book.load.mockImplementation(() => {
      started();
      return new Promise<Document>(() => undefined);
    });
    const controller = new AbortController();
    const pending = parseEpub(archive(), 'fallback', controller.signal);
    await loadStarted;
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await rejected;
    expect(section.unload).toHaveBeenCalledTimes(1);
    expect(book.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the book when opening fails', async () => {
    const book = installBook([]);
    book.open.mockRejectedValue(new Error('open failed'));

    await expect(parseEpub(archive(), 'fallback')).rejects.toThrow(/open failed/);
    expect(book.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the book when readiness fails', async () => {
    const book = installBook([]);
    book.ready = Promise.reject(new Error('ready failed'));

    await expect(parseEpub(archive(), 'fallback')).rejects.toThrow(/ready failed/);
    expect(book.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    '../escape.xhtml',
    '%2e%2e/escape.xhtml',
    'https://example.test/chapter.xhtml',
    '//example.test/chapter.xhtml',
    '/absolute.xhtml',
    'C:\\secret.xhtml',
    `x${'x'.repeat(EPUB_MAX_HREF_LENGTH)}`,
  ])('rejects an unsafe or overlong spine href before loading it: %s', async (href) => {
    const section = { href, unload: vi.fn() };
    const book = installBook([section]);

    await expect(parseEpub(archive(), 'fallback')).rejects.toThrow(/unsafe file path|too long/);
    expect(book.load).not.toHaveBeenCalled();
    expect(section.unload).toHaveBeenCalledTimes(1);
    expect(book.destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds a repeated spine before loading any chapter', async () => {
    const book = installBook([]);
    book.spine.length = EPUB_MAX_SPINE_ENTRIES + 1;

    await expect(parseEpub(archive(), 'fallback')).rejects.toThrow(/too many spine entries/);
    expect(book.load).not.toHaveBeenCalled();
    expect(book.destroy).toHaveBeenCalledTimes(1);
  });

  it('uses the worker-returned buffer for epubjs', async () => {
    vi.stubGlobal('Worker', PendingWorker);
    const section = { href: 'chapter.xhtml', unload: vi.fn() };
    const book = installBook([section], { 'chapter.xhtml': documentWithText('ok') });
    const data = archive();
    const returned = data.slice(0);
    const pending = parseEpub(data, 'fallback');
    const worker = PendingWorker.instances[0];

    expect(worker.posted[0]).toEqual({ message: { type: 'validate', bytes: data }, transfer: [data] });
    worker.reply({ type: 'valid', bytes: returned });
    new Uint8Array(data).fill(0);
    await pending;

    expect(book.open).toHaveBeenCalledWith(returned, 'binary');
    expect(book.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not construct an epubjs book when worker validation fails', async () => {
    vi.stubGlobal('Worker', PendingWorker);
    const data = archive();
    const pending = parseEpub(data, 'fallback');
    const rejected = expect(pending).rejects.toThrow(/invalid or unsupported ZIP/);

    PendingWorker.instances[0].reply({
      type: 'invalid',
      bytes: data,
      message: 'This book has an invalid or unsupported ZIP archive.',
    });
    await rejected;
    expect(epub.create).not.toHaveBeenCalled();
  });
});

function installBook(
  sections: Array<{ href: string; unload: ReturnType<typeof vi.fn> }>,
  documents: Record<string, Document> = {},
) {
  const book = {
    open: vi.fn().mockResolvedValue(undefined),
    ready: Promise.resolve() as Promise<void>,
    loaded: {
      metadata: Promise.resolve({ title: 'Synthetic title', creator: 'Synthetic author' }),
      navigation: Promise.resolve({ toc: [] }),
    },
    packaging: {} as { navPath?: string; ncxPath?: string },
    spine: {
      length: sections.length,
      each(callback: (section: (typeof sections)[number]) => void) {
        sections.forEach(callback);
      },
    },
    archive: { zip: { files: {} as Record<string, { _data?: { uncompressedSize?: number } }> } },
    load: vi.fn().mockImplementation(async (href: string) => {
      const document = documents[href];
      if (!document) throw new Error('missing chapter');
      return document;
    }),
    destroy: vi.fn(),
  };
  epub.create.mockReturnValue(book);
  return book;
}

function documentWithText(text: string): Document {
  return new DOMParser().parseFromString(`<html><body><p>${text}</p></body></html>`, 'text/html');
}

function archive(): ArrayBuffer {
  const bytes = zipSync({ mimetype: [strToU8('application/epub+zip'), { level: 0 }] });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
