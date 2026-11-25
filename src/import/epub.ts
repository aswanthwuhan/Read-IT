import ePub from 'epubjs';
import type { NavItem } from 'epubjs';
import type { Chapter, ParsedDoc } from '../core/types';
import { normaliseText, type BlockSeed } from './blocks';
import { parseNavDocument, parseNcx, type OutlineEntry } from './epub/nav';
import { blocksFromRoot, chapterFromSpine } from './html';
import {
  EPUB_IMPORT_MAX_BYTES,
  EPUB_MAX_CHAPTER_BYTES,
  EPUB_MAX_HREF_LENGTH,
  EPUB_MAX_SPINE_ENTRIES,
  EPUB_TEXT_MAX_BYTES,
} from './limits';
import { assertEntries, assertSafeName } from './zipLimits';
import { validateZipInWorker } from './zipValidate';

/** The bits of an epubjs Section this module uses (the package has no exported type). */
interface SpineSection {
  href: string;
  unload?: () => void;
}

/**
 * Each spine item becomes a chapter, titled from the navigation document when it
 * lists that file. Per-sentence CFIs are not recorded: the walker drops element
 * references, so a page anchor could only point at the whole spine item.
 */
export async function parseEpub(
  data: ArrayBuffer,
  fallbackTitle: string,
  signal?: AbortSignal,
): Promise<ParsedDoc> {
  throwIfAborted(signal);
  if (data.byteLength > EPUB_IMPORT_MAX_BYTES) {
    throw new Error('That EPUB is too large to import (over 100 MB).');
  }

  // Validate every central-directory entry and its actual inflated output before
  // epubjs/JSZip can allocate a DOM. The worker transfers the buffer and returns
  // it; epubjs must open that returned buffer, not the now-detached original.
  const validated = await validateZipInWorker(data, signal);
  throwIfAborted(signal);

  // An archived Book reads local assets through its Archive, so denying the
  // network request hook does not block in-zip images or fonts. Disabling URL
  // replacement also avoids eagerly inflating every manifest asset just to make
  // object URLs this text-only import never renders.
  const book = ePub({
    replacements: 'none',
    requestMethod: rejectNetworkResource,
  });
  const sections: SpineSection[] = [];
  const unloaded = new Set<SpineSection>();
  const unload = (section: SpineSection) => {
    if (unloaded.has(section)) return;
    unloaded.add(section);
    try {
      section.unload?.();
    } catch {
      // Cleanup is best-effort; never replace the parse/abort error.
    }
  };

  try {
    // epubjs 0.3.93's ESM entry (the one bundlers pick) only builds the Book; its
    // UMD bundle is the one that opens by itself. Without this `book.ready` never
    // settles and an EPUB import would sit there forever.
    await waitFor(book.open(validated, 'binary'), signal);
    await waitFor(book.ready, signal);
    throwIfAborted(signal);

    // The worker checked the raw directory. Recheck epubjs's indexed view before
    // loading navigation or spine documents as defence in depth for adapters and
    // malformed archives that a ZIP implementation may normalise differently.
    const zipFiles = (book as unknown as { archive?: { zip?: { files?: Record<string, { _data?: { uncompressedSize?: unknown } }> } } })
      .archive?.zip?.files;
    if (zipFiles) {
      assertEntries(
        Object.entries(zipFiles).map(([name, entry]) => {
          const size = entry?._data?.uncompressedSize;
          return { name, size: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : undefined };
        }),
      );
    }

    const meta = await waitFor(book.loaded.metadata, signal);
    throwIfAborted(signal);
    const title = normaliseText(meta.title) || normaliseText(fallbackTitle) || 'Untitled EPUB';
    const author = normaliseText(meta.creator) || undefined;

    // An OPF can repeat one tiny manifest item thousands of times. Bound and
    // validate the complete work list before asking epubjs to load any chapter.
    const spineLength = (book.spine as unknown as { length?: unknown }).length;
    if (typeof spineLength === 'number' && spineLength > EPUB_MAX_SPINE_ENTRIES) {
      throw new Error('That EPUB has too many spine entries to import safely.');
    }
    book.spine.each((section: SpineSection) => {
      if (sections.length >= EPUB_MAX_SPINE_ENTRIES) {
        throw new Error('That EPUB has too many spine entries to import safely.');
      }
      sections.push(section);
    });
    for (const section of sections) {
      if (section.href) assertSpineHref(section.href);
    }

    const tocTitles = await navTitles(book, signal);
    throwIfAborted(signal);
    const chapters: Chapter[] = [];
    const warnings: string[] = [];
    // A Gutenberg EPUB splits its body into files by size, not at chapter breaks:
    // a file can open in the middle of one chapter and then hold two headings.
    // Collect every spine document first and split the book at its headings, so a
    // file's opening text stays with the chapter it belongs to instead of becoming
    // a chapter of its own that repeats the next chapter's title.
    const spineSeeds: BlockSeed[][] = [];
    const spineLabels: string[] = [];
    let totalTextBytes = 0;
    for (const section of sections) {
      throwIfAborted(signal);
      const href = section.href;
      if (!href) continue;

      // A single highly compressible chapter can otherwise expand into a huge
      // string and DOM before the decoded-text budget below gets a chance to run.
      const uncompressed = entryUncompressedBytes(zipFiles, href);
      if (uncompressed !== undefined && uncompressed > EPUB_MAX_CHAPTER_BYTES) {
        throw new Error('That EPUB contains a chapter that is too large to import safely.');
      }

      let chapterDoc: Document;
      try {
        chapterDoc = (await waitFor(book.load(href), signal)) as Document;
      } catch (error) {
        throwIfAborted(signal);
        unload(section);
        warnings.push(`A chapter file ("${href}") could not be read`);
        continue;
      }
      throwIfAborted(signal);
      if (!chapterDoc?.body) {
        unload(section);
        warnings.push(`A chapter file ("${href}") had no readable content`);
        continue;
      }

      // Count the decoded text as UTF-8, not UTF-16 code units: multibyte prose
      // must consume the same byte budget regardless of the source encoding.
      totalTextBytes += utf8ByteLength(chapterDoc.body.textContent ?? '');
      if (totalTextBytes > EPUB_TEXT_MAX_BYTES) {
        throw new Error('That EPUB is too large to import (over 500 MB of text).');
      }
      spineSeeds.push(blocksFromRoot(chapterDoc.body));
      spineLabels.push(tocTitles.get(baseHref(href)) ?? tocTitles.get(basename(href)) ?? '');
      unload(section);
      throwIfAborted(signal);
    }

    const hasHeadings = spineSeeds.some((seeds) => seeds.some((seed) => seed.kind === 'h' && (seed.level ?? 0) <= 2));
    // Ids must stay unique when a part yields no chapter (e.g. a heading-only
    // spine file), so advance a counter on every attempt, not on pushes.
    let nextId = 0;
    if (hasHeadings) {
      for (const part of splitAtHeadings(spineSeeds.flat(), title)) {
        const chapter = chapterFromSpine(part.title, part.seeds, nextId++);
        if (chapter) chapters.push(chapter);
      }
    } else {
      // No usable headings in the text: one chapter per spine file, named by the TOC.
      for (const [index, seeds] of spineSeeds.entries()) {
        const label = spineLabels[index] || `Chapter ${nextId + 1}`;
        const chapter = chapterFromSpine(label, seeds, nextId++);
        if (chapter) chapters.push(chapter);
      }
    }
    throwIfAborted(signal);

    return {
      title,
      author,
      format: 'epub',
      chapters,
      warning: warnings.length > 0 ? `Some chapter files in this EPUB could not be read: ${warnings.join('; ')}` : undefined,
    };
  } finally {
    for (const section of sections) unload(section);
    try {
      book.destroy();
    } catch {
      // Preserve the original parse/abort error if teardown itself fails.
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
}

type EpubZipFiles = Record<string, { _data?: { uncompressedSize?: unknown } }> | undefined;

/** Best-effort JSZip metadata lookup before epubjs decompresses a spine document. */
function entryUncompressedBytes(files: EpubZipFiles, href: string): number | undefined {
  if (!files) return undefined;
  const relative = href.replace(/^\//, '');
  const candidates = [href, relative, `OPS/${relative}`, `OEBPS/${relative}`];
  for (const name of candidates) {
    const size = files[name]?._data?.uncompressedSize;
    if (typeof size === 'number' && Number.isFinite(size) && size >= 0) return size;
  }
  return undefined;
}

/** Race an epubjs promise against cancellation without leaving abort listeners behind. */
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(new DOMException('The import was cancelled.', 'AbortError')));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (signal.aborted) onAbort();
        else finish(() => resolve(value));
      },
      (error: unknown) => finish(() => reject(error)),
    );
    // Covers an abort between the initial check and listener registration.
    if (signal.aborted) onAbort();
  });
}

