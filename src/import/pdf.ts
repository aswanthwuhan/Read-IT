// The polyfills go in before pdf.js evaluates, and the legacy build is the one
// pdf.js ships for engines older than the newest Chromium (see pdfPolyfill.ts).
import './pdfPolyfill';
import { GlobalWorkerOptions, OPS, Util, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PDF_IMPORT_MAX_BYTES, PDF_MAX_PAGES } from './limits';
import workerUrl from './pdfWorker?worker&url';
import type { ParsedDoc, PdfRect } from '../core/types';
import { getSetting } from '../core/settings';
import { normaliseText } from './blocks';
import { layoutParagraphs, type AssignOptions } from './layout/assign';
import { createLayoutDetector, type PageLayoutDetector } from './layout/detector';
import { LAYOUT_MODEL } from './layout/model';
import { MAX_LAYOUT_BOXES, isValidLayoutBox, type LayoutBox } from './layout/engine';
import {
  chaptersFromPages,
  classifyParagraphs,
  documentGutter,
  dropPageFurniture,
  gutterHasTextOnBothSides,
  itemsToPageLines,
  lineMetrics,
  linesToParagraphs,
  needsModelLayout,
  pageGutter,
  pageRunsInColumns,
  stitchPages,
  typicalPitch,
  type ChapterStart,
  type Gutter,
  type PdfPage,
  type PdfParagraph,
  type PdfTextItem,
} from './pdfLayout';
import type { ColumnMode, PanelRect } from './layout/assign';
import { panelRects } from './panels';
import {
  PDF_ASSETS,
  PDFJS_DOCUMENT_OPTIONS,
  PDF_MAX_PANEL_CANDIDATES,
  PDF_MAX_PANEL_OPERATORS,
  PDF_MAX_PANELS,
  PDF_TEXT_MAX_CHARS,
  PDF_TEXT_MAX_CHARS_PER_PAGE,
  PDF_TEXT_MAX_ITEMS,
  PDF_TEXT_MAX_ITEMS_PER_PAGE,
  getValidatedPdfViewport,
  isFiniteMatrix,
  isFiniteRect,
  isPdfTextItem,
  readPdfTextItems,
  type PdfRawTextItem,
  type PdfViewportGeometry,
} from './pdfAssets';

GlobalWorkerOptions.workerSrc ||= workerUrl;

/**
 * How a book's layout is worked out. `auto` uses the model when it is downloaded
 * and the text heuristics otherwise; `heuristic` never touches the model, for a
 * book where the text layout reads better.
 */
export type LayoutMode = 'auto' | 'heuristic';

export interface PdfParseResult {
  doc: ParsedDoc;
  /** Text extracted per page — under ~50 means the PDF is probably a scan. */
  charsPerPage: number;
  pageCount: number;
  /**
   * How the layout was decided, so the importer can tell the user what ran:
   * `model` when the detector was there for every page that asked for it.
   */
  layout: 'model' | 'heuristic';
  /** Pages the model laid out; 0 with `model` means no page needed it. */
  modelPages: number;
  /**
   * Set when the model was installed and wanted but did not lay out every page
   * that asked for it, in words the reader can be shown. A silent fall back to
   * the text layout looks exactly like a model that does not work.
   */
  modelNote?: string;
}

export interface PdfParseOptions {
  /**
   * How many columns the pages have. Left alone, a gutter is looked for and
   * used when the text shows one.
   */
  columns?: ColumnMode;
  /**
   * Whether this parse may use the layout model. Left out, the reader's
   * device-wide choice decides; the import question sets it for the book being
   * imported, before the model is even read.
   */
  layout?: LayoutMode;
  /** Cancels at page and layout boundaries, releasing pdf.js and model resources. */
  signal?: AbortSignal;
}

