import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfRect } from '../core/types';
import { PDFJS_DOCUMENT_OPTIONS, PDF_READER_CANVAS_MAX_DIMENSION, PDF_READER_CANVAS_MAX_PIXELS } from '../import/pdfAssets';
import type { PageBlock } from './blockOrder';

const pdf = vi.hoisted(() => {
  const cancel = vi.fn();
  const cleanup = vi.fn();
  const destroy = vi.fn(() => Promise.resolve());
  const page = {
    pageNumber: 1,
    cleanup,
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      scale,
      width: 600 * scale,
      height: 792 * scale,
      transform: [scale, 0, 0, -scale, 0, 792 * scale],
    })),
    render: vi.fn((_options: { canvas: HTMLCanvasElement; transform?: number[] }) => ({ promise: Promise.resolve(), cancel })),
    getTextContent: vi.fn(async () => ({
      items: [
        { str: 'Absorp', hasEOL: false },
        { str: 'tion is', hasEOL: false },
        { str: ' ', hasEOL: false },
        { str: 'the first step.', hasEOL: true },
        { str: 'Second paragraph.', hasEOL: false },
      ],
      styles: {},
      lang: 'en',
    })),
  };
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ numPages: 5, getPage: async (pageNumber: number) => ({ ...page, pageNumber }) }),
    destroy,
  }));
  return { page, cancel, cleanup, destroy, getDocument };
});

// The page view imports the official legacy pdf.js build (the default one calls
// ES2025 helpers the phone's WebView lacks) plus a worker wrapper module.
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, getDocument: pdf.getDocument }));
vi.mock('../import/pdfWorker?worker&url', () => ({ default: 'worker.js' }));

const { default: PdfView, canvasBackingRatio, canvasBackingSize } = await import('./PdfView');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECTS: PdfRect[] = [{ page: 1, x: 10, y: 20, w: 100, h: 30 }];

/** A page's blocks, as ReaderView hands them over. */
const BLOCKS: PageBlock[] = [
  { chapterIndex: 0, blockIndex: 0, blockId: 'b1', kind: 'p', order: 1, box: { x: 10, y: 20, w: 100, h: 30 } },
  { chapterIndex: 0, blockIndex: 1, blockId: 'b2', kind: 'h', order: 2, box: { x: 10, y: 60, w: 100, h: 20 } },
];

let container: HTMLDivElement;
let root: Root | null = null;
const scrollTo = vi.fn();

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function renderView(
  rects: PdfRect[] = RECTS,
  file: Blob = new Blob(['%PDF-1.4']),
  fullscreen = false,
  docKey = 'book-1',
  page = 1,
  wordRects?: PdfRect[],
): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await rerenderView(rects, file, fullscreen, docKey, page, wordRects);
}

async function rerenderView(
  rects: PdfRect[] = RECTS,
  file: Blob = new Blob(['%PDF-1.4']),
  fullscreen = false,
  docKey = 'book-1',
  page = 1,
  wordRects?: PdfRect[],
): Promise<void> {
  await act(async () => {
    root?.render(
      <PdfView
        docKey={docKey}
        file={file}
        page={page}
        rects={rects}
        wordRects={wordRects}
        onPageChange={() => undefined}
        fullscreen={fullscreen}
      />
    );
  });
}

function canvas(): HTMLCanvasElement {
  const element = container.querySelector<HTMLCanvasElement>('canvas');
  if (!element) throw new Error('no canvas');
  return element;
}

function pageDescription(): string {
  const id = canvas().getAttribute('aria-describedby');
  const element = id ? document.getElementById(id) : null;
  return element?.textContent?.trim() ?? '';
}

