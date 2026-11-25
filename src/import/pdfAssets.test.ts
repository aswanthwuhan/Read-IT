import { describe, expect, it, vi } from 'vitest';
import type { PDFPageProxy } from 'pdfjs-dist';
import {
  PDF_CANVAS_MAX_AREA_BYTES,
  PDFJS_DOCUMENT_OPTIONS,
  PDF_MAX_IMAGE_PIXELS,
  PDF_MAX_PAGE_AREA,
  PDF_MAX_PAGE_DIMENSION,
  PdfTextBudgetError,
  assertPdfViewport,
  getValidatedPdfViewport,
  isFiniteRect,
  isValidPdfViewport,
  readPdfTextItems,
  type PdfRawTextItem,
} from './pdfAssets';

type TextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
type TextPage = Pick<PDFPageProxy, 'streamTextContent' | 'getTextContent'>;

function text(str: string, hasEOL = false): PdfRawTextItem {
  return { str, hasEOL } as PdfRawTextItem;
}

function content(items: PdfRawTextItem[]): TextContent {
  return { items, styles: {}, lang: 'en' };
}

describe('shared pdf.js options', () => {
  it('caps decoded image pixels and the worker canvas area', () => {
    expect(PDFJS_DOCUMENT_OPTIONS).toEqual({
      maxImageSize: 16 * 1024 * 1024,
      canvasMaxAreaInBytes: 64 * 1024 * 1024,
    });
    expect(PDF_CANVAS_MAX_AREA_BYTES).toBe(PDF_MAX_IMAGE_PIXELS * 4);
  });
});

describe('PDF geometry validation', () => {
  const viewport = { width: 612, height: 792, scale: 1, transform: [1, 0, 0, -1, 0, 792] };

  it('accepts an ordinary or rotated page transform', () => {
    expect(isValidPdfViewport(viewport)).toBe(true);
    expect(isValidPdfViewport({ ...viewport, transform: [0, 1, 1, 0, 0, 0] })).toBe(true);
  });

  it('rejects non-finite, singular and giant page geometry with a controlled error', () => {
    for (const invalid of [
      { ...viewport, width: Number.NaN },
      { ...viewport, height: Number.POSITIVE_INFINITY },
      { ...viewport, width: 0 },
      { ...viewport, width: PDF_MAX_PAGE_DIMENSION + 1 },
      { ...viewport, width: PDF_MAX_PAGE_DIMENSION, height: PDF_MAX_PAGE_AREA / PDF_MAX_PAGE_DIMENSION + 1 },
      { ...viewport, transform: [1, 0, 0, Number.NaN, 0, 792] },
      { ...viewport, transform: [0, 0, 0, 0, 0, 0] },
    ]) {
      expect(isValidPdfViewport(invalid)).toBe(false);
      expect(() => assertPdfViewport(invalid)).toThrow('invalid dimensions');
    }
  });

  it('rejects rectangles whose edges overflow', () => {
    expect(isFiniteRect({ x: 1, y: 2, w: 3, h: 4 }, true)).toBe(true);
    expect(isFiniteRect({ x: Number.NaN, y: 2, w: 3, h: 4 })).toBe(false);
    expect(isFiniteRect({ x: Number.MAX_VALUE, y: 2, w: Number.MAX_VALUE, h: 4 })).toBe(false);
    expect(isFiniteRect({ x: 1, y: 2, w: 0, h: 4 }, true)).toBe(false);
  });

  it('turns a viewport-construction failure into the same controlled error', () => {
    const page = { getViewport: () => { throw new Error('raw pdf.js failure'); } } as unknown as PDFPageProxy;
    expect(() => getValidatedPdfViewport(page, 1)).toThrow('invalid dimensions');
  });
});

describe('streamed PDF text budgets', () => {
  it('prefers the stream and cancels it as soon as the character budget is exceeded', async () => {
    const cancel = vi.fn();
    let pull = 0;
    const stream = new ReadableStream<TextContent>(
      {
        pull(controller) {
          pull += 1;
          if (pull === 1) controller.enqueue(content([text('abc')]));
          else controller.enqueue(content([text('too long')]));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const getTextContent = vi.fn(async () => content([text('must not be used')]));
    const page = { streamTextContent: () => stream, getTextContent } as TextPage;
    const seen: string[] = [];

    await expect(
      readPdfTextItems(page, { maxItems: 10, maxChars: 5, pageNumber: 2 }, (item) => {
        if ('str' in item) seen.push(item.str);
      }),
    ).rejects.toBeInstanceOf(PdfTextBudgetError);

    expect(seen).toEqual(['abc']);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(getTextContent).not.toHaveBeenCalled();
  });

  it('checks a whole incoming chunk before visiting any of its items', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<TextContent>({
      start(controller) {
        controller.enqueue(content([text('one'), text('two')]));
      },
      cancel,
    });
    const visit = vi.fn();
    const page = { streamTextContent: () => stream, getTextContent: vi.fn() } as unknown as TextPage;

    await expect(
      readPdfTextItems(page, { maxItems: 1, maxChars: 100, pageNumber: 1 }, visit),
    ).rejects.toThrow('too much text on page 1');

    expect(visit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('reports a document remainder separately and still releases the stream', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<TextContent>({
      start(controller) {
        controller.enqueue(content([text('abc')]));
      },
      cancel,
    });
    const page = { streamTextContent: () => stream, getTextContent: vi.fn() } as unknown as TextPage;

    await expect(
      readPdfTextItems(page, { maxItems: 10, maxChars: 2, pageNumber: 9, scope: 'document' }, () => undefined),
    ).rejects.toThrow('This PDF has too much text to import safely.');

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('falls back to getTextContent for an older page proxy and counts accepted text', async () => {
    const page = {
      getTextContent: async () => content([text('ordinary PDF text')]),
    } as unknown as TextPage;
    const seen: string[] = [];

    const result = await readPdfTextItems(page, { maxItems: 10, maxChars: 100, pageNumber: 1 }, (item) => {
      if ('str' in item) seen.push(item.str);
    });

    expect(result).toEqual({ items: 1, chars: 17 });
    expect(seen).toEqual(['ordinary PDF text']);
  });
});