/** Reject schemes, encoded traversal and control characters before path resolution. */
function assertSpineHref(href: string): void {
  if (href.length > EPUB_MAX_HREF_LENGTH) {
    throw new Error('That EPUB contains a chapter path that is too long.');
  }
  const path = href.split('#', 1)[0] ?? '';
  if (!path) return;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error("That book's archive contains an unsafe file path.");
  }
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(decoded) || /[\u0000-\u001f\u007f]/.test(decoded)) {
    throw new Error("That book's archive contains an unsafe file path.");
  }
  assertSafeName(decoded);
}

/** UTF-8 byte length without allocating an encoded copy of a potentially huge chapter. */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && at + 1 < text.length) {
      const next = text.charCodeAt(at + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        at++;
      } else {
        // TextEncoder replaces an unpaired surrogate with U+FFFD (three bytes).
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function rejectNetworkResource(): Promise<never> {
  return Promise.reject(new Error('Network resources are not available during EPUB import.'));
}

/**
 * Split a book's blocks at its chapter headings. The text before the first one
 * (title page, preface) becomes a chapter of its own named after the book.
 */
function splitAtHeadings(seeds: BlockSeed[], label: string): { title: string; seeds: BlockSeed[] }[] {
  const parts: { title: string; seeds: BlockSeed[] }[] = [];
  let current: BlockSeed[] = [];
  let title = label;

  const flush = () => {
    if (current.length) parts.push({ title, seeds: current });
    current = [];
  };

  for (const seed of seeds) {
    const heading = seed.kind === 'h' && (seed.level ?? 0) <= 2;
    if (heading) {
      // A heading is the chapter title, never a spoken body block. This also
      // handles a heading-only run ("Chapter 1" then "Introduction") without
      // flushing the heading into the previous chapter as text.
      flush();
      title = normaliseText(seed.text) || label;
      continue;
    }
    current.push(seed);
  }
  flush();

  return parts.length ? parts : [{ title: label, seeds }];
}

/**
 * Read the nav document / NCX ourselves rather than trusting epubjs's outline:
 * 0.3 drops some real-world entries, and these labels are the only titles an
 * unheaded spine file ever gets. The files are already in the archive epubjs
 * opened, so `book.load` hands back their parsed DOM. epubjs's own toc stays as
 * the safety net for nav shapes this reader does not recognise.
 */
async function navTitles(book: ReturnType<typeof ePub>, signal?: AbortSignal): Promise<Map<string, string>> {
  const packaging = book.packaging;
  const sources: { path?: string; parse: (doc: Document) => OutlineEntry[] }[] = [
    { path: packaging?.navPath, parse: parseNavDocument },
    { path: packaging?.ncxPath, parse: parseNcx },
  ];
  const map = new Map<string, string>();
  for (const { path, parse } of sources) {
    if (!path) continue;
    try {
      throwIfAborted(signal);
      // Only toc entries name spine files. Page lists and landmarks point at the
      // same documents with labels like "5" or "Start", which would mislabel a
      // chapter if they claimed a base name before the toc did.
      const entries = parse((await waitFor(book.load(path), signal)) as Document).filter((entry) => entry.kind === 'toc');
      titlesFromOutline(map, entries);
    } catch {
      throwIfAborted(signal);
      // An unreadable nav file is not fatal: the spine can still be read, and
      // the fallback below may recover its titles from epubjs.
    }
  }
  if (map.size) return map;

  const navigation = await waitFor(book.loaded.navigation.catch(() => null), signal);
  throwIfAborted(signal);
  return titlesByHref(navigation?.toc ?? []);
}

function titlesFromOutline(map: Map<string, string>, entries: OutlineEntry[]): void {
  for (const entry of entries) {
    addTitle(map, entry.href, entry.title);
    if (entry.children?.length) titlesFromOutline(map, entry.children);
  }
}

function titlesByHref(items: NavItem[]): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (list: NavItem[]) => {
    for (const item of list) {
      addTitle(map, item.href, item.label);
      if (item.subitems?.length) visit(item.subitems);
    }
  };
  visit(items);
  return map;
}

/** Index both the whole href and its base name, as spine hrefs carry OPF paths. */
function addTitle(map: Map<string, string>, href: string, label: string): void {
  const base = baseHref(href);
  const text = normaliseText(label);
  if (!base || !text) return;
  if (!map.has(base)) map.set(base, text);
  const name = basename(base);
  if (name && !map.has(name)) map.set(name, text);
}

function baseHref(href: string): string {
  return (href.split('#')[0] ?? '').replace(/^\.\//, '');
}

function basename(href: string): string {
  return baseHref(href).split('/').pop() ?? '';
}
