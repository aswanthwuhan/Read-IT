import { Inflate } from 'fflate';

/**
 * Structural caps for zip-based imports (EPUB, DOCX). A small archive can
 * declare a huge uncompressed entry, or hide a hundred thousand entries, and
 * the unzip step would expand them all before any text is parsed. Entry names
 * are only inspected as text here, never handed to the filesystem.
 */

export const MAX_ZIP_ENTRIES = 20_000;
export const MAX_ZIP_TOTAL_BYTES = 500 * 1024 * 1024;

/** Verify actual output before passing the archive to a buffering ZIP reader. */
export function verifyZipOutput(data: ArrayBuffer): void {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const invalid = () => new Error('This book has an invalid or unsupported ZIP archive.');
  // Match JSZip's last-signature lookup, then require a standard single-disk ZIP32 directory.
  let end = bytes.length - 4;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || end + 22 > bytes.length) throw invalid();
  const directory = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  if (view.getUint32(end + 4, true) !== 0 || count !== view.getUint16(end + 8, true) ||
      count > MAX_ZIP_ENTRIES || directory + view.getUint32(end + 12, true) !== end) throw invalid();

  let offset = directory;
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw invalid();
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const declared = view.getUint32(offset + 24, true);
    const local = view.getUint32(offset + 42, true);
    if ((view.getUint16(offset + 8, true) & 1) || view.getUint16(offset + 34, true) !== 0 ||
        local + 30 > directory || view.getUint32(local, true) !== 0x04034b50) throw invalid();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > directory) throw invalid();
    assertArchiveSize(total + declared);
    if (method === 0) {
      if (compressed !== declared) throw invalid();
    } else if (method === 8) {
      let produced = 0;
      const inflate = new Inflate((chunk) => {
        produced += chunk.length;
        if (produced > declared) throw invalid();
      });
      const finish = start + compressed;
      if (start === finish) throw invalid();
      // Bound temporary output per push as well as the aggregate budget.
      for (let at = start; at < finish; at += 4096) {
        const next = Math.min(at + 4096, finish);
        inflate.push(bytes.subarray(at, next), next === finish);
      }
      if (produced !== declared) throw invalid();
    } else {
      throw invalid();
    }
    total += declared;
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (offset !== end) throw invalid();
}

export interface ZipEntryInfo {
  name: string;
  size?: number;
}

/** Reject an archive whose entry list is too long or contains an unsafe path. */
export function assertEntries(entries: ZipEntryInfo[]): void {
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error("That book's archive has too many files to open safely.");
  }

  let total = 0;
  for (const entry of entries) {
    assertSafeName(entry.name);
    if (typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size > 0) {
      total += entry.size;
    }
  }

  assertArchiveSize(total);
}

/** Reject a declared total uncompressed size above the cap. */
export function assertArchiveSize(totalUncompressed: number): void {
  if (Number.isFinite(totalUncompressed) && totalUncompressed > MAX_ZIP_TOTAL_BYTES) {
    throw new Error("That book's archive is too large to open safely.");
  }
}

/**
 * A name is unsafe when it is absolute or walks above the archive root. Backslashes
 * are normalised first because a Windows-authored entry can use either separator.
 */
function assertSafeName(name: string): void {
  const path = name.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new Error("That book's archive contains an unsafe file path.");
  }

  let depth = 0;
  for (const segment of path.split('/')) {
    if (segment === '..') {
      depth -= 1;
      if (depth < 0) throw new Error("That book's archive contains an unsafe file path.");
    } else if (segment !== '' && segment !== '.') {
      depth += 1;
    }
  }
}
