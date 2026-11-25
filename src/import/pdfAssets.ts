/**
 * Shared pdf.js resource limits and geometry checks.
 *
 * The asset URLs live here too. Keeping the document options in one place means
 * import and Page view decode images under the same budget; a PDF that was safe
 * to import must not become unsafe merely because it is opened in the reader.
 */
import type { PDFPageProxy } from 'pdfjs-dist';

/**
 * Where pdf.js finds its image decoders (JPEG 2000, JBIG2, ICC) and the 14
 * standard fonts — copied into `public/pdfjs/` by scripts/copy-pdfjs.mjs.
 * Without them a scanned page, usually one JPX or JBIG2 image, paints blank.
 * pdf.js requires the trailing slash.
 */
const PDFJS_BASE = `${import.meta.env.BASE_URL}pdfjs/`;

export const PDF_ASSETS = {
  wasmUrl: `${PDFJS_BASE}wasm/`,
  standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
  iccUrl: `${PDFJS_BASE}iccs/`,
} as const;

/** One decoded RGBA image may use at most 64 MB. */
export const PDF_MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
export const PDF_CANVAS_MAX_AREA_BYTES = PDF_MAX_IMAGE_PIXELS * 4;

/** Options understood by pdf.js itself, before our per-page work starts. */
export const PDFJS_DOCUMENT_OPTIONS = {
  maxImageSize: PDF_MAX_IMAGE_PIXELS,
  canvasMaxAreaInBytes: PDF_CANVAS_MAX_AREA_BYTES,
} as const;

/** A crafted MediaBox must not turn page geometry into an enormous allocation. */
export const PDF_MAX_PAGE_DIMENSION = 100_000;
export const PDF_MAX_PAGE_AREA = 1_000_000_000;

/** Text is streamed in small chunks; stop a hostile page before it accumulates. */
export const PDF_TEXT_MAX_ITEMS_PER_PAGE = 50_000;
export const PDF_TEXT_MAX_CHARS_PER_PAGE = 1_000_000;
/** Whole-import backstops, including text on pages that later become furniture. */
export const PDF_TEXT_MAX_ITEMS = 1_000_000;
export const PDF_TEXT_MAX_CHARS = 50_000_000;

/** Operator scanning and panel merging are bounded, with text layout as fallback. */
export const PDF_MAX_PANEL_OPERATORS = 100_000;
export const PDF_MAX_PANEL_CANDIDATES = 512;
export const PDF_MAX_PANELS = 64;

/** Page view's backing store, independent of the CSS size of a zoomed page. */
export const PDF_READER_CANVAS_MAX_PIXELS = 16 * 1024 * 1024;
export const PDF_READER_CANVAS_MAX_DIMENSION = 8_192;

export interface PdfViewportGeometry {
  width: number;
  height: number;
  scale?: number;
  transform: readonly number[];
}

/** Six finite matrix entries, including a non-singular linear component. */
export function isFiniteMatrix(value: unknown): value is readonly number[] {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return false;
  const numbers = value as ArrayLike<unknown>;
  if (numbers.length < 6) return false;
  for (let index = 0; index < 6; index += 1) {
    if (!Number.isFinite(Number(numbers[index]))) return false;
  }
  const a = Number(numbers[0]);
  const b = Number(numbers[1]);
  const c = Number(numbers[2]);
  const d = Number(numbers[3]);
  const determinant = a * d - b * c;
  return Number.isFinite(determinant) && determinant !== 0;
}

/** Page dimensions and transform must be usable before any page work begins. */
export function isValidPdfViewport(
  value: unknown,
  maxDimension = PDF_MAX_PAGE_DIMENSION,
  maxArea = PDF_MAX_PAGE_AREA,
): value is PdfViewportGeometry {
  if (!value || typeof value !== 'object') return false;
  const viewport = value as Partial<PdfViewportGeometry>;
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    !(viewport.width! > 0) ||
    !(viewport.height! > 0) ||
    viewport.width! > maxDimension ||
    viewport.height! > maxDimension ||
    viewport.width! * viewport.height! > maxArea
  ) {
    return false;
  }
  if (viewport.scale !== undefined && (!Number.isFinite(viewport.scale) || !(viewport.scale > 0))) return false;
  return isFiniteMatrix(viewport.transform);
}

/** A controlled failure, rather than allowing NaN/Infinity into layout or render. */
export const PDF_INVALID_VIEWPORT_MESSAGE = 'This PDF page has invalid dimensions and cannot be opened safely.';

