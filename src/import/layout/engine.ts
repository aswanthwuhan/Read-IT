/**
 * Pure pieces of the layout model: class labels, label → block kind, image →
 * tensor, and detections → page boxes. Kept free of ONNX Runtime (and of the
 * download bookkeeping) so they are unit-testable and so the worker only has to
 * own the session.
 */
import type { Block } from '../../core/types';

/** Output class order of PP-DocLayout-L, from the export's `labels.json`. */
export const LABELS = [
  'paragraph_title',
  'image',
  'text',
  'number',
  'abstract',
  'content',
  'figure_title',
  'formula',
  'table',
  'table_title',
  'reference',
  'doc_title',
  'footnote',
  'header',
  'algorithm',
  'footer',
  'seal',
  'chart_title',
  'chart',
  'formula_number',
  'header_image',
  'footer_image',
  'aside_text',
] as const;

export interface LayoutBox {
  /** PDF scale-1 page coordinates, top-left origin. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  score: number;
}

/** A model page cannot usefully contain more regions than this. */
export const MAX_LAYOUT_BOXES = 256;

/** Validate worker/model output before it reaches assignment or persistence. */
export function isValidLayoutBox(value: unknown, pageWidth?: number, pageHeight?: number): value is LayoutBox {
  if (!value || typeof value !== 'object') return false;
  const box = value as Partial<LayoutBox>;
  if (
    typeof box.label !== 'string' ||
    !box.label ||
    !Number.isFinite(box.score) ||
    !(box.score! >= 0) ||
    !(box.score! <= 1) ||
    !isFiniteBox(box)
  ) {
    return false;
  }
  if (pageWidth !== undefined || pageHeight !== undefined) {
    if (
      pageWidth === undefined ||
      pageHeight === undefined ||
      !Number.isFinite(pageWidth) ||
      !Number.isFinite(pageHeight) ||
      !(pageWidth > 0) ||
      !(pageHeight > 0)
    ) {
      return false;
    }
    // Decoding clamps to the page. Allow a little rounding slack for a custom
    // detector, but not coordinates far outside the sheet.
    const slackX = Math.max(1, pageWidth * 0.01);
    const slackY = Math.max(1, pageHeight * 0.01);
    if (
      box.x! < -slackX ||
      box.y! < -slackY ||
      box.x! + box.w! > pageWidth + slackX ||
      box.y! + box.h! > pageHeight + slackY
    ) {
      return false;
    }
  }
  return true;
}

function isFiniteBox(box: Partial<LayoutBox>): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.w) &&
    Number.isFinite(box.h) &&
    box.w! > 0 &&
    box.h! > 0 &&
    Number.isFinite(box.x! + box.w!) &&
    Number.isFinite(box.y! + box.h!)
  );
}

/**
 * Which reading block a detected region is. In PP-DocLayout's vocabulary a
 * `figure_title`/`table_title`/`chart_title` *is* the caption under the figure,
 * so those become `caption`, not headings; `doc_title`/`paragraph_title` are the
 * headings. Anything unknown is null: its lines fall through to the nearest
 * region (a seal or a logo holds no reading text anyway).
 */
export function regionKind(label: string): Block['kind'] | null {
  switch (label) {
    case 'doc_title':
    case 'paragraph_title':
      return 'h';
    case 'figure_title':
    case 'table_title':
    case 'chart_title':
      return 'caption';
    case 'table':
      return 'table';
    case 'image':
    case 'chart':
    case 'seal':
    case 'header_image':
    case 'footer_image':
      return 'figure';
    case 'formula':
      return 'formula';
    case 'header':
      return 'header';
    case 'footer':
    case 'number':
      return 'footer';
    case 'footnote':
      return 'footnote';
    case 'reference':
      return 'reference';
    case 'algorithm':
      return 'code';
    case 'text':
    case 'content':
    case 'abstract':
    case 'aside_text':
      return 'p';
    default:
      return null;
  }
}

