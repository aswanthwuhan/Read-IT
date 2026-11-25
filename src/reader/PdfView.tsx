/**
 * PDF page view: the real page image with the current sentence boxed on it.
 *
 * Rectangles in `Sentence.pdfRects` are PDF user-space units at scale 1, which
 * is exactly what `page.getViewport({ scale })` scales — so an overlay div at
 * `x * scale` lands on the right glyphs with no PDF matrix maths here.
 *
 * This module is loaded lazily (only for PDF books in page mode) because
 * pdfjs-dist is by far the heaviest dependency in the app.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
// pdf.js 6's default build calls ES2025 helpers the phone's WebView does not
// have (every import crashed with "a.toHex is not a function" on WebView 134);
// the polyfills and the official legacy build are the fix — see pdfPolyfill.ts.
import '../import/pdfPolyfill';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from '../import/pdfWorker?worker&url';
import { MISSING_FILE_MESSAGE, fileMissing } from '../import';
import {
  PDF_ASSETS,
  PDFJS_DOCUMENT_OPTIONS,
  PDF_READER_CANVAS_MAX_DIMENSION,
  PDF_READER_CANVAS_MAX_PIXELS,
  PDF_INVALID_VIEWPORT_MESSAGE,
  PDF_TEXT_MAX_CHARS_PER_PAGE,
  PDF_TEXT_MAX_ITEMS_PER_PAGE,
  getValidatedPdfViewport,
  isFiniteRect,
  isPdfTextItem,
  readPdfTextItems,
  type PdfRawTextItem,
} from '../import/pdfAssets';
import type { PdfRect } from '../core/types';
import type { PageBlock } from './blockOrder';
import LayoutOverlay from './LayoutOverlay';
import { Glyph, icons } from './Icon';

GlobalWorkerOptions.workerSrc ||= workerUrl;

interface Props {
  /** Identity of the document: reload only when the book changes. */
  docKey: string;
  file: Blob;
  page: number;
  /** Rectangles of the current sentence, on any page. */
  rects: PdfRect[];
  /** Rectangles of the word being spoken, inside `rects`. */
  wordRects?: PdfRect[];
  onPageChange(page: number): void;
  /** Full screen offers "fit page" as well, for seeing a whole figure at once. */
  fullscreen?: boolean;
  /**
   * The blocks printed on this page, for the reading-order overlay. Empty means
   * there is no order to show: the Layout button stays out of the bar.
   */
  layoutBlocks?: PageBlock[];
  /**
   * Store a new order for this page. The reader owns the book record and
   * reloads it, so page view only hands the ids over.
   */
  onSaveOrder?(ids: string[]): Promise<void>;
}

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 3;
/** The narrowest a fitted page may be and still read as a page (CSS px). */
const MIN_PAGE_PX = 360;
const MAX_DEVICE_DPR = 2;

/**
 * Effective render scale after the backing-store caps. It falls below one for
 * a very large zoom: the CSS page stays sharp in layout terms without asking
 * the WebView for an unbounded bitmap.
 */
export function canvasBackingRatio(width: number, height: number, devicePixelRatio: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !(width > 0) || !(height > 0)) return 0;
  const area = width * height;
  if (!Number.isFinite(area) || !(area > 0)) return 0;
  const requested =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(devicePixelRatio, MAX_DEVICE_DPR) : 1;
  return Math.min(
    requested,
    PDF_READER_CANVAS_MAX_DIMENSION / width,
    PDF_READER_CANVAS_MAX_DIMENSION / height,
    Math.sqrt(PDF_READER_CANVAS_MAX_PIXELS / area),
  );
}

export function canvasBackingSize(
  width: number,
  height: number,
  devicePixelRatio: number,
): { width: number; height: number; ratio: number } {
  const ratio = canvasBackingRatio(width, height, devicePixelRatio);
  if (!(ratio > 0)) return { width: 0, height: 0, ratio: 0 };
  return {
    width: Math.min(PDF_READER_CANVAS_MAX_DIMENSION, Math.max(1, Math.floor(width * ratio))),
    height: Math.min(PDF_READER_CANVAS_MAX_DIMENSION, Math.max(1, Math.floor(height * ratio))),
    ratio,
  };
}