export function assertPdfViewport(
  value: unknown,
  maxDimension = PDF_MAX_PAGE_DIMENSION,
  maxArea = PDF_MAX_PAGE_AREA,
): asserts value is PdfViewportGeometry {
  if (!isValidPdfViewport(value, maxDimension, maxArea)) {
    throw new Error(PDF_INVALID_VIEWPORT_MESSAGE);
  }
}

/** Read and validate a viewport, including proxies that throw while building it. */
export function getValidatedPdfViewport(
  page: Pick<PDFPageProxy, 'getViewport'>,
  scale: number,
  maxDimension = PDF_MAX_PAGE_DIMENSION,
  maxArea = PDF_MAX_PAGE_AREA,
): ReturnType<PDFPageProxy['getViewport']> {
  try {
    const viewport = page.getViewport({ scale });
    assertPdfViewport(viewport, maxDimension, maxArea);
    return viewport;
  } catch {
    throw new Error(PDF_INVALID_VIEWPORT_MESSAGE);
  }
}

export interface FiniteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Finite, non-negative geometry whose far edges do not overflow. */
export function isFiniteRect(value: unknown, positiveSize = false): value is FiniteRect {
  if (!value || typeof value !== 'object') return false;
  const rect = value as Partial<FiniteRect>;
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.w) ||
    !Number.isFinite(rect.h) ||
    !(rect.w! >= 0) ||
    !(rect.h! >= 0) ||
    (positiveSize && (!(rect.w! > 0) || !(rect.h! > 0)))
  ) {
    return false;
  }
  return Number.isFinite(rect.x! + rect.w!) && Number.isFinite(rect.y! + rect.h!);
}

export type PdfRawTextItem = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'][number];
type PdfTextPage = Pick<PDFPageProxy, 'streamTextContent' | 'getTextContent'>;

export function isPdfTextItem(value: unknown): value is Extract<PdfRawTextItem, { str: string }> {
  return value !== null && typeof value === 'object' && 'str' in value && typeof value.str === 'string';
}

export interface PdfTextReadLimits {
  maxItems: number;
  maxChars: number;
  pageNumber: number;
  /** A document-wide remainder is reported as a document failure, not a page failure. */
  scope?: 'page' | 'document';
}

export class PdfTextBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfTextBudgetError';
  }
}

function textBudgetError(pageNumber: number, scope: 'page' | 'document'): PdfTextBudgetError {
  return new PdfTextBudgetError(
    scope === 'document'
      ? 'This PDF has too much text to import safely.'
      : `This PDF has too much text on page ${pageNumber} to import safely.`,
  );
}

function checkTextBudget(
  items: readonly PdfRawTextItem[],
  itemCount: number,
  charCount: number,
  limits: PdfTextReadLimits,
): number {
  if (itemCount + items.length > limits.maxItems) {
    throw textBudgetError(limits.pageNumber, limits.scope ?? 'page');
  }
  let chars = 0;
  for (const item of items) {
    if (isPdfTextItem(item)) chars += item.str.length;
  }
  if (charCount + chars > limits.maxChars) throw textBudgetError(limits.pageNumber, limits.scope ?? 'page');
  return chars;
}

/**
 * Visit one page's text without first joining the whole page into one array.
 * pdf.js streams 100 items at a time; cancelling the reader on overflow also
 * cancels the worker's extraction. `getTextContent` remains a compatibility
 * fallback for older/custom page proxies.
 */
export async function readPdfTextItems(
  page: PdfTextPage,
  limits: PdfTextReadLimits,
  visit: (item: PdfRawTextItem) => void,
): Promise<{ items: number; chars: number }> {
  let stream: ReadableStream<Awaited<ReturnType<PDFPageProxy['getTextContent']>>> | null = null;
  try {
    if (typeof page.streamTextContent === 'function') stream = page.streamTextContent();
  } catch {
    // Some older WebViews expose only the accumulated API.
  }

  if (stream) {
    const reader = stream.getReader();
    let items = 0;
    let chars = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = Array.isArray(value?.items) ? value.items : [];
        chars += checkTextBudget(chunk, items, chars, limits);
        items += chunk.length;
        for (const item of chunk) visit(item);
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // The original extraction/budget failure is the useful one.
      }
      throw error;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // A reader whose stream already failed may have released itself.
      }
    }
    return { items, chars };
  }

  const content = await page.getTextContent();
  const items = Array.isArray(content?.items) ? content.items : [];
  const chars = checkTextBudget(items, 0, 0, limits);
  for (const item of items) visit(item);
  return { items: items.length, chars };
}
