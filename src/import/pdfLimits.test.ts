import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutBox } from './layout/engine';
import { PDFJS_DOCUMENT_OPTIONS } from './pdfAssets';

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(async () => undefined),
  createLayoutDetector: vi.fn(),
  panelRects: vi.fn(),
  detector: null as { detect: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } | null,
}));

// Small budgets exercise document cancellation without generating a huge PDF.
vi.mock('./pdfAssets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pdfAssets')>();
  return {
    ...actual,
    PDF_TEXT_MAX_ITEMS_PER_PAGE: 5,
    PDF_TEXT_MAX_CHARS_PER_PAGE: 100,
    PDF_TEXT_MAX_ITEMS: 12,
    PDF_TEXT_MAX_CHARS: 100,
    PDF_MAX_PANEL_OPERATORS: 4,
    PDF_MAX_PANEL_CANDIDATES: 2,
    PDF_MAX_PANELS: 1,
  };
});

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  OPS: { constructPath: 77 },
  Util: {
    transform(first: number[], second: number[]) {
      return [
        first[0] * second[0] + first[2] * second[1],
        first[1] * second[0] + first[3] * second[1],
        first[0] * second[2] + first[2] * second[3],
        first[1] * second[2] + first[3] * second[3],
        first[0] * second[4] + first[2] * second[5] + first[4],
        first[1] * second[4] + first[3] * second[5] + first[5],
      ];
    },
  },
  getDocument: mocks.getDocument,
}));
vi.mock('./pdfWorker?worker&url', () => ({ default: 'worker.js' }));
vi.mock('../core/settings', () => ({ getSetting: async () => 'auto' }));
vi.mock('./layout/detector', () => ({
  createLayoutDetector: mocks.createLayoutDetector,
}));
vi.mock('./panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./panels')>();
  return {
    ...actual,
    panelRects: (...args: Parameters<typeof actual.panelRects>) => {
      mocks.panelRects(...args);
      return actual.panelRects(...args);
    },
  };
});

const { parsePdf } = await import('./pdf');

type RawItem = Record<string, unknown>;
interface FakePage {
  pageNumber: number;
  chunks: RawItem[][];
  viewport: { width: number; height: number; scale: number; transform: number[] };
  fnArray: number[];
  argsArray: unknown[][];
  cleanup: ReturnType<typeof vi.fn>;
  getTextContent: ReturnType<typeof vi.fn>;
  streamTextContent: ReturnType<typeof vi.fn>;
  getOperatorList: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  getViewport: ReturnType<typeof vi.fn>;
  cancelStream: ReturnType<typeof vi.fn>;
}

const VIEWPORT = { width: 612, height: 792, scale: 1, transform: [1, 0, 0, -1, 0, 792] };

function run(str: string, y = 600, extra: RawItem = {}): RawItem {
  return { str, transform: [10, 0, 0, 10, 50, y], width: 80, height: 10, hasEOL: false, ...extra };
}

function fakePage(pageNumber: number, chunks: RawItem[][], overrides: Partial<FakePage> = {}): FakePage {
  const cancelStream = vi.fn();
  const page: FakePage = {
    pageNumber,
    chunks,
    viewport: { ...VIEWPORT, transform: [...VIEWPORT.transform] },
    fnArray: [],
    argsArray: [],
    cleanup: vi.fn(),
    getTextContent: vi.fn(async () => ({ items: chunks.flat(), styles: {}, lang: 'en' })),
    streamTextContent: vi.fn(() => {
      let index = 0;
      return new ReadableStream({
        pull(controller) {
          if (index < chunks.length) controller.enqueue({ items: chunks[index++], styles: {}, lang: 'en' });
          else controller.close();
        },
        cancel: cancelStream,
      }, { highWaterMark: 0 });
    }),
    getOperatorList: vi.fn(async () => ({ fnArray: page.fnArray, argsArray: page.argsArray })),
    render: vi.fn((_options: { canvas: HTMLCanvasElement }) => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    getViewport: vi.fn(() => page.viewport),
    cancelStream,
    ...overrides,
  };
  return page;
}

function installPages(pages: FakePage[]): void {
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (pageNumber: number) => pages[pageNumber - 1],
      getMetadata: async () => ({ info: {} }),
      getOutline: async () => null,
    }),
    destroy: mocks.destroy,
  });
}

function parsedText(result: Awaited<ReturnType<typeof parsePdf>>): string {
  return result.doc.chapters
    .flatMap((chapter) => chapter.blocks.flatMap((block) => block.sentences.map((sentence) => sentence.text)))
    .join(' ');
}