beforeEach(() => {
  pdf.page.render.mockClear();
  pdf.page.getViewport.mockReset();
  pdf.page.getViewport.mockImplementation(({ scale }: { scale: number }) => ({
    scale,
    width: 600 * scale,
    height: 792 * scale,
    transform: [scale, 0, 0, -scale, 0, 792 * scale],
  }));
  pdf.page.getTextContent.mockClear();
  pdf.cancel.mockClear();
  pdf.cleanup.mockClear();
  pdf.destroy.mockClear();
  pdf.getDocument.mockClear();
  scrollTo.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: scrollTo,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({}) as unknown as CanvasRenderingContext2D
  );
  // jsdom has no layout: give the wrapper a phone width and a 2× screen.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  delete (window as { devicePixelRatio?: number }).devicePixelRatio;
});

describe('canvas backing caps', () => {
  it('keeps ordinary pages at screen resolution', () => {
    expect(canvasBackingRatio(600, 792, 2)).toBe(2);
    expect(canvasBackingSize(600, 792, 2)).toEqual({ width: 1200, height: 1584, ratio: 2 });
  });

  it('reduces effective DPR as zoom grows and never exceeds either cap', () => {
    const first = canvasBackingSize(10_000, 15_000, 2);
    const zoomed = canvasBackingSize(20_000, 30_000, 2);
    expect(zoomed.ratio).toBeLessThan(first.ratio);
    for (const backing of [first, zoomed]) {
      expect(backing.width).toBeLessThanOrEqual(PDF_READER_CANVAS_MAX_DIMENSION);
      expect(backing.height).toBeLessThanOrEqual(PDF_READER_CANVAS_MAX_DIMENSION);
      expect(backing.width * backing.height).toBeLessThanOrEqual(PDF_READER_CANVAS_MAX_PIXELS);
    }
    const dimensionCapped = canvasBackingSize(10_000, 1_000, 2);
    expect(dimensionCapped.width).toBe(PDF_READER_CANVAS_MAX_DIMENSION);
    expect(dimensionCapped.ratio).toBeLessThan(1);
    expect(canvasBackingRatio(Number.NaN, 100, 2)).toBe(0);
  });
});

