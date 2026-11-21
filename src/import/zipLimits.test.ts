import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { assertSafeUncompressedSize } from './docx';
import {
  assertArchiveSize,
  assertEntries,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_TOTAL_BYTES,
  type ZipEntryInfo,
} from './zipLimits';

function many(count: number): ZipEntryInfo[] {
  return Array.from({ length: count }, (_, i) => ({ name: `file-${i}.txt` }));
}

function archive(files: Record<string, Uint8Array>): ArrayBuffer {
  const bytes = zipSync(files);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('assertEntries', () => {
  it('accepts a normal entry list, including harmless inner ".." segments', () => {
    expect(() =>
      assertEntries([
        { name: 'mimetype', size: 20 },
        { name: 'OPS/content.opf', size: 1024 },
        { name: 'OPS/a/../images/cover.jpg', size: 4096 },
        { name: 'word/document.xml' },
      ])
    ).not.toThrow();
  });

  it('accepts exactly the maximum number of entries', () => {
    expect(() => assertEntries(many(MAX_ZIP_ENTRIES))).not.toThrow();
  });

  it('rejects too many entries', () => {
    expect(() => assertEntries(many(MAX_ZIP_ENTRIES + 1))).toThrow(/too many files/);
  });

  it('rejects an over-budget single entry', () => {
    expect(() => assertEntries([{ name: 'huge.bin', size: MAX_ZIP_TOTAL_BYTES + 1 }])).toThrow(/too large/);
  });

  it('sums declared sizes across entries', () => {
    const half = Math.floor(MAX_ZIP_TOTAL_BYTES / 2) + 1;
    expect(() =>
      assertEntries([
        { name: 'a.bin', size: half },
        { name: 'b.bin', size: half },
      ])
    ).toThrow(/too large/);
  });

  it('ignores entries with no declared size', () => {
    expect(() => assertEntries([{ name: 'a.txt' }, { name: 'b.txt' }])).not.toThrow();
  });

  it.each(['/etc/passwd', 'C:\\Windows\\win.ini', 'C:/Windows/win.ini'])(
    'rejects absolute name %s',
    (name) => {
      expect(() => assertEntries([{ name }])).toThrow(/unsafe file path/);
    }
  );

  it.each(['../secret', 'a/../../b', '..\\secret', 'a\\..\\..\\b', '..'])(
    'rejects escaping name %s',
    (name) => {
      expect(() => assertEntries([{ name }])).toThrow(/unsafe file path/);
    }
  );

  it('rejects one escaping name in an otherwise normal list', () => {
    expect(() => assertEntries([{ name: 'good.txt' }, { name: '../bad.txt' }])).toThrow(/unsafe file path/);
  });
});

describe('assertArchiveSize', () => {
  it('accepts the cap exactly', () => {
    expect(() => assertArchiveSize(MAX_ZIP_TOTAL_BYTES)).not.toThrow();
  });

  it('rejects one byte over the cap', () => {
    expect(() => assertArchiveSize(MAX_ZIP_TOTAL_BYTES + 1)).toThrow(/too large/);
  });
});

describe('docx central-directory walk', () => {
  it('refuses a real archive with a path-traversal entry', () => {
    expect(() => assertSafeUncompressedSize(archive({ '../evil.txt': strToU8('hi') }))).toThrow(
      /unsafe file path/
    );
  });

  it('still accepts a normal archive', () => {
    expect(() =>
      assertSafeUncompressedSize(archive({ 'word/document.xml': strToU8('<w:document/>') }))
    ).not.toThrow();
  });
});