export async function parsePdf(
  data: ArrayBuffer,
  fallbackTitle: string,
  onProgress?: (done: number, total: number, phase?: 'text' | 'layout') => void,
  options: PdfParseOptions = {},
): Promise<PdfParseResult> {
  const signal = options.signal;
  const columns = options.columns ?? 'auto';
  throwIfAborted(signal);
  if (data.byteLength > PDF_IMPORT_MAX_BYTES) {
    throw new Error('That PDF is too large to import (over 200 MB).');
  }
  const loadingTask = getDocument({ data: new Uint8Array(data), ...PDF_ASSETS, ...PDFJS_DOCUMENT_OPTIONS });
  let detector: PageLayoutDetector | null = null;
  const disposeDetector = () => {
    try {
      detector?.dispose();
    } catch {
      // Teardown is best-effort; never replace the parse/abort/budget error.
    } finally {
      detector = null;
    }
  };

  try {
    const pdf = await loadingTask.promise;
    throwIfAborted(signal);
    if (pdf.numPages > PDF_MAX_PAGES) {
      throw new Error('That PDF is too large to import (over 10,000 pages).');
    }
    const { title, author } = await metadata(pdf, fallbackTitle);
    throwIfAborted(signal);
    const pages: PdfPage[] = [];
    const pageItems: PdfTextItem[][] = [];
    const pageBoxes: LayoutBox[][] = [];
    const pagePanelList: PanelRect[][] = [];
    const pageGutters: (Gutter | null)[] = [];
    let modelNote: string | undefined;
    try {
      detector = await layoutDetector(options.layout);
    } catch (error) {
      // A machine without WebAssembly, or a corrupt download: read the text as
      // before rather than failing the whole import — and say so.
      modelNote = `The layout model could not start, so this PDF was read with the text layout only (${reason(error)}).`;
    }
    throwIfAborted(signal);
    let misses = 0;
    let failed = 0;
    let totalTextItems = 0;
    let totalTextChars = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      throwIfAborted(signal);
      const page = await pdf.getPage(pageNumber);
      try {
        throwIfAborted(signal);
        const viewport = getValidatedPdfViewport(page, 1);

        const items: PdfTextItem[] = [];
        let spaceBefore = false;
        const itemLimit = Math.min(PDF_TEXT_MAX_ITEMS_PER_PAGE, PDF_TEXT_MAX_ITEMS - totalTextItems);
        const charLimit = Math.min(PDF_TEXT_MAX_CHARS_PER_PAGE, PDF_TEXT_MAX_CHARS - totalTextChars);
        const read = await readPdfTextItems(
          page,
          {
            maxItems: itemLimit,
            maxChars: charLimit,
            pageNumber,
            scope:
              itemLimit < PDF_TEXT_MAX_ITEMS_PER_PAGE || charLimit < PDF_TEXT_MAX_CHARS_PER_PAGE
                ? 'document'
                : 'page',
          },
          (raw) => {
            throwIfAborted(signal);
            if (!isPdfTextItem(raw)) return;
            if (!raw.str.trim()) {
              // pdf.js reports the space between two runs (roman → italic → roman) as
              // a run of its own. The gap it stands for is often narrower than the
              // gap rule accepts, so dropping it reads "studied in vivo induced" as
              // "studiedin vivoinduced": hand the space to the run that follows.
              spaceBefore = raw.str.length > 0;
              return;
            }
            const item = textItemFromRaw(raw, viewport, pageNumber, spaceBefore);
            spaceBefore = false;
            if (item) items.push(item);
          },
        );
        throwIfAborted(signal);
        totalTextItems += read.items;
        totalTextChars += read.chars;

        // Boxed panels are painted graphics, so they have to be read before
        // `cleanup` drops the page's operator list.
        const panels = await pagePanelsWithinBudget(page, viewport, items, signal);
        throwIfAborted(signal);
        const gutter = columns === 1 ? null : pageGutter(items, viewport.width);
        const pageLines = itemsToPageLines(items, viewport.width, { panels, gutter, columns });
        const sheet: PdfPage = { width: viewport.width, height: viewport.height, lines: pageLines };

        if (detector && needsModelLayout(sheet)) {
          // The page has to be rasterised before `cleanup` drops its operators.
          const boxes = await detectBoxes(detector, page, viewport, pageNumber, signal);
          throwIfAborted(signal);
          // One page that will not render must not cost the rest of the book its
          // layout; three in a row means the model itself is gone.
          misses = boxes ? 0 : misses + 1;
          if (!boxes) failed += 1;
          if (misses >= 3) {
            // Dropping the handle alone would leave the worker and its ~200 MB alive.
            disposeDetector();
          }
          pageBoxes.push(boxes ?? []);
        } else {
          pageBoxes.push([]);
        }

        pages.push(sheet);
        pageItems.push(items);
        pagePanelList.push(panels);
        pageGutters.push(gutter);
      } finally {
        try {
          page.cleanup();
        } catch {
          // The page may already be gone with its document.
        }
      }
      // One page at a time, so a long paper never blocks the caller for the whole
      // run and the UI can show where it has got to.
      onProgress?.(pageNumber, pdf.numPages, detector ? 'layout' : 'text');
    }

    throwIfAborted(signal);
    const modelStayed = detector !== null;
    disposeDetector();
    throwIfAborted(signal);

    // A page whose own text is too thin to show a corridor is still read in the
    // book's two columns, so long as the book mostly showed one and this page
    // has text running up to both edges of it.
    const textPages = pageItems.filter((items) => items.length > 0).length;
    const bookGutter = documentGutter(pageGutters, textPages);
    if (bookGutter) {
      pages.forEach((page, index) => {
        if (pageGutters[index]) return;
        const items = pageItems[index];
        // A figure or a full-page table has no text beside the corridor, and
        // splitting it there would cut it in two.
        if (columns !== 2 && !gutterHasTextOnBothSides(items, bookGutter, page.width)) return;
        // A one-column page's full-width lines also run up to both edges of a
        // corridor; only a page whose rows mostly run along it reads in columns.
        if (columns !== 2 && !pageRunsInColumns(items, bookGutter)) return;
        page.lines = itemsToPageLines(items, page.width, {
          panels: pagePanelList[index],
          gutter: bookGutter,
          columns,
        });
      });
    }

    const clean = dropPageFurniture(pages);
    const metrics = clean.map((page) => lineMetrics(page.lines));
    const documentPitch = typicalPitch(clean);

    throwIfAborted(signal);
    const paragraphs: PdfParagraph[] = [];
    clean.forEach((page, index) => {
      const pageNumber = index + 1;
      const pitch = metrics[index].pitch || documentPitch;
      const measure = metrics[index].measure || page.width;
      const boxes = pageBoxes[index];

      // Running heads that repeat on most pages are already gone; what the model
      // calls a header or a footer is a one-off, and it becomes a skippable block.
      const kept = new Set(page.lines.flatMap((line) => line.items));
      const items = pageItems[index].filter((item) => kept.has(item));

      // The band the page was read in, so the model's boxes follow the same
      // panels, columns and gutter the text layout did.
      const modelOptions: AssignOptions = {
        pitch,
        measure,
        panels: pagePanelList[index],
        columns,
        gutter: pageGutters[index] ?? bookGutter ?? undefined,
      };

      const laidOut = boxes.length
        ? layoutParagraphs(pageNumber, page.width, page.height, items, boxes, modelOptions)
        : [];

      paragraphs.push(
        ...(laidOut.length ? laidOut : linesToParagraphs(pageNumber, page.lines, page.width, pitch, measure)),
      );
    });

    const finalParagraphs = stitchPages(classifyParagraphs(paragraphs, clean));
    const charCount = finalParagraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0);
    throwIfAborted(signal);
    const outline = await outlineStarts(pdf, signal);
    throwIfAborted(signal);
    const chapters = chaptersFromPages(finalParagraphs, outline, pdf.numPages);
    const doc = sanitisePdfRects({ title, author, format: 'pdf', chapters }, pages);

    return {
      doc,
      charsPerPage: pdf.numPages ? charCount / pdf.numPages : 0,
      pageCount: pdf.numPages,
      // A page the model could not read was laid out from the text: say so, and
      // the book stays on offer for re-analysis.
      layout: modelStayed && failed === 0 ? 'model' : 'heuristic',
      modelNote:
        modelNote ??
        (failed
          ? `The layout model failed on ${failed} ${failed === 1 ? 'page' : 'pages'}${modelStayed ? '' : ' and was stopped'}; ${modelStayed ? (failed === 1 ? 'that page was' : 'those pages were') : 'the rest of this PDF was'} read with the text layout only.`
          : undefined),
      modelPages: pageBoxes.filter((boxes) => boxes.length > 0).length,
    };
  } finally {
    // A page that throws must not strand the model either.
    disposeDetector();
    try {
      await loadingTask.destroy();
    } catch {
      // Do not replace a controlled page/budget error with a teardown failure.
    }
  }
}

