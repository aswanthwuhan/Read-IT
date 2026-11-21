import type { Chapter, DocFormat, ParsedDoc } from '../core/types';
import { buildChapters, chapterFromSeeds, normaliseText, type BlockSeed } from './blocks';

/**
 * Shared HTML walker. Used for `.html` files, Readability articles, mammoth
 * DOCX output and EPUB spine documents, so all of them produce the same
 * block/sentence model.
 */

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK', 'TEMPLATE',
  'NAV', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SVG',
]);

const EPUB_OPS_NS = 'http://www.idpf.org/2007/ops';
const NOTE_TYPES = new Set(['footnote', 'endnote', 'rearnote']);

/**
 * `epub:type` is a space-separated list of semantics. In an XHTML spine file the
 * attribute is namespaced, so read both the qualified and the namespaced form.
 */
function epubTypes(el: Element): string[] {
  const raw = el.getAttribute('epub:type') ?? el.getAttributeNS(EPUB_OPS_NS, 'type') ?? '';
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * XHTML is parsed as XML by epub.js, where `tagName` keeps the source's lower
 * case, while an HTML document reports upper case. Comparing upper-cased local
 * names is the only form that works for both.
 */
function tagOf(el: Element): string {
  return (el.localName || el.tagName).toUpperCase();
}

/**
 * A note aside is the note's own text ("¹ Smith 2019, p. 4"). It belongs to the
 * page but not inside the sentence that references it, so it becomes a footnote
 * block and stays out of the paragraph text.
 */
function isNoteAside(el: Element): boolean {
  return tagOf(el) === 'ASIDE' && epubTypes(el).some((type) => NOTE_TYPES.has(type));
}

const TEXT_BLOCK_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'PRE', 'DT', 'DD', 'CAPTION']);

function headingLevel(tag: string): number {
  const match = /^H([1-6])$/.exec(tag);
  return match ? Number(match[1]) : 0;
}

function isBlockTag(tag: string): boolean {
  return headingLevel(tag) > 0 || TEXT_BLOCK_TAGS.has(tag) || tag === 'TABLE' || tag === 'FIGURE';
}

function isHidden(el: Element): boolean {
  return el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true';
}

/**
 * Project Gutenberg and most book CSS keep the short heading a paragraph used to
 * carry in the margin in `div.sidenote`/`div.marginnote`. Read in flow they turn
 * into fragments ("Light.") in front of the sentence they label, so drop them.
 */
function isMarginalNote(el: Element): boolean {
  const name = el.getAttribute('class') ?? '';
  return /(?:^|\s)(?:sidenote|marginnote)(?:\s|$)/.test(name);
}

/** Walk a DOM subtree and flatten it into ordered block seeds. */
export function blocksFromRoot(root: Element): BlockSeed[] {
  const seeds: BlockSeed[] = [];
  walk(root, seeds);
  return seeds;
}

function walk(el: Element, out: BlockSeed[]): void {
  // A container can hold both bare text ("Hello") and blocks (<p>World</p>).
  // Iterating only `children` loses the bare text, so walk child *nodes* and
  // accumulate inline text until a block boundary flushes it into a paragraph.
  let inline = '';
  const flushInline = () => {
    const text = normaliseText(inline);
    inline = '';
    if (text) out.push({ kind: 'p', text });
  };

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      // Text node: keep it in order with the blocks around it.
      inline += child.textContent ?? '';
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as Element;

    // Footnotes used to vanish with the whole <aside>. Keep the note as a
    // footnote block (visible, skipped while reading unless that switch is on);
    // any other aside is a sidebar and stays out of the flow, as before.
    if (tagOf(element) === 'ASIDE') {
      flushInline();
      if (isNoteAside(element)) out.push({ kind: 'footnote', text: textOf(element) });
      continue;
    }

    if (SKIP_TAGS.has(tagOf(element)) || isHidden(element) || isMarginalNote(element)) continue;

    const level = headingLevel(tagOf(element));
    if (level > 0) {
      flushInline();
      out.push({ kind: 'h', level, text: textOf(element) });
      continue;
    }
    if (tagOf(element) === 'TABLE') {
      flushInline();
      out.push({ kind: 'table', text: tableText(element) });
      continue;
    }
    if (tagOf(element) === 'FIGURE') {
      flushInline();
      out.push({ kind: 'figure', text: figureText(element) });
      continue;
    }
    if (TEXT_BLOCK_TAGS.has(tagOf(element))) {
      flushInline();
      out.push({ kind: tagOf(element) === 'LI' ? 'li' : 'p', text: textOf(element) });
      continue;
    }

    if (containsBlock(element)) {
      flushInline();
      walk(element, out);
    } else {
      // An inline-only child (span, b, a bare div) joins the current paragraph
      // instead of becoming a block of its own mid-sentence.
      inline += textOf(element);
    }
  }
  flushInline();
}

