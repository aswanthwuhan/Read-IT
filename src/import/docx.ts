import mammoth from 'mammoth';
import type { ParsedDoc } from '../core/types';
import { parseHtmlDocument } from './html';
import { DOCX_IMPORT_MAX_BYTES, EPUB_TEXT_MAX_BYTES } from './limits';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;

/**
 * mammoth unzips the DOCX before we see any text, so a small archive can expand
 * into gigabytes of XML. Read the ZIP central directory (never decompressing)
 * and add up the stored uncompressed sizes. A missing or malformed directory is
 * left for mammoth to reject in its own way; a ZIP64 size is refused here since
 * its real size cannot be read from the 32-bit field.
 */
function assertSafeUncompressedSize(data: ArrayBuffer): void {
  const view = new DataView(data);
  // The end-of-central-directory record is 22 bytes plus a comment of at most
  // 65535 bytes, so its signature cannot begin earlier than 65557 bytes back.
  const earliest = Math.max(0, data.byteLength - 65557);
  let eocd = -1;
  for (let offset = data.byteLength - 22; offset >= earliest; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0 || eocd + 22 > data.byteLength) return; // Not a zip / truncated: mammoth will say so.

  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + CENTRAL_HEADER_SIZE > data.byteLength) return; // malformed: let mammoth handle it
    if (view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE) return;
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) throw new Error('This document is too large to import safely.');
    total += size;
    if (total > EPUB_TEXT_MAX_BYTES) throw new Error('This document contains too much text to import safely.');
    // Step over this header's variable-length name, extra field and comment.
    offset +=
      CENTRAL_HEADER_SIZE +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
}

/** DOCX → mammoth HTML → the shared HTML walker (headings start chapters). */
export async function parseDocx(data: ArrayBuffer, fallbackTitle: string): Promise<ParsedDoc> {
  if (data.byteLength > DOCX_IMPORT_MAX_BYTES) {
    throw new Error('This document is too large to import.');
  }
  assertSafeUncompressedSize(data);
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