function validOverlayRect(rect: PdfRect, scale = 1): boolean {
  if (!Number.isInteger(rect.page) || !isFiniteRect(rect)) return false;
  if (!Number.isFinite(scale) || !(scale > 0)) return false;
  const left = rect.x * scale;
  const top = rect.y * scale;
  const width = Math.max(rect.w * scale, 2);
  const height = Math.max(rect.h * scale, 2);
  return [left, top, width, height, left + width, top + height].every(Number.isFinite);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function touchDistance(touches: ArrayLike<{ clientX: number; clientY: number }>): number {
  const [a, b] = [touches[0], touches[1]];
  if (!a || !b) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** Turn pdf.js text items into readable prose without inventing missing words. */
function readablePageText(content: Iterable<PdfRawTextItem>): string {
  let text = '';
  let spaceBefore = false;
  for (const item of content) {
    if (!isPdfTextItem(item)) continue;
    if (!item.str.trim()) {
      // pdf.js can report the gap between font runs as a whitespace-only item.
      // Preserve that gap, but never insert spaces inside a split word.
      if (item.hasEOL) {
        if (text && !text.endsWith('\n')) text += '\n';
        spaceBefore = false;
      } else {
        spaceBefore ||= item.str.length > 0;
      }
      continue;
    }
    text += spaceBefore && !/^\s/.test(item.str) ? ` ${item.str}` : item.str;
    spaceBefore = false;
    if (item.hasEOL && !text.endsWith('\n')) text += '\n';
  }
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function PdfView({
  docKey,
  file,
  page,
  rects,
  wordRects,
  onPageChange,
  fullscreen = false,
  layoutBlocks = [],
  onSaveOrder,
}: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  // How the page is fitted before `zoom`. "Auto" — the default — shows the whole
  // sheet only while that still reads as a page (a tablet, a desktop); on a phone
  // the box is short enough that a fitted page is a stamp, so it fills the width
  // and the box scrolls. The two fit buttons pin one or the other, and the
  // pressed one reports what the paint actually did.
  const [fit, setFit] = useState<'auto' | 'width' | 'page'>('auto');
  const [appliedFit, setAppliedFit] = useState<'width' | 'page'>('page');
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageText, setPageText] = useState<{ page: number; text: string; failed: boolean } | null>(null);
  const pageTextId = useId();
  // The reading-order overlay is an inspection tool, not a preference: it is
  // off whenever page view opens, and it is never stored.
  const [layout, setLayout] = useState(false);

  const wrap = useRef<HTMLDivElement>(null);
  /** Where the reading-order bar mounts: under the page, never over it. State,
      not a ref, because the overlay needs the element as a prop: a ref read
      during render is still null the first time the bar is asked for. */
  const [readingOrderBar, setReadingOrderBar] = useState<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderTask = useRef<{ cancel(): void; promise: Promise<unknown> } | null>(null);
  const shownPage = useRef<{ num: number; page: PDFPageProxy } | null>(null);
  const fileRef = useRef(file);
  fileRef.current = file;
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const zoomFrame = useRef(0);
  const pendingZoom = useRef<number | null>(null);

  /** The page number that is actually painted (the prop may be out of range). */
  const painted = pageCount > 0 ? clampNumber(page, 1, pageCount) : page;
  const currentPageText = pageText?.page === painted ? pageText : null;
  const visibleLayoutBlocks = layoutBlocks.filter((block) => isFiniteRect(block.box, true));
  const pageDescription =
    error && !doc
      ? 'Page text is unavailable because the PDF could not be opened.'
      : currentPageText
        ? currentPageText.failed
          ? 'Page text could not be extracted. This page may be a scan or image-only PDF.'
          : currentPageText.text || 'No readable text was found on this page. It may be a scan or image-only PDF.'
        : 'Extracting page text…';

  // Load the document once; the pages are rendered on demand below.
  useEffect(() => {
    let alive = true;
    let loadingTask: ReturnType<typeof getDocument> | null = null;
    const element = canvas.current;
    if (element) {
      element.width = 0;
      element.height = 0;
    }
    setDoc(null);
    setPageCount(0);
    setPageText(null);
    setError(null);
    setScale(0);
    setSize({ w: 0, h: 0 });
    // A book imported before an app update kept the picker's File handle, which
    // reads back as zero bytes (see `ownedCopy`). pdf.js can only answer that
    // with "The PDF file is empty, size zero bytes", which does not tell the
    // reader what to do — so say what happened instead of trying at all.
    if (fileMissing({ fileBlob: fileRef.current })) {
      setLoading(false);
      setError(MISSING_FILE_MESSAGE);
      return;
    }
    setLoading(true);
    void (async () => {
      const data = new Uint8Array(await fileRef.current.arrayBuffer());
      if (!alive) return;
      loadingTask = getDocument({ data, ...PDF_ASSETS, ...PDFJS_DOCUMENT_OPTIONS });
      const loaded = await loadingTask.promise;
      if (!alive) {
        void loadingTask.destroy();
        return;
      }
      setDoc(loaded);
      setPageCount(loaded.numPages);
      setLoading(false);
    })().catch((err: unknown) => {
      if (!alive) return;
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      alive = false;
      // Drop the bitmap and the decoded page with the view: a 2000-page book
      // should not keep a full-page canvas alive after the reader leaves.
      renderTask.current?.cancel();
      renderTask.current = null;
      if (element) {
        element.width = 0;
        element.height = 0;
      }
      const last = shownPage.current;
      shownPage.current = null;
      try {
        last?.page.cleanup();
      } catch {
        // already torn down with the document
      }
      void loadingTask?.destroy();
    };
  }, [docKey]);

  // The canvas is an image to assistive technology. Keep its label short and
  // describe it with the page's own extracted text; a scan gets an honest
  // fallback rather than a label that pretends the words are available.
  useEffect(() => {
    let cancelled = false;
    setPageText(null);
    if (!doc) return;
    const pageNumber = clampNumber(page, 1, doc.numPages);

    void (async () => {
      try {
        const pdfPage = await doc.getPage(pageNumber);
        const items: PdfRawTextItem[] = [];
        await readPdfTextItems(
          pdfPage,
          { maxItems: PDF_TEXT_MAX_ITEMS_PER_PAGE, maxChars: PDF_TEXT_MAX_CHARS_PER_PAGE, pageNumber },
          (item) => items.push(item),
        );
        if (cancelled) return;
        setPageText({ page: pdfPage.pageNumber, text: readablePageText(items), failed: false });
      } catch {
        if (cancelled) return;
        setPageText({
          page: pageNumber,
          text: 'Page text could not be extracted. This page may be a scan or image-only PDF.',
          failed: true,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, docKey, page]);

  // Free the full-page bitmap when the reader leaves. This effect has to own
  // its element: React detaches refs before passive cleanups, so looking at
  // `canvas.current` from the load effect's cleanup would find null.
  useEffect(() => {
    const element = canvas.current;
    return () => {
      if (element) {
        element.width = 0;
        element.height = 0;
      }
    };
  }, []);

  // Fit to the available width; a rotation or a side panel changes it too.
  //
  // This ran as a plain effect that measured once, and on Android the first
  // measurement could land before the reader's layout had settled, leaving the
  // page painted at a fraction of the screen until Text/Page was toggled. A
  // layout effect measures the frame that is about to be shown, the next frame
  // measures again in case the WebView was still resizing, and the observer
  // watches the wrap *and* its parent so a parent-driven resize is not missed.
  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element) return;

    const measure = () => {
      const next = element.clientWidth;
      if (next > 0) setWidth((previous) => (previous === next ? previous : next));
      // Zero in the normal layout (the wrap has no fixed height): then only the
      // width can fit the page, which is what the non-fullscreen view wants.
      const nextHeight = element.clientHeight;
      if (nextHeight > 0) setHeight((previous) => (previous === nextHeight ? previous : nextHeight));
    };

    measure();
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(measure) : 0;

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(element);
      if (element.parentElement) observer.observe(element.parentElement);
    }
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    return () => {
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  // Re-fit automatically whenever the thing being fitted changes: another book,
  // or a full-screen toggle that gives the box a different height. Zoom is
  // relative to that fit, so it starts over with it.
  useEffect(() => {
    setFit('auto');
    setZoom(1);
  }, [docKey, fullscreen]);

  // A page that fills the width is taller than its box, so the box can be
  // scrolled when the reader turns a page: the new page starts at its top (the
  // voice may move it again a frame later, below).
  useEffect(() => {
    const element = wrap.current;
    if (element) element.scrollTop = 0;
  }, [docKey, painted]);

  // Follow the voice: when the spoken sentence's first line is outside the
  // visible part of the page box, bring it into view with a margin. Only when it
  // is out of view — a line already showing is never yanked out from under a
  // hand that is panning the page.
  useEffect(() => {
    const element = wrap.current;
    // Nothing is painted yet at the initial scale of 1 and a zero-size page:
    // scrolling then would be undone by the first real fit a frame later.
    if (!element || !Number.isFinite(scale) || scale <= 0 || size.h <= 0) return;
    const first = rects.find((rect) => rect.page === painted && validOverlayRect(rect, scale));
    if (!first) return;
    const margin = Math.min(48, element.clientHeight * 0.1);
    const top = first.y * scale;
    const bottom = top + Math.max(first.h * scale, 2);
    const viewTop = element.scrollTop;
    const viewHeight = element.clientHeight;
    // A little slack either way: a line that is already showing stays where it
    // is, so a short sentence is not scrolled twice for nothing.
    if (top >= viewTop - 2 && bottom <= viewTop + viewHeight + 2) return;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = Math.max(0, top - margin);
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
    } else {
      element.scrollTop = target;
    }
  }, [rects, scale, painted, size.h]);

  // Paint the page whenever the document, page, zoom or width changes.
  useEffect(() => {
    const element = canvas.current;
    if (!doc || !element || !Number.isFinite(width) || width <= 0) return;
    let cancelled = false;
    let task: ReturnType<PDFPageProxy['render']> | null = null;

    void (async () => {
      try {
        const pdfPage = await doc.getPage(clampNumber(page, 1, doc.numPages));
        if (cancelled) return;

        // A cancelled render keeps the canvas busy until its promise settles;
        // starting the next one before that would throw.
        const previous = renderTask.current;
        if (previous) {
          try {
            await previous.promise;
          } catch {
            // a cancelled task always rejects
          }
          if (cancelled) return;
        }

        const base = getValidatedPdfViewport(pdfPage, 1);
        // Measure again at paint time: the `width` in state is what triggered
        // this run, but a box that grew since then must not be painted small.
        const measuredWidth = wrap.current?.clientWidth || width;
        const measuredHeight = wrap.current?.clientHeight || height;
        const availableWidth = Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : width;
        const availableHeight = Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 0;
        const widthFit = availableWidth / base.width;
        // "Fit page": the smaller of the two fits, so a portrait sheet is shown
        // complete inside the box. Fitting only the width is what cropped the
        // page — but the whole sheet is only worth showing while it is still a
        // readable size: a phone's box is a fraction of the page's height, and
        // there a complete sheet is a thumbnail of one. So "auto" takes the
        // sheet when it keeps ~85% of the width fit and is at least a page
        // wide, and otherwise fills the width, scrolling inside the box.
        const pageFit = availableHeight > 0 ? Math.min(widthFit, availableHeight / base.height) : widthFit;
        const pageReads = pageFit >= Math.min(widthFit * 0.85, MIN_PAGE_PX / base.width);
        const fitPage = fit === 'page' || (fit === 'auto' && (fullscreen || pageReads));
        const baseFit = fitPage ? pageFit : widthFit;
        if (!Number.isFinite(baseFit) || !(baseFit > 0)) {
          throw new Error(PDF_INVALID_VIEWPORT_MESSAGE);
        }
        // The scale-1 page passed the strict budget above. Zoom may legitimately
        // exceed it; the backing-store cap, not a CSS-size rejection, handles that.
        const viewport = getValidatedPdfViewport(pdfPage, baseFit * zoom, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE);
        const backing = canvasBackingSize(viewport.width, viewport.height, window.devicePixelRatio);
        if (!(backing.ratio > 0)) {
          throw new Error(PDF_INVALID_VIEWPORT_MESSAGE);
        }

        // Publish the geometry *before* painting, so the sentence overlay is
        // never drawn at the previous page's scale.
        setAppliedFit(fitPage ? 'page' : 'width');
        setScale(viewport.scale);
        setSize({ w: viewport.width, h: viewport.height });

        renderTask.current?.cancel();
        // Assigning the new size clears the old bitmap, but zeroing first also
        // releases it before the WebView allocates the replacement.
        element.width = 0;
        element.height = 0;
        element.width = backing.width;
        element.height = backing.height;
        const context = element.getContext('2d');
        if (!context) throw new Error('The PDF page could not open a drawing surface.');
        task = pdfPage.render({
          canvas: element,
          canvasContext: context,
          viewport,
          transform: backing.ratio === 1 ? undefined : [backing.ratio, 0, 0, backing.ratio, 0, 0],
        });
        renderTask.current = task;
        await task.promise;
        if (cancelled) return;
        setError(null);

        // Only one page's operator list is worth keeping on a phone.
        const last = shownPage.current;
        if (last && last.num !== pdfPage.pageNumber) {
          try {
            last.page.cleanup();
          } catch {
            // the page proxy may already be gone with the document
          }
        }
        shownPage.current = { num: pdfPage.pageNumber, page: pdfPage };
      } catch (err) {
        // Cancelling a render is normal when the reader turns pages quickly.
        const name = err instanceof Error ? err.name : '';
        if (cancelled || name === 'RenderingCancelledException') return;
        element.width = 0;
        element.height = 0;
        setScale(0);
        setSize({ w: 0, h: 0 });
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (task && renderTask.current === task) renderTask.current = null;
      }
    })();

    return () => {
      cancelled = true;
      renderTask.current?.cancel();
    };
  }, [doc, page, zoom, width, height, fit, fullscreen]);

  // Pinch rerenders the whole page; coalesce touchmove bursts to one per frame.
  function scheduleZoom(value: number): void {
    pendingZoom.current = value;
    if (zoomFrame.current || typeof requestAnimationFrame === 'undefined') {
      if (!zoomFrame.current) setZoom(value);
      return;
    }
    zoomFrame.current = requestAnimationFrame(() => {
      zoomFrame.current = 0;
      const next = pendingZoom.current;
      if (next !== null) setZoom(next);
    });
  }

  useEffect(() => {
    return () => {
      if (zoomFrame.current && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(zoomFrame.current);
    };
  }, []);

  // A book whose bytes are gone has nothing to paint: show the explanation on
  // its own instead of an empty page box and a dead page counter.
  if (error === MISSING_FILE_MESSAGE) {
    return (
      <div className="rd-pdf">
        <div className="banner banner-error rd-error" role="alert">
          <Glyph>{icons.alert}</Glyph>
          <div>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rd-pdf">
      <div
        className="rd-pdf-wrap"
        ref={wrap}
        onTouchStart={(event) => {
          if (event.touches.length === 2) pinch.current = { distance: touchDistance(event.touches), zoom };
        }}
        onTouchMove={(event) => {
          if (!pinch.current || event.touches.length !== 2) return;
          const factor = touchDistance(event.touches) / (pinch.current.distance || 1);
          scheduleZoom(clampNumber(pinch.current.zoom * factor, ZOOM_MIN, ZOOM_MAX));
        }}
        onTouchEnd={() => {
          pinch.current = null;
        }}
      >
        <div className="rd-pdf-page" style={{ width: size.w || undefined, height: size.h || undefined }}>
          <canvas
            ref={canvas}
            className="rd-pdf-canvas"
            role="img"
            aria-label={`Page ${painted}${pageCount ? ` of ${pageCount}` : ''}`}
            aria-describedby={pageTextId}
            style={{ width: size.w || undefined, height: size.h || undefined }}
          />
          <p id={pageTextId} className="visually-hidden">
            {pageDescription}
          </p>
          {Number.isFinite(scale) && scale > 0
            ? rects
                .filter((rect) => rect.page === painted && validOverlayRect(rect, scale))
                .map((rect, i) => (
                  <div
                    key={`${rect.page}-${i}`}
                    className="rd-pdf-rect"
                    aria-hidden="true"
                    style={{
                      left: `${rect.x * scale}px`,
                      top: `${rect.y * scale}px`,
                      width: `${Math.max(rect.w * scale, 2)}px`,
                      height: `${Math.max(rect.h * scale, 2)}px`,
                    }}
                  />
                ))
            : null}
          {Number.isFinite(scale) && scale > 0
            ? (wordRects ?? [])
                .filter((rect) => rect.page === painted && validOverlayRect(rect, scale))
                .map((rect, i) => (
                  <div
                    key={`w-${rect.page}-${i}`}
                    className="rd-pdf-word"
                    aria-hidden="true"
                    style={{
                      left: `${rect.x * scale}px`,
                      top: `${rect.y * scale}px`,
                      width: `${Math.max(rect.w * scale, 2)}px`,
                      height: `${Math.max(rect.h * scale, 2)}px`,
                    }}
                  />
                ))
            : null}
          {Number.isFinite(scale) && scale > 0 && layout && onSaveOrder ? (
            <LayoutOverlay
              blocks={visibleLayoutBlocks}
              scale={scale}
              onSave={onSaveOrder}
              panelHost={readingOrderBar}
            />
          ) : null}
        </div>
      </div>

      {/* `hidden` while the overlay is off: an empty row in the page column
          still costs the column's gap and would shorten every page. */}
      <div ref={setReadingOrderBar} hidden={!layout} />

      {error ? (
        <div className="banner banner-error rd-error" role="alert">
          <Glyph>{icons.alert}</Glyph>
          <div>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <div className="rd-pdf-controls">
        <div className="rd-pdf-nav" role="group" aria-label="Page">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Previous page"
            onClick={() => onPageChange(painted - 1)}
            disabled={pageCount === 0 || painted <= 1}
          >
            <Glyph>{icons.back}</Glyph>
          </button>
          <span className="rd-pdf-count" aria-live="polite">
            {loading ? 'Loading…' : pageCount > 0 ? `${painted} / ${pageCount}` : 'Unavailable'}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Next page"
            onClick={() => onPageChange(painted + 1)}
            disabled={pageCount === 0 || painted >= pageCount}
          >
            <Glyph>{icons.forward}</Glyph>
          </button>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={layout}
          title="Reading order"
          onClick={() => setLayout((value) => !value)}
          // Nothing to show on a page without blocks, but a toggle that is
          // already on has to stay tappable or it can never be turned off.
          disabled={pageCount === 0 || !onSaveOrder || (!layout && visibleLayoutBlocks.length === 0)}
        >
          Layout
        </button>
        <div className="rd-pdf-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Zoom out"
            disabled={pageCount === 0 || zoom <= ZOOM_MIN}
            onClick={() => setZoom((value) => clampNumber(value - 0.2, ZOOM_MIN, ZOOM_MAX))}
          >
            <Glyph>{icons.zoomOut}</Glyph>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Zoom in"
            disabled={pageCount === 0 || zoom >= ZOOM_MAX}
            onClick={() => setZoom((value) => clampNumber(value + 0.2, ZOOM_MIN, ZOOM_MAX))}
          >
            <Glyph>{icons.zoomIn}</Glyph>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Fit width"
            title="Fit width"
            disabled={pageCount === 0}
            aria-pressed={appliedFit === 'width'}
            onClick={() => {
              setFit('width');
              setZoom(1);
            }}
          >
            <Glyph>{icons.fitWidth}</Glyph>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Fit page"
            title="Fit page"
            disabled={pageCount === 0}
            aria-pressed={appliedFit === 'page'}
            onClick={() => {
              setFit('page');
              setZoom(1);
            }}
          >
            <Glyph>{icons.page}</Glyph>
          </button>
        </div>
      </div>
    </div>
  );
}