describe('PdfView', () => {
  it('paints the page at device resolution and scales the sentence overlay with it', async () => {
    await renderView();
    await waitFor(() => canvas().width > 0, 'first paint');

    // 600pt wide page fitted into 300px → scale 0.5, painted at 2× for sharpness.
    expect(canvas().width).toBe(600);
    expect(canvas().height).toBe(792);
    expect(pdf.getDocument).toHaveBeenCalledWith(expect.objectContaining(PDFJS_DOCUMENT_OPTIONS));
    expect(canvas().getAttribute('role')).toBe('img');
    expect(canvas().getAttribute('aria-label')).toBe('Page 1 of 5');

    const rect = container.querySelector<HTMLElement>('.rd-pdf-rect');
    expect(rect).not.toBeNull();
    expect(parseFloat(rect?.style.left ?? '')).toBeCloseTo(5);
    expect(parseFloat(rect?.style.top ?? '')).toBeCloseTo(10);
    expect(parseFloat(rect?.style.width ?? '')).toBeCloseTo(50);
    expect(parseFloat(rect?.style.height ?? '')).toBeCloseTo(15);
  });

  it('describes the canvas with parsed page text while keeping its label concise', async () => {
    await renderView();
    await waitFor(() => pageDescription().includes('Second paragraph.'), 'accessible page text');

    expect(canvas().getAttribute('aria-label')).toBe('Page 1 of 5');
    expect(canvas().getAttribute('aria-describedby')).not.toBeNull();
    expect(pageDescription()).toBe('Absorption is the first step.\nSecond paragraph.');
  });

  it('says when a page has no readable text instead of pretending it does', async () => {
    pdf.page.getTextContent.mockResolvedValueOnce({ items: [{ str: '   ', hasEOL: true }], styles: {}, lang: 'en' });
    await renderView();
    await waitFor(() => pageDescription().startsWith('No readable text'), 'no-text fallback');

    expect(pageDescription()).toBe('No readable text was found on this page. It may be a scan or image-only PDF.');
  });

  it('reports a text-extraction failure honestly', async () => {
    pdf.page.getTextContent.mockRejectedValueOnce(new Error('text layer unavailable'));
    await renderView();
    await waitFor(() => pageDescription().startsWith('Page text could not be extracted'), 'extraction fallback');

    expect(pageDescription()).toBe('Page text could not be extracted. This page may be a scan or image-only PDF.');
  });

  it('never describes a new page with the previous page text', async () => {
    pdf.page.getTextContent
      .mockResolvedValueOnce({ items: [{ str: 'First page words.', hasEOL: false }], styles: {}, lang: 'en' })
      .mockResolvedValueOnce({ items: [{ str: 'Second page words.', hasEOL: false }], styles: {}, lang: 'en' });
    await renderView();
    await waitFor(() => pageDescription() === 'First page words.', 'first page text');

    await rerenderView(RECTS, new Blob(['%PDF-1.4']), false, 'book-1', 2);
    expect(pageDescription()).not.toBe('First page words.');
    await waitFor(() => pageDescription() === 'Second page words.', 'second page text');
    expect(canvas().getAttribute('aria-label')).toBe('Page 2 of 5');
    expect(pdf.page.getTextContent).toHaveBeenCalledTimes(2);
  });

  it('rescales the overlay when the reader zooms', async () => {
    await renderView();
    await waitFor(() => canvas().width === 600, 'first paint');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click();
    });
    await waitFor(() => canvas().width === 720, 'zoomed paint');

    const rect = container.querySelector<HTMLElement>('.rd-pdf-rect');
    expect(parseFloat(rect?.style.left ?? '')).toBeCloseTo(6);
    expect(parseFloat(rect?.style.width ?? '')).toBeCloseTo(60);
  });

  it('caps a giant page bitmap and lowers render DPR as it zooms', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 10_000 });
    pdf.page.getViewport.mockImplementation(({ scale }: { scale: number }) => ({
      scale,
      width: 10_000 * scale,
      height: 15_000 * scale,
      transform: [scale, 0, 0, -scale, 0, 15_000 * scale],
    }));

    await renderView();
    await waitFor(() => canvas().width > 0, 'capped first paint');
    const firstTransform = pdf.page.render.mock.calls.at(-1)?.[0].transform as number[];
    expect(firstTransform[0]).toBeLessThan(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click();
    });
    await waitFor(() => pdf.page.render.mock.calls.length >= 2, 'capped zoomed paint');
    const zoomedTransform = pdf.page.render.mock.calls.at(-1)?.[0].transform as number[];

    expect(zoomedTransform[0]).toBeLessThan(firstTransform[0]);
    expect(canvas().width).toBeLessThanOrEqual(PDF_READER_CANVAS_MAX_DIMENSION);
    expect(canvas().height).toBeLessThanOrEqual(PDF_READER_CANVAS_MAX_DIMENSION);
    expect(canvas().width * canvas().height).toBeLessThanOrEqual(PDF_READER_CANVAS_MAX_PIXELS);
    expect(canvas().getAttribute('aria-label')).toBe('Page 1 of 5');
    expect(pageDescription()).toContain('Second paragraph.');

    await act(async () => {
      for (let step = 0; step < 9; step += 1) {
        container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click();
      }
    });
    await waitFor(() => pdf.page.render.mock.calls.length >= 3, 'maximum zoom paint');
    const maxZoomTransform = pdf.page.render.mock.calls.at(-1)?.[0].transform as number[];
    expect(maxZoomTransform[0]).toBeLessThan(zoomedTransform[0]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(canvas().width * canvas().height).toBeLessThanOrEqual(PDF_READER_CANVAS_MAX_PIXELS);
  });

  it('zeros the old bitmap before allocating a resized one', async () => {
    await renderView();
    await waitFor(() => canvas().width === 600, 'first paint');
    const element = canvas();
    const writes: number[] = [];
    for (const dimension of ['width', 'height'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension)!;
      Object.defineProperty(element, dimension, {
        configurable: true,
        get: () => descriptor.get!.call(element),
        set: (value: number) => {
          writes.push(value);
          descriptor.set!.call(element, value);
        },
      });
    }

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click();
    });
    await waitFor(() => element.width === 720, 'resized paint');

    expect(writes.slice(0, 4)).toEqual([0, 0, 720, 950]);
  });

  it('rejects an invalid viewport, clears the canvas and keeps accessible page text', async () => {
    pdf.page.getViewport.mockReturnValue({
      scale: 1,
      width: Number.NaN,
      height: 792,
      transform: [1, 0, 0, -1, 0, 792],
    });
    await renderView();
    await waitFor(() => pageDescription().includes('Second paragraph.'), 'accessible text after viewport failure');
    await waitFor(() => Boolean(container.querySelector('[role="alert"]')), 'viewport error');

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('invalid dimensions');
    expect(canvas().width).toBe(0);
    expect(canvas().height).toBe(0);
    expect(canvas().getAttribute('aria-label')).toBe('Page 1 of 5');
  });

  it('ignores non-finite sentence and word overlay rectangles', async () => {
    await renderView(
      [
        { page: 1, x: 10, y: 20, w: 100, h: 30 },
        { page: 1, x: Number.NaN, y: 20, w: 100, h: 30 },
        { page: 1, x: 10, y: 20, w: Number.POSITIVE_INFINITY, h: 30 },
        { page: 1, x: 10, y: 20, w: -1, h: 30 },
      ],
      undefined,
      false,
      'book-1',
      1,
      [
        { page: 1, x: 12, y: 22, w: 20, h: 10 },
        { page: 1, x: 12, y: Number.NaN, w: 20, h: 10 },
      ],
    );
    await waitFor(() => canvas().width === 600, 'first paint');

    expect(container.querySelectorAll('.rd-pdf-rect')).toHaveLength(1);
    expect(container.querySelectorAll('.rd-pdf-word')).toHaveLength(1);
  });

  it('clears the render error after a later render succeeds', async () => {
    pdf.page.render.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('Transient render error')),
      cancel: pdf.cancel,
    }));
    await renderView();
    await waitFor(() => Boolean(container.querySelector('[role="alert"]')), 'render error');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Transient render error');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')?.click();
    });
    await waitFor(() => !container.querySelector('[role="alert"]'), 'successful retry');
    expect(pdf.page.render).toHaveBeenCalledTimes(2);
  });

  it('disables page and zoom controls if the document cannot load', async () => {
    pdf.getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('Could not load this PDF')),
      destroy: pdf.destroy,
    }));
    await renderView();
    await waitFor(() => Boolean(container.querySelector('[role="alert"]')), 'document load error');

    expect(container.querySelector('.rd-pdf-count')?.textContent).toBe('Unavailable');
    for (const label of ['Previous page', 'Next page', 'Zoom in', 'Zoom out', 'Fit width', 'Fit page']) {
      expect(container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.disabled).toBe(true);
    }
  });

  it('releases the canvas bitmap and the document when unmounted', async () => {
    await renderView();
    await waitFor(() => canvas().width === 600, 'first paint');
    const element = canvas();

    act(() => root?.unmount());
    root = null;

    expect(element.width).toBe(0);
    expect(element.height).toBe(0);
    expect(pdf.destroy).toHaveBeenCalled();
    expect(pdf.cleanup).toHaveBeenCalled();
  });

  it('hides rects that belong to another page', async () => {
    await renderView([
      { page: 1, x: 10, y: 20, w: 100, h: 30 },
      { page: 2, x: 10, y: 20, w: 100, h: 30 },
    ]);
    await waitFor(() => canvas().width > 0, 'first paint');
    expect(container.querySelectorAll('.rd-pdf-rect').length).toBe(1);
  });

  it('paints at the real width after a zero-width first measure (the tiny-page report)', async () => {
    // The report was: the first paint lands before the reader's layout settles,
    // so the page is drawn at a fraction of its width until Text/Page is toggled.
    let measured = 0;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => measured });

    await renderView();
    // No width yet: painting a guess here is what produced the tiny page.
    expect(pdf.page.render).not.toHaveBeenCalled();

    measured = 300;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => canvas().width === 600, 'paint once the width is known');
    expect(parseFloat(container.querySelector<HTMLElement>('.rd-pdf-rect')?.style.width ?? '')).toBeCloseTo(50);
  });

  it('fits the whole page when it enters full screen and re-fits when it leaves', async () => {
    // Full screen: a phone-width, phone-height box, so the page must shrink to
    // the height instead of hanging off the bottom.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 300 });
    const file = new Blob(['%PDF-1.4']);

    await renderView(RECTS, file, true);
    // Fit page by default: 300/792 ≈ 0.379 of a 600pt sheet, painted at 2×.
    await waitFor(() => canvas().width === 454, 'fit-page paint in full screen');
    expect(canvas().height).toBe(600);

    // The manual override still exists, in full screen as anywhere else.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Fit width"]')?.click();
    });
    await waitFor(() => canvas().width === 1200, 'fit-width paint');

    // Leaving full screen re-fits the page for the smaller box: no button press.
    // The box is a tablet's here (700 tall), so "auto" lands on fit page again.
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
    await rerenderView(RECTS, file);
    await waitFor(() => canvas().width === 1060, 'fit page again after leaving full screen');
    // Fit page is a control in both layouts now, not a full-screen privilege.
    expect(container.querySelector('[aria-label="Fit page"]')).not.toBeNull();
  });

  it('fits a portrait page by height in a tablet-width box, without overflow', async () => {
    // A 600×792 pt sheet in a box with room for it: the height is the tighter
    // fit, and fitting only the width is what used to crop the page.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });

    await renderView();
    // 700/792 ≈ 0.884 → 530 CSS px wide, 700 tall, painted at 2×.
    await waitFor(() => canvas().width === 1060, 'fit-by-height paint');
    expect(canvas().height).toBe(1400);
    expect(canvas().width).toBeLessThan(600 * 2);
    expect(container.querySelector('[aria-label="Fit page"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[aria-label="Fit width"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('fills the width on a phone instead of fitting a thumbnail of the sheet', async () => {
    // What a phone's page box is worth once the bar, the player and the toolbar
    // have taken their share: 360×220. The report was "in page view no PDF is
    // shown" — the sheet fitted the height of this box, which is a 27px page.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 360 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 220 });

    await renderView();
    // 360/600 = 0.6 of the sheet, painted at 2×, and the box scrolls the rest.
    await waitFor(() => canvas().width === 720, 'fit-width paint');
    expect(canvas().height).toBe(950);
    expect(container.querySelector('[aria-label="Fit width"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[aria-label="Fit page"]')?.getAttribute('aria-pressed')).toBe('false');

    // The whole sheet is still one tap away, at the size it was fitted to.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Fit page"]')?.click();
    });
    await waitFor(() => canvas().width === 333, 'fit-page paint');
    expect(container.querySelector('[aria-label="Fit page"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('returns to fit page and 100% when the document changes', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });

    await renderView();
    await waitFor(() => canvas().width === 1060, 'fit-page first paint');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Fit width"]')?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click();
    });
    await waitFor(() => canvas().width === 1440, 'fit width at 120%');

    await rerenderView(RECTS, new Blob(['%PDF-1.4']), false, 'book-2');
    await waitFor(() => canvas().width === 1060, 'the new book starts at fit page, 100%');
  });

  it('scrolls the page box to a sentence that is below the fold', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

    // A 300×200 box: the sheet fills the width and hangs below the fold, so
    // following the voice scrolls from the first paint. Fit width: scale 0.5,
    // the line starts at 350px in a 200px box.
    await renderView([{ page: 1, x: 10, y: 700, w: 100, h: 30 }]);
    await waitFor(() => scrollTo.mock.calls.length > 0, 'scroll to the sentence on the first paint');

    const options = scrollTo.mock.calls.at(-1)?.[0] as ScrollToOptions;
    // Enough to bring the line in with a margin, not yanked to the very top.
    expect(options.top).toBeGreaterThan(200);
    expect(options.top).toBeLessThan(350);
    expect(options.behavior).toBe('smooth');

    // The reader asks for the whole sheet: then nothing can be below the fold.
    scrollTo.mockClear();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Fit page"]')?.click();
    });
    await waitFor(() => canvas().width === 303, 'fit-page paint');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('starts a newly shown page at its top when the box was scrolled', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

    // A box that shows the top of a page taller than itself is one the reader
    // can leave scrolled: the next page must not open halfway down.
    await renderView();
    await waitFor(() => canvas().width === 600, 'width-fit first paint');
    const box = container.querySelector<HTMLElement>('.rd-pdf-wrap');
    if (!box) throw new Error('no page box');
    box.scrollTop = 140;

    await rerenderView(RECTS, new Blob(['%PDF-1.4']), false, 'book-1', 2);
    await waitFor(() => box.scrollTop === 0, 'the new page starts at its top');
  });

  it('leaves a sentence that is already visible where it is', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

    // RECTS[0] starts at y=20: with the whole page fitted into the 200px box it
    // is already showing, so following the voice must not move anything.
    await renderView();
    await waitFor(() => canvas().width > 0, 'first paint');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('says the stored file is gone instead of failing inside pdf.js', async () => {
    await renderView(RECTS, new Blob([]));

    await waitFor(() => container.querySelector('.banner-error') !== null, 'missing-file banner');

    const banner = container.querySelector('.banner-error')?.textContent ?? '';
    expect(banner).toContain('The original file is no longer available');
    expect(banner).toContain('re-import it to use Page view and Re-analyse');
    // pdf.js would only say "The PDF file is empty, size zero bytes".
    expect(pdf.getDocument).not.toHaveBeenCalled();
  });

  it('opens the reading-order bar under the page on the very first toggle', async () => {
    const onSaveOrder = vi.fn(async () => undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PdfView
          docKey="book-1"
          file={new Blob(['%PDF-1.4'])}
          page={1}
          rects={RECTS}
          onPageChange={() => undefined}
          fullscreen={false}
          layoutBlocks={BLOCKS}
          onSaveOrder={onSaveOrder}
        />
      );
    });
    await waitFor(() => canvas().width > 0, 'first paint');

    // The bar is the row right after the page box, and it is out of the way —
    // no empty row costing the page column its gap — while the overlay is off.
    const bar = container.querySelector('.rd-pdf-wrap')?.nextElementSibling as HTMLElement;
    expect(bar).toBeInstanceOf(HTMLElement);
    expect(bar.hidden).toBe(true);
    expect(container.querySelectorAll('[data-block-id]')).toHaveLength(0);

    const layoutButton = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Layout'
    );
    await act(async () => layoutButton?.click());
    await waitFor(() => container.querySelectorAll('[data-block-id]').length === BLOCKS.length, 'the page boxes');

    // The host is only known once its ref has run. Read during the render that
    // opens the overlay it is still null, and the bar would be drawn inside the
    // page box instead of under it — over the words still to be tapped.
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain('Fix order');
    expect(container.querySelector('.rd-pdf-page')?.textContent).not.toContain('Fix order');
    expect(layoutButton?.getAttribute('aria-expanded')).toBe('true');

    // And the wiring through to the saver: tap the second block, then save.
    const panelButton = (label: string): HTMLButtonElement | undefined =>
      Array.from(bar.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === label);
    await act(async () => panelButton('Fix order')?.click());
    await act(async () => bar.querySelector<HTMLButtonElement>('[data-small-block-id="b2"]')?.click());
    await act(async () => panelButton('Save')?.click());

    expect(onSaveOrder).toHaveBeenCalledWith(['b2', 'b1']);
  });
});
