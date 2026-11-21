/**
 * App-level size caps for the archive and article import paths. epubjs unzips
 * the book and pdf.js decompresses its streams into memory on their own, so a
 * hostile or corrupt file can expand to gigabytes of memory before any of the
 * app's parsing runs. These caps reject inputs above them with a plain message
 * instead of letting the parser eat memory until it dies. The backup caps in
 * `src/backup/backup.ts` are much stronger and stay as they are.
 */

/** An imported EPUB: the zip file as stored. */
export const EPUB_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
/** An imported DOCX: the zip file as stored. */
export const DOCX_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
/**
 * Total text across an EPUB's spine files, counted while parsing. A compressed
 * entry can expand to far more than its byte size, so the input cap alone
 * cannot bound what gets parsed.
 */
export const EPUB_TEXT_MAX_BYTES = 500 * 1024 * 1024;
/** An imported PDF: the file as stored. */
export const PDF_IMPORT_MAX_BYTES = 200 * 1024 * 1024;
/** Upper bound on a PDF's page count, so bulk expansions stay bounded. */
export const PDF_MAX_PAGES = 10_000;
/** HTML fetched for a web-article import. */
export const ARTICLE_HTML_MAX_BYTES = 50 * 1024 * 1024;