/** One validated pdf.js text run in scale-1, top-left-origin page space. */
function textItemFromRaw(
  raw: Extract<PdfRawTextItem, { str: string }>,
  viewport: PdfViewportGeometry,
  pageNumber: number,
  spaceBefore: boolean,
): PdfTextItem | null {
  if (!isFiniteMatrix(raw.transform)) return null;
  const width = raw.width ?? 0;
  if (!Number.isFinite(width) || width < 0) return null;
  if (raw.height !== undefined && (!Number.isFinite(raw.height) || raw.height < 0)) return null;

  try {
    // Viewport transform maps PDF user space to scale-1, top-left-origin space.
    const matrix = Util.transform(viewport.transform as number[], raw.transform as number[]) as number[];
    if (!isFiniteMatrix(matrix)) return null;
    const height = Math.hypot(matrix[2], matrix[3]);
    if (!(height > 0)) return null;
    const x = matrix[4];
    const y = matrix[5] - height;
    if (!isFiniteRect({ x, y, w: width, h: height })) return null;

    // Text far outside its page cannot produce a useful highlight, and allowing
    // it through makes later line/rectangle arithmetic depend on hostile values.
    const reach = Math.max(viewport.width, viewport.height);
    if (
      x < -reach ||
      y < -reach ||
      x > reach * 2 ||
      y > reach * 2 ||
      width > reach * 4 ||
      height > reach * 4
    ) {
      return null;
    }

    const str = spaceBefore && !/^\s/.test(raw.str) ? ` ${raw.str}` : raw.str;
    return { str, x, y, w: width, h: height, page: pageNumber };
  } catch {
    return null;
  }
}