beforeEach(() => {
  mocks.getDocument.mockReset();
  mocks.destroy.mockClear();
  mocks.createLayoutDetector.mockReset();
  mocks.createLayoutDetector.mockImplementation(async () => mocks.detector);
  mocks.panelRects.mockReset();
  mocks.detector = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parsePdf cancellation', () => {
  it('rejects a pre-aborted signal before creating the pdf.js loading task', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      parsePdf(new ArrayBuffer(8), 'cancelled', undefined, { layout: 'heuristic', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError', message: 'The import was cancelled.' });

    expect(mocks.getDocument).not.toHaveBeenCalled();
    expect(mocks.createLayoutDetector).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it('checks cancellation after model setup before reading any page', async () => {
    const controller = new AbortController();
    const detector = { detect: vi.fn(async () => []), dispose: vi.fn() };
    mocks.detector = detector;
    mocks.createLayoutDetector.mockImplementation(async () => {
      controller.abort();
      return detector;
    });
    const page = fakePage(1, [[run('Must not be read.')]]);
    installPages([page]);

    await expect(
      parsePdf(new ArrayBuffer(8), 'model setup', undefined, { layout: 'auto', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(page.getViewport).not.toHaveBeenCalled();
    expect(page.streamTextContent).not.toHaveBeenCalled();
    expect(detector.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('stops between pages and preserves AbortError when teardown fails', async () => {
    const controller = new AbortController();
    const detector = {
      detect: vi.fn(async () => []),
      dispose: vi.fn(() => {
        throw new Error('detector teardown failed');
      }),
    };
    mocks.detector = detector;
    mocks.destroy.mockRejectedValueOnce(new Error('worker teardown failed'));
    const pages = [1, 2, 3].map((number) => fakePage(number, [[run(`Page ${number} body text.`)]]));
    installPages(pages);
    const onProgress = vi.fn((done: number) => {
      if (done === 1) controller.abort();
    });

    await expect(
      parsePdf(new ArrayBuffer(8), 'mid-loop', onProgress, { layout: 'auto', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError', message: 'The import was cancelled.' });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(pages[0].cleanup).toHaveBeenCalledTimes(1);
    expect(pages[1].getViewport).not.toHaveBeenCalled();
    expect(pages[1].streamTextContent).not.toHaveBeenCalled();
    expect(detector.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('checks cancellation after rendering before running the layout model', async () => {
    const controller = new AbortController();
    const detector = { detect: vi.fn(async () => []), dispose: vi.fn() };
    mocks.detector = detector;
    const page = fakePage(1, [[run('Upper text.', 692), run('Lower text.', 292)]], {
      render: vi.fn((_options: { canvas: HTMLCanvasElement }) => {
        controller.abort();
        return { promise: Promise.resolve(), cancel: vi.fn() };
      }),
    });
    installPages([page]);
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(640 * 640 * 4) }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);

    await expect(
      parsePdf(new ArrayBuffer(8), 'render cancelled', undefined, { layout: 'auto', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(page.render).toHaveBeenCalledTimes(1);
    expect(getImageData).not.toHaveBeenCalled();
    expect(detector.detect).not.toHaveBeenCalled();
    const renderCanvas = page.render.mock.calls[0]?.[0].canvas as HTMLCanvasElement;
    expect(renderCanvas.width).toBe(0);
    expect(renderCanvas.height).toBe(0);
    expect(detector.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not swallow cancellation as a panel-reading fallback', async () => {
    const controller = new AbortController();
    const page = fakePage(1, [[run('Text was read.')]], {
      getOperatorList: vi.fn(async () => {
        controller.abort();
        return { fnArray: [77], argsArray: [[]] };
      }),
    });
    installPages([page]);

    await expect(
      parsePdf(new ArrayBuffer(8), 'panel cancelled', undefined, { layout: 'heuristic', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(page.streamTextContent).toHaveBeenCalledTimes(1);
    expect(page.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.panelRects).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('parsePdf resource budgets', () => {
  it('uses the shared image options and streamed text for an ordinary page', async () => {
    const page = fakePage(1, [[run('Ordinary PDF text.')]]);
    installPages([page]);

    const result = await parsePdf(new ArrayBuffer(8), 'ordinary', undefined, { layout: 'heuristic' });

    expect(mocks.getDocument).toHaveBeenCalledWith(expect.objectContaining(PDFJS_DOCUMENT_OPTIONS));
    expect(page.streamTextContent).toHaveBeenCalledTimes(1);
    expect(page.getTextContent).not.toHaveBeenCalled();
    expect(parsedText(result)).toContain('Ordinary PDF text.');
    expect(page.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects at the document text budget even when teardown fails', async () => {
    const pages = [1, 2, 3, 4, 5, 6].map((number) => fakePage(number, [[run(`Page ${number} body text.`)]]));
    installPages(pages);
    mocks.detector = {
      detect: vi.fn(async () => []),
      dispose: vi.fn(() => {
        throw new Error('detector teardown failed');
      }),
    };
    mocks.destroy.mockRejectedValueOnce(new Error('worker teardown failed'));

    await expect(parsePdf(new ArrayBuffer(8), 'budget', undefined, { layout: 'auto' }))
      .rejects.toThrow('This PDF has too much text to import safely.');

    expect(pages[5].streamTextContent).toHaveBeenCalledTimes(1);
    expect(pages[5].cancelStream).toHaveBeenCalledTimes(1);
    expect(pages[5].cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.detector.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects a giant or non-finite viewport before reading its text', async () => {
    for (const viewport of [
      { ...VIEWPORT, width: 100_001 },
      { ...VIEWPORT, height: Number.NaN },
      { ...VIEWPORT, transform: [1, 0, 0, -1, 0, Number.POSITIVE_INFINITY] },
    ]) {
      const page = fakePage(1, [[run('Must not be read.')]], { viewport });
      installPages([page]);
      await expect(parsePdf(new ArrayBuffer(8), 'bad viewport', undefined, { layout: 'heuristic' }))
        .rejects.toThrow('invalid dimensions');
      expect(page.streamTextContent).not.toHaveBeenCalled();
      expect(page.cleanup).toHaveBeenCalledTimes(1);
    }
    expect(mocks.destroy).toHaveBeenCalledTimes(3);
  });

  it('skips text runs with invalid matrices or dimensions', async () => {
    const page = fakePage(1, [[
      run('Good text.'),
      run('Bad matrix.', 600, { transform: [10, 0, 0, 10, Number.NaN, 600] }),
      run('Bad width.', 600, { width: Number.POSITIVE_INFINITY }),
      run('Bad height.', 600, { height: Number.NaN }),
      run('Later text.'),
    ]]);
    installPages([page]);

    const result = await parsePdf(new ArrayBuffer(8), 'geometry', undefined, { layout: 'heuristic' });
    const text = parsedText(result);
    expect(text).toContain('Good text.');
    expect(text).toContain('Later text.');
    expect(text).not.toContain('Bad matrix.');
    expect(text).not.toContain('Bad width.');
    expect(text).not.toContain('Bad height.');
    const rects = result.doc.chapters.flatMap((chapter) =>
      chapter.blocks.flatMap((block) => block.sentences.flatMap((sentence) => sentence.pdfRects ?? [])),
    );
    expect(rects.every((rect) => [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite))).toBe(true);
  });

  it('falls back to text heuristics without scanning an excessive operator list', async () => {
    const page = fakePage(1, [[run('Text still imports.')]]);
    page.fnArray = [1, 2, 3, 4, 5];
    page.argsArray = [[], [], [], [], []];
    installPages([page]);

    const result = await parsePdf(new ArrayBuffer(8), 'operators', undefined, { layout: 'heuristic' });

    expect(parsedText(result)).toContain('Text still imports.');
    expect(mocks.panelRects).not.toHaveBeenCalled();
  });

  it('falls back when panel path candidates exceed their budget', async () => {
    const page = fakePage(1, [[run('Candidate fallback.')]]);
    page.fnArray = [77, 77, 77];
    page.argsArray = [[], [], []];
    installPages([page]);

    const result = await parsePdf(new ArrayBuffer(8), 'candidates', undefined, { layout: 'heuristic' });

    expect(parsedText(result)).toContain('Candidate fallback.');
    expect(mocks.panelRects).not.toHaveBeenCalled();
  });

  it('drops invalid model boxes and releases the fixed layout canvas', async () => {
    const page = fakePage(1, [[run('Upper text.', 692), run('Lower text.', 292)]]);
    installPages([page]);
    mocks.detector = {
      detect: vi.fn(async () => [
        { x: Number.NaN, y: 10, w: 20, h: 30, label: 'text', score: 0.9 },
        { x: 10, y: 100, w: 100, h: 50, label: 'text', score: 0.9 },
      ] as LayoutBox[]),
      dispose: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getImageData: () => ({ data: new Uint8ClampedArray(640 * 640 * 4) }),
    } as unknown as CanvasRenderingContext2D);

    const result = await parsePdf(new ArrayBuffer(8), 'model', undefined, { layout: 'auto' });
    const renderCanvas = page.render.mock.calls[0]?.[0].canvas as HTMLCanvasElement;

    expect(mocks.detector.detect).toHaveBeenCalledTimes(1);
    expect(result.modelPages).toBe(1);
    expect(parsedText(result)).toContain('Upper text.');
    expect(parsedText(result)).toContain('Lower text.');
    expect(renderCanvas.width).toBe(0);
    expect(renderCanvas.height).toBe(0);
    expect(mocks.detector.dispose).toHaveBeenCalledTimes(1);
  });
});
