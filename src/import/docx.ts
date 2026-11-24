import mammoth from 'mammoth';
import type { ParsedDoc } from '../core/types';
import { parseHtmlDocument } from './html';
import { DOCX_IMPORT_MAX_BYTES, EPUB_TEXT_MAX_BYTES } from './limits';
import { assertEntries, MAX_ZIP_ENTRIES, verifyZipOutput, type ZipEntryInfo } from './zipLimits';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;

/**
 * Find the end-of-central-directory record. JSZip scans the whole buffer, not
 * just the 64 KB comment window, so we must do the same: a bomb with trailing
 * bytes after the EOCD would otherwise be invisible to the cap. Candidate
 * records are validated against the central directory before being accepted.
 */
function findEocd(view: DataView): number {
  for (let at = view.byteLength - 22; at >= 0; at--) {
    if (view.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    const entries = view.getUint16(at + 10, true);
    const directory = view.getUint32(at + 16, true);
    // ZIP64 markers cannot be validated as offsets, but must still be found so
    // the caller can refuse them rather than silently skipping the size check.
    const zip64 = entries === 0xffff || directory === 0xffffffff;
    if (!zip64) {
      // Do not trust the declared entry count (JSZip ignores it); accept the
      // record as long as it points at a real central-directory header.
      if (directory + CENTRAL_HEADER_SIZE > view.byteLength) continue;
      if (view.getUint32(directory, true) !== CENTRAL_HEADER_SIGNATURE) continue;
    }
    return at;
  }
  return -1;
}

/**
 * mammoth unzips the DOCX before we see any text, so a small archive can expand
 * into gigabytes of XML. Read the ZIP central directory (never decompressing)
 * and add up the stored uncompressed sizes. A missing or malformed directory is
 * left for mammoth to reject in its own way. ZIP64 is refused outright: its
 * real sizes live in a 64-bit extra field that this 32-bit reader cannot see.
 * Exported for the security-focused unit tests.
 */
export function assertSafeUncompressedSize(data: ArrayBuffer): void {
  const view = new DataView(data);
  const eocd = findEocd(view);
  if (eocd < 0) return; // Not a zip / truncated: mammoth will say so.

  const entries = view.getUint16(eocd + 10, true);
  const directory = view.getUint32(eocd + 16, true);
  // Archive-level ZIP64 markers. JSZip understands them, so treating them as
  // "malformed" and deferring to mammoth would let a bomb through.
  if (entries === 0xffff || directory === 0xffffffff) {
    throw new Error('This document uses an unsupported ZIP format.');
  }

  // Walk every central-directory header rather than trusting the EOCD entry
  // count: JSZip reads headers until the signature stops matching, so a count
  // of 0 or an undercount must not hide entries from this budget.
  let offset = directory;
  let total = 0;
  const zipEntries: ZipEntryInfo[] = [];
  while (offset + CENTRAL_HEADER_SIZE <= data.byteLength) {
    if (view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE) break; // malformed: let mammoth handle it
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) throw new Error('This document is too large to import safely.');
    total += size;
    if (total > EPUB_TEXT_MAX_BYTES) throw new Error('This document contains too much text to import safely.');
    const nameLength = view.getUint16(offset + 28, true);
    if (offset + CENTRAL_HEADER_SIZE + nameLength > data.byteLength) break; // malformed: let mammoth handle it
    const name = new TextDecoder().decode(new Uint8Array(data, offset + CENTRAL_HEADER_SIZE, nameLength));
    zipEntries.push({ name, size });
    if (zipEntries.length > MAX_ZIP_ENTRIES) assertEntries(zipEntries);
    // Step over this header's variable-length name, extra field and comment.
    offset +=
      CENTRAL_HEADER_SIZE +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  assertEntries(zipEntries);
}

/** DOCX → mammoth HTML → the shared HTML walker (headings start chapters). */
export async function parseDocx(data: ArrayBuffer, fallbackTitle: string): Promise<ParsedDoc> {
  if (data.byteLength > DOCX_IMPORT_MAX_BYTES) {
    throw new Error('This document is too large to import.');
  }
  assertSafeUncompressedSize(data);
  verifyZipOutput(data);
  // The browser build of mammoth reads `arrayBuffer`; its Node build reads `buffer`
  // and throws "Could not find file in options" otherwise (tests run in Node).
  const input =
    typeof Buffer === 'undefined'
      ? { arrayBuffer: data }
      : { arrayBuffer: data, buffer: Buffer.from(data) };
  const result = await mammoth.convertToHtml(input as Parameters<typeof mammoth.convertToHtml>[0]);
  const doc = new DOMParser().parseFromString(result.value, 'text/html');
  return parseHtmlDocument(doc, { format: 'docx', title: fallbackTitle });
}