/**
 * Operator lists are already accumulated by pdf.js. Refuse to scan or merge an
 * excessive one; the page then uses the ordinary text heuristics.
 */
async function pagePanelsWithinBudget(
  page: Pick<PDFPageProxy, 'getOperatorList'>,
  viewport: PdfViewportGeometry,
  items: readonly PdfTextItem[],
  signal?: AbortSignal,
): Promise<PanelRect[]> {
  if (!items.length) return [];
  try {
    const list = await page.getOperatorList();
    throwIfAborted(signal);
    if (list.fnArray.length > PDF_MAX_PANEL_OPERATORS || list.argsArray.length > PDF_MAX_PANEL_OPERATORS) return [];

    let candidates = 0;
    for (let index = 0; index < list.fnArray.length; index += 1) {
      if (list.fnArray[index] !== OPS.constructPath) continue;
      candidates += 1;
      if (candidates > PDF_MAX_PANEL_CANDIDATES) return [];
    }

    const panels = panelRects(
      list.fnArray,
      list.argsArray,
      OPS,
      viewport.transform,
      viewport.width,
      viewport.height,
      items,
    ).filter((rect) => isFiniteRect(rect, true));
    return panels.length > PDF_MAX_PANELS ? [] : panels;
  } catch {
    if (signal?.aborted) throwIfAborted(signal);
    return [];
  }
}

/** Drop unusable generated highlights without discarding their readable text. */
function sanitisePdfRects(doc: ParsedDoc, pages: readonly PdfPage[]): ParsedDoc {
  // This document has just been built and is not shared or persisted yet. Filter
  // in place rather than cloning every sentence in a potentially large book.
  for (const chapter of doc.chapters) {
    for (const block of chapter.blocks) {
      for (const sentence of block.sentences) {
        if (!sentence.pdfRects) continue;
        const rects = sentence.pdfRects.filter((rect) => validPdfRect(rect, pages));
        if (rects.length !== sentence.pdfRects.length) sentence.pdfRects = rects;
      }
    }
  }
  return doc;
}

