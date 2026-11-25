/**
 * App-level size caps for the archive and article import paths. epubjs unzips
 * the book and pdf.js decompresses its streams into memory on their own, so a
 * hostile or corrupt file can expand to gigabytes of memory before any of the
 * app's parsing runs. These caps reject inputs above them with a plain message
 * instead of letting the parser eat memory until it dies. The backup caps in
 * `src/backup/backup.ts` are much stronger and stay as they are.
 */

import { isIos } from '../core/platform';
import type { DocFormat } from '../core/types';

/** An imported EPUB: the zip file as stored. */
export const EPUB_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
/** An imported DOCX: the zip file as stored. */
export const DOCX_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
/** Total text across an EPUB's spine files, counted as UTF-8 bytes while parsing. */
export const EPUB_TEXT_MAX_BYTES = 500 * 1024 * 1024;
/** One spine document is materialised as a string and DOM before its text is counted. */
export const EPUB_MAX_CHAPTER_BYTES = 32 * 1024 * 1024;
/** A hostile OPF can repeat one small spine file indefinitely; cap the work list. */
export const EPUB_MAX_SPINE_ENTRIES = 10_000;
/** Bound path resolution and lookup work for a single manifest/spine href. */
export const EPUB_MAX_HREF_LENGTH = 4_096;
/** An imported PDF: the file as stored. */
export const PDF_IMPORT_MAX_BYTES = 200 * 1024 * 1024;
/** Upper bound on a PDF's page count, so bulk expansions stay bounded. */
export const PDF_MAX_PAGES = 10_000;
/** HTML fetched for a web-article import. */
export const ARTICLE_HTML_MAX_BYTES = 50 * 1024 * 1024;
/** A picked TXT, Markdown or HTML document. */
export const TEXT_IMPORT_MAX_BYTES = 25 * 1024 * 1024;
/** Reader-pasted text, counted in UTF-16 code units like HTML maxLength. */
export const PASTE_MAX_CHARS = 1_000_000;
/** Reader-supplied paste title. */
export const TITLE_MAX_CHARS = 500;

/**
 * The largest file this app will try to import on an iPhone or an iPad.
 *
 * iOS Safari kills the whole tab somewhere between 1 GB and 1.5 GB of memory,
 * and an import costs about twice the file's size on top of the app itself: the
 * bytes once for the parser (pdf.js hands them to its worker, the extracted
 * text grows beside them) and once more while IndexedDB writes the stored copy.
 * A 300 MB scan is already close to the edge, so 500 MB is the point where
 * refusing costs the reader less than a tab that vanishes mid-import. This
 * remains a platform-wide backstop above the per-format caps.
 */
export const IOS_IMPORT_LIMIT_BYTES = 500 * 1024 * 1024;

/** Hard caps checked before a picked or stored file is read into memory. */
export const MAX_BYTES_BY_FORMAT: Readonly<Record<DocFormat, number>> = {
  pdf: PDF_IMPORT_MAX_BYTES,
  epub: EPUB_IMPORT_MAX_BYTES,
  docx: DOCX_IMPORT_MAX_BYTES,
  txt: TEXT_IMPORT_MAX_BYTES,
  md: TEXT_IMPORT_MAX_BYTES,
  html: TEXT_IMPORT_MAX_BYTES,
};

/** Reject an input before arrayBuffer(), unzipping or PDF parsing allocates it. */
export function assertImportSize(file: Pick<Blob, 'size'>, format: DocFormat): void {
  if (isIos() && file.size > IOS_IMPORT_LIMIT_BYTES) {
    throw new Error(
      `That file is too large to import on this device (over ${IOS_IMPORT_LIMIT_BYTES / 1024 ** 2} MB). ` +
        'Import it on a computer instead.',
    );
  }
  const maxBytes = MAX_BYTES_BY_FORMAT[format];
  if (file.size > maxBytes) {
    throw new Error(
      `That ${format.toUpperCase()} file is too large to import (over ${maxBytes / 1024 ** 2} MB).`,
    );
  }
}