/**
 * `[N,6]` detections → page boxes. The graph applies the sigmoid itself, so the
 * rows already hold probabilities and 640×640 pixel coordinates:
 * `[classId, score, x1, y1, x2, y2]`.
 */
export function decodeDetections(
  rows: Float32Array,
  pageWidth: number,
  pageHeight: number,
  inputSize: number,
  threshold: number,
  maxBoxes = MAX_LAYOUT_BOXES,
): LayoutBox[] {
  const boxes: LayoutBox[] = [];
  if (
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    !Number.isFinite(inputSize) ||
    !Number.isFinite(threshold) ||
    !(pageWidth > 0) ||
    !(pageHeight > 0) ||
    !(inputSize > 0) ||
    !Number.isFinite(pageWidth * pageHeight)
  ) {
    return boxes;
  }
  const limit = Number.isFinite(maxBoxes) ? Math.max(0, Math.floor(maxBoxes)) : MAX_LAYOUT_BOXES;

  for (let index = 0; index + 5 < rows.length; index += 6) {
    if (boxes.length >= limit) break;
    const classId = rows[index];
    const score = rows[index + 1];
    if (!Number.isInteger(classId) || !Number.isFinite(score) || !(score >= threshold)) continue;

    const label = LABELS[classId];
    if (!label) continue;

    const x1 = rows[index + 2];
    const y1 = rows[index + 3];
    const x2 = rows[index + 4];
    const y2 = rows[index + 5];
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const x = Math.max(0, Math.min(x1, x2)) / inputSize;
    const y = Math.max(0, Math.min(y1, y2)) / inputSize;
    const w = Math.min(Math.abs(x2 - x1) / inputSize, 1 - x);
    const h = Math.min(Math.abs(y2 - y1) / inputSize, 1 - y);
    if (w <= 0 || h <= 0) continue;

    const box: LayoutBox = {
      x: x * pageWidth,
      y: y * pageHeight,
      w: w * pageWidth,
      h: h * pageHeight,
      label,
      score,
    };
    if (isValidLayoutBox(box, pageWidth, pageHeight)) boxes.push(box);
  }

  return boxes;
}

/**
 * RGBA page pixels → NCHW RGB floats in `[0,1]`. The model's transform is a
 * plain resize and `/255` (no mean/std), so this is the whole pre-processing.
 */
export function packInput(rgba: Uint8ClampedArray | Uint8Array, size: number): Float32Array {
  const plane = size * size;
  const out = new Float32Array(plane * 3);

  for (let pixel = 0; pixel < plane; pixel++) {
    const from = pixel * 4;
    out[pixel] = rgba[from] / 255;
    out[plane + pixel] = rgba[from + 1] / 255;
    out[2 * plane + pixel] = rgba[from + 2] / 255;
  }

  return out;
}

/**
 * The model can report the same area twice under different labels (a `chart`
 * and an `image` over one figure); keeping only the best-scoring box per area
 * stops the text from being pulled into two regions.
 */
export function dedupeBoxes(boxes: LayoutBox[], overlap = 0.6, maxBoxes = MAX_LAYOUT_BOXES): LayoutBox[] {
  const kept: LayoutBox[] = [];
  const threshold = Number.isFinite(overlap) ? overlap : 0.6;
  const limit = Number.isFinite(maxBoxes) ? Math.max(0, Math.floor(maxBoxes)) : MAX_LAYOUT_BOXES;

  for (const box of boxes.filter((box) => isValidLayoutBox(box)).sort((a, b) => b.score - a.score)) {
    if (kept.length >= limit) break;
    if (kept.some((other) => iou(box, other) >= threshold)) continue;
    kept.push(box);
  }

  return kept;
}

function iou(a: LayoutBox, b: LayoutBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (overlap <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - overlap;
  return union > 0 ? overlap / union : 0;
}
