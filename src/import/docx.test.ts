import { describe, expect, it } from 'vitest';
import { EPUB_TEXT_MAX_BYTES } from './limits';
import { assertSafeUncompressedSize } from './docx';

/** Minimal ZIP skeleton: a central directory followed by an EOCD. */
function zipWith(
  sizes: number[],
  options: { trailing?: number; zip64?: boolean; declaredEntries?: number } = {}
): ArrayBuffer {
  const directory = 100;
  const eocdAt = directory + sizes.length * 46 + (options.trailing ?? 0);
  const buffer = new ArrayBuffer(eocdAt + 22);
  const view = new DataView(buffer);
  sizes.forEach((size, i) => {
    const at = directory + i * 46;
    view.setUint32(at, 0x02014b50, true); // central file header
    view.setUint32(at + 24, size, true); // uncompressed size
  });
  view.setUint32(eocdAt, 0x06054b50, true); // end of central directory
  const declared = options.zip64 ? 0xffff : (options.declaredEntries ?? sizes.length);
  view.setUint16(eocdAt + 10, declared, true);
  view.setUint32(eocdAt + 16, options.zip64 ? 0xffffffff : directory, true);
  return buffer;
}

describe('assertSafeUncompressedSize', () => {
  it('accepts an archive under the text budget', () => {
    expect(() => assertSafeUncompressedSize(zipWith([1000, 2000]))).not.toThrow();
  });

  it('refuses an over-budget uncompressed size', () => {
    expect(() => assertSafeUncompressedSize(zipWith([EPUB_TEXT_MAX_BYTES + 1]))).toThrow(/too much text/);
  });

  it('sums uncompressed sizes across entries', () => {
    const half = Math.floor(EPUB_TEXT_MAX_BYTES / 2) + 1;
    expect(() => assertSafeUncompressedSize(zipWith([half, half]))).toThrow(/too much text/);
  });

  it('refuses archive-level ZIP64 markers instead of deferring to mammoth', () => {
    expect(() => assertSafeUncompressedSize(zipWith([1000], { zip64: true }))).toThrow(/unsupported ZIP/);
  });

  it('refuses a per-entry ZIP64 size marker', () => {
    expect(() => assertSafeUncompressedSize(zipWith([0xffffffff]))).toThrow(/too large/);
  });

  it('does not trust a zero EOCD entry count (JSZip ignores it)', () => {
    const buffer = zipWith([EPUB_TEXT_MAX_BYTES + 1], { declaredEntries: 0 });
    expect(() => assertSafeUncompressedSize(buffer)).toThrow(/too much text/);
  });

  it('does not trust an undercounted EOCD (hidden entries)', () => {
    const buffer = zipWith([1000, EPUB_TEXT_MAX_BYTES + 1], { declaredEntries: 1 });
    expect(() => assertSafeUncompressedSize(buffer)).toThrow(/too much text/);
  });

  it('finds an EOCD beyond the 64 KB comment window (trailing bytes)', () => {
    const buffer = zipWith([EPUB_TEXT_MAX_BYTES + 1], { trailing: 70_000 });
    expect(() => assertSafeUncompressedSize(buffer)).toThrow(/too much text/);
  });

  it('defers to mammoth when there is no valid central directory', () => {
    expect(() => assertSafeUncompressedSize(new ArrayBuffer(64))).not.toThrow();
  });
});