function validPdfRect(rect: PdfRect, pages: readonly PdfPage[]): boolean {
  if (!Number.isInteger(rect.page) || rect.page < 1 || rect.page > pages.length) return false;
  if (!isFiniteRect(rect, true)) return false;
  const page = pages[rect.page - 1];
  // A glyph's estimated box may overhang an edge by a point; a box wholly off
  // its page is invalid and must never reach CSS or persistence.
  return rect.x + rect.w > 0 && rect.y + rect.h > 0 && rect.x < page.width && rect.y < page.height;
}

/** The detector, when this parse allows it and the model is installed. */
async function layoutDetector(override?: LayoutMode): Promise<PageLayoutDetector | null> {
  // A settings read that fails is not a model that failed: fall back to the default.
  const mode =
    override ?? (await getSetting<LayoutMode>('import.layout', 'auto').catch(() => 'auto' as LayoutMode));
  if (mode === 'heuristic') return null;
  // Null when the model is not downloaded; a model that is there and will not
  // start throws, and the caller reports it.
  return createLayoutDetector();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
}

function reason(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).trim().replace(/[.\s]+$/, '');
  return text || 'no reason given';
}

/**
 * Render one page into the model's square input and read its regions.
 * Returns null when rendering is impossible, so the caller can stop trying.
 */
async function detectBoxes(
  detector: PageLayoutDetector,
  page: PDFPageProxy,
  viewport: ReturnType<PDFPageProxy['getViewport']> & PdfViewportGeometry,
  pageNumber: number,
  signal?: AbortSignal,
): Promise<LayoutBox[] | null> {
  throwIfAborted(signal);
  const size = LAYOUT_MODEL.inputSize;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) return null;

  canvas.width = size;
  canvas.height = size;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    // The model was trained on pages stretched to a square, so the page is
    // squashed into it; scale_factor stays 1 and the boxes are mapped back by
    // dividing by the input size.
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: [size / viewport.width, 0, 0, size / viewport.height, 0, 0],
    }).promise;
    throwIfAborted(signal);
    const pixels = context.getImageData(0, 0, size, size).data;
    const detected = await detector.detect(pixels, viewport.width, viewport.height);
    throwIfAborted(signal);
    if (!Array.isArray(detected) || detected.length > MAX_LAYOUT_BOXES) return [];
    return detected.filter((box) => isValidLayoutBox(box, viewport.width, viewport.height));
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    console.warn(`Layout detection failed on page ${pageNumber}; using text heuristics.`, error);
    return null;
  } finally {
    // The fixed 640×640 input is not needed after detection. Release it even
    // when rendering or the worker fails.
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function metadata(pdf: PDFDocumentProxy, fallbackTitle: string): Promise<{ title: string; author?: string }> {
  let title = normaliseText(fallbackTitle);
  let author: string | undefined;

  try {
    const info = (await pdf.getMetadata()).info as Record<string, unknown>;
    if (typeof info.Title === 'string' && info.Title.trim()) title = normaliseText(info.Title);
    if (typeof info.Author === 'string' && info.Author.trim()) author = normaliseText(info.Author) || undefined;
  } catch {
    // Metadata is optional; the file name is a fine title.
  }

  return { title: title || 'Untitled PDF', author };
}

/** Top-level outline entries only: sub-headings would fragment chapters. */
async function outlineStarts(pdf: PDFDocumentProxy, signal?: AbortSignal): Promise<ChapterStart[]> {
  let outline: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>;
  try {
    outline = await pdf.getOutline();
  } catch {
    return [];
  }
  throwIfAborted(signal);
  if (!outline?.length) return [];

  const starts: ChapterStart[] = [];
  for (const node of outline) {
    throwIfAborted(signal);
    const page = await destinationPage(pdf, node.dest);
    if (page !== null) starts.push({ page: page + 1, title: normaliseText(node.title) });
  }

  starts.sort((a, b) => a.page - b.page);
  return starts.filter((start, index) => index === 0 || start.page > starts[index - 1].page);
}

async function destinationPage(pdf: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const resolved = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(resolved) || !resolved.length) return null;

    const target = resolved[0];
    if (typeof target === 'number') return target;
    if (target && typeof target === 'object') {
      return await pdf.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
    }
  } catch {
    // Broken destination: fall back to the 20-page chapters.
  }
  return null;
}

