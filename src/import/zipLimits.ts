/**
 * Structural caps for zip-based imports (EPUB, DOCX). A small archive can
 * declare a huge uncompressed entry, or hide a hundred thousand entries, and
 * the unzip step would expand them all before any text is parsed. Entry names
 * are only inspected as text here, never handed to the filesystem.
 */

export const MAX_ZIP_ENTRIES = 20_000;
export const MAX_ZIP_TOTAL_BYTES = 500 * 1024 * 1024;

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
