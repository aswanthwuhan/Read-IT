import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocFormat } from '../core/types';
import {
  assertImportSize,
  DOCX_IMPORT_MAX_BYTES,
  EPUB_IMPORT_MAX_BYTES,
  IOS_IMPORT_LIMIT_BYTES,
  MAX_BYTES_BY_FORMAT,
  PASTE_MAX_CHARS,
  PDF_IMPORT_MAX_BYTES,
  TEXT_IMPORT_MAX_BYTES,
  TITLE_MAX_CHARS,
} from './limits';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('import limits', () => {
  it('defines the agreed byte and character bounds', () => {
    expect(TEXT_IMPORT_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(PASTE_MAX_CHARS).toBe(1_000_000);
    expect(TITLE_MAX_CHARS).toBe(500);
    expect(MAX_BYTES_BY_FORMAT).toEqual({
      pdf: PDF_IMPORT_MAX_BYTES,
      epub: EPUB_IMPORT_MAX_BYTES,
      docx: DOCX_IMPORT_MAX_BYTES,
      txt: TEXT_IMPORT_MAX_BYTES,
      md: TEXT_IMPORT_MAX_BYTES,
      html: TEXT_IMPORT_MAX_BYTES,
    });
  });

  it.each(Object.entries(MAX_BYTES_BY_FORMAT) as [DocFormat, number][])(
    'accepts the exact %s cap and rejects one byte more',
    (format, cap) => {
      expect(() => assertImportSize({ size: cap }, format)).not.toThrow();
      expect(() => assertImportSize({ size: cap + 1 }, format)).toThrow(
        new RegExp(`${format.toUpperCase()} file is too large`),
      );
    },
  );

  it('keeps the iOS-wide cap ahead of the per-format check', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });

    expect(() => assertImportSize({ size: PDF_IMPORT_MAX_BYTES }, 'pdf')).not.toThrow();
    expect(() => assertImportSize({ size: IOS_IMPORT_LIMIT_BYTES + 1 }, 'pdf')).toThrow(
      /too large to import on this device/,
    );
  });
});