function containsBlock(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (isBlockTag(tagOf(child))) return true;
    if (containsBlock(child)) return true;
  }
  return false;
}

function textOf(el: Element): string {
  // A line break separates words; without this the two sides glue together.
  if (tagOf(el) === 'BR') return ' ';
  const parts: string[] = [];
  collectText(el, parts);
  return normaliseText(parts.join(''));
}

/**
 * Text of one block, minus marginal notes. Gutenberg also puts them inline
 * (`<span class="sidenote">Beef tea.</span>One is …`), where `textContent` would
 * splice the note into the sentence it labels.
 */
function collectText(node: Node, out: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out.push((child as CharacterData).data);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    // Any aside stays out of a paragraph's text: a note becomes its own block,
    // and a sidebar is dropped exactly as before.
    if (tagOf(element) === 'ASIDE') continue;
    if (SKIP_TAGS.has(tagOf(element)) || isHidden(element)) continue;
    if (isMarginalNote(element)) {
      out.push(' ');
      continue;
    }
    if (tagOf(element) === 'BR') {
      out.push(' ');
      continue;
    }
    collectText(element, out);
  }
}

function tableText(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (!rows.length) return textOf(table);

  return rows
    .map((row) =>
      Array.from(row.querySelectorAll('th,td'))
        .map(textOf)
        .filter(Boolean)
        .join(', '),
    )
    .filter(Boolean)
    .join('. ');
}

function figureText(figure: Element): string {
  const caption = figure.querySelector('figcaption');
  const captionText = caption ? textOf(caption) : '';
  if (captionText) return captionText;

  const image = figure.querySelector('img[alt]');
  const alt = image?.getAttribute('alt') ?? '';
  return normaliseText(alt) || textOf(figure);
}

export interface HtmlParseMeta {
  format: DocFormat;
  title?: string;
  author?: string;
  /** Headings at or above this level start a chapter. Default 2 (h1/h2). */
  chapterLevel?: number;
}

export function parseHtmlDocument(doc: Document, meta: HtmlParseMeta): ParsedDoc {
  const root = doc.body ?? doc.documentElement;
  const seeds = root ? blocksFromRoot(root) : [];

  const title =
    normaliseText(meta.title ?? '') ||
    normaliseText(doc.title) ||
    seeds.find((seed) => seed.kind === 'h')?.text ||
    'Untitled';

  return {
    title,
    author: meta.author ? normaliseText(meta.author) || undefined : undefined,
    format: meta.format,
    chapters: buildChapters(seeds, title, meta.chapterLevel ?? 2),
  };
}

/**
 * One chapter from one EPUB spine document. The first heading is dropped when it
 * just repeats the chapter title taken from the TOC.
 */
export function chapterFromSpine(title: string, seeds: BlockSeed[], chapterIdx: number): Chapter | null {
  const first = seeds[0];
  const body =
    first?.kind === 'h' && normaliseText(first.text) === normaliseText(title) ? seeds.slice(1) : seeds;
  return chapterFromSeeds(title, chapterIdx, body);
}
