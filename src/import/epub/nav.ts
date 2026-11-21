import { normaliseText } from '../blocks';

/** The three navigation lists EPUB 3 defines for a navigation document. */
export type OutlineKind = 'toc' | 'page-list' | 'landmarks';

/**
 * A single navigation target. `depth` is the nesting level in the source list
 * (top level is 0), so a reader can indent the outline without re-walking it.
 */
export interface OutlineEntry {
  title: string;
  href: string;
  depth: number;
  kind: OutlineKind;
  children: OutlineEntry[];
}

const EPUB_OPS_NS = 'http://www.idpf.org/2007/ops';

/**
 * `epub:type` is a space-separated list of semantics. A nav document parsed as
 * XML keeps the attribute namespaced, and the prefix is author-chosen, so read
 * both the qualified form and the namespace form.
 */
function epubTypes(el: Element): string[] {
  const raw = el.getAttribute('epub:type') ?? el.getAttributeNS(EPUB_OPS_NS, 'type') ?? '';
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * XHTML read as XML preserves the source case while an HTML parse reports upper
 * case; comparing upper-cased local names works for both, and ignores prefixes.
 */
function localName(el: Element): string {
  return (el.localName || el.tagName).toUpperCase();
}

function childElements(el: Element, name: string): Element[] {
  const found: Element[] = [];
  for (const child of Array.from(el.children)) {
    if (localName(child) === name) found.push(child);
  }
  return found;
}

/** Depth-first search in document order; a missing subtree is simply not found. */
function findFirst(el: Element, name: string): Element | null {
  if (localName(el) === name) return el;
  for (const child of Array.from(el.children)) {
    const found = findFirst(child, name);
    if (found) return found;
  }
  return null;
}

/** Every matching element in document order, used because a nav may sit anywhere. */
function collectElements(el: Element, name: string): Element[] {
  const found: Element[] = [];
  if (localName(el) === name) found.push(el);
  for (const child of Array.from(el.children)) {
    found.push(...collectElements(child, name));
  }
  return found;
}

/**
 * The link that labels its own <li>. A nested <ol> belongs to the next depth,
 * so its anchors must not be mistaken for this entry's link.
 */
function ownAnchor(li: Element): Element | null {
  for (const child of Array.from(li.children)) {
    const name = localName(child);
    if (name === 'OL') continue;
    if (name === 'A') return child;
    const nested = ownAnchor(child);
    if (nested) return nested;
  }
  return null;
}

interface Link {
  title: string;
  href: string;
}

/** Returns null when a list item has no usable target, per the import rules. */
function readLink(li: Element): Link | null {
  const anchor = ownAnchor(li);
  if (!anchor) return null;
  // Relative hrefs are left untouched here; the spine layer resolves them.
  const href = (anchor.getAttribute('href') ?? '').trim();
  const title = normaliseText(anchor.textContent ?? '');
  if (!href || !title) return null;
  return { title, href };
}

/**
 * Parse an <ol> into nested entries. An item without a usable link is dropped,
 * but its descendants are hoisted so a bare group heading cannot hide chapters.
 */
function parseList(list: Element, kind: OutlineKind, depth: number): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const li of childElements(list, 'LI')) {
    const link = readLink(li);
    const nested = findFirst(li, 'OL');
    const children = nested ? parseList(nested, kind, depth + 1) : [];

    if (link) {
      entries.push({ title: link.title, href: link.href, depth, kind, children });
    } else {
      entries.push(...children);
    }
  }
  return entries;
}

/**
 * Page lists are navigation by printed page number; nesting carries no meaning,
 * so flatten every list item to depth 0.
 */
function parseFlat(nav: Element, kind: OutlineKind): OutlineEntry[] {
  const list = findFirst(nav, 'OL');
  if (!list) return [];

  const entries: OutlineEntry[] = [];
  const visit = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      const name = localName(child);
      if (name === 'LI') {
        const link = readLink(child);
        if (link) {
          entries.push({ title: link.title, href: link.href, depth: 0, kind, children: [] });
        }
        // Keep walking: a nested page list is still a flat list of pages.
        visit(child);
      } else if (name === 'OL') {
        visit(child);
      }
    }
  };
  visit(list);
  return entries;
}

/**
 * EPUB 3 navigation document. The toc nav is the outline; page-list and
 * landmarks navs are returned beside it, in document order.
 */
export function parseNavDocument(doc: Document): OutlineEntry[] {
  const root = doc.documentElement;
  if (!root) return [];

  const navs = collectElements(root, 'NAV');
  if (navs.length === 0) return [];

  const isSpecial = (nav: Element): boolean => {
    const types = epubTypes(nav);
    return types.includes('page-list') || types.includes('landmarks');
  };

  // Older nav documents omit the epub:type on their main nav, so fall back to
  // the first untyped nav that actually contains a list.
  const tocNav =
    navs.find((nav) => epubTypes(nav).includes('toc')) ??
    navs.find((nav) => !isSpecial(nav) && findFirst(nav, 'OL') !== null);

  const entries: OutlineEntry[] = [];
  for (const nav of navs) {
    const types = epubTypes(nav);
    if (nav === tocNav) {
      const list = findFirst(nav, 'OL');
      if (list) entries.push(...parseList(list, 'toc', 0));
    } else if (types.includes('page-list')) {
      entries.push(...parseFlat(nav, 'page-list'));
    } else if (types.includes('landmarks')) {
      const list = findFirst(nav, 'OL');
      if (list) entries.push(...parseList(list, 'landmarks', 0));
    }
  }
  return entries;
}

/** Recursive navPoint walker; depth is the nesting level of each navPoint. */
function parseNavPoints(parent: Element, depth: number): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const navPoint of childElements(parent, 'NAVPOINT')) {
    const label = childElements(navPoint, 'NAVLABEL')[0];
    const text = label ? findFirst(label, 'TEXT') : null;
    const title = text ? normaliseText(text.textContent ?? '') : '';
    // Only a direct content child belongs to this navPoint; a nested navPoint
    // has its own content element.
    const content = childElements(navPoint, 'CONTENT')[0];
    const href = (content?.getAttribute('src') ?? '').trim();
    const children = parseNavPoints(navPoint, depth + 1);

    if (href) {
      entries.push({ title, href, depth, kind: 'toc', children });
    } else {
      // Same tolerance as the EPUB 3 walker: keep reachable descendants.
      entries.push(...children);
    }
  }
  return entries;
}

/** EPUB 2 NCX table of contents, always returned as a toc outline. */
export function parseNcx(doc: Document): OutlineEntry[] {
  const root = doc.documentElement;
  if (!root) return [];

  const navMap = findFirst(root, 'NAVMAP');
  if (!navMap) return [];

  return parseNavPoints(navMap, 0);
}
