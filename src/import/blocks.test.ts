import { describe, expect, it } from 'vitest';
import { normaliseText } from './blocks';

describe('normaliseText', () => {
  it('rejoins words hyphenated across a line break', () => {
    expect(normaliseText('exam-\nple')).toBe('example');
    expect(normaliseText('co-\r\noperate')).toBe('cooperate');
    expect(normaliseText('under-\n  stand')).toBe('understand');
  });

  it('keeps a hyphen when the continuation is capitalised', () => {
    expect(normaliseText('Anglo-\nSaxon')).toBe('Anglo-Saxon');
  });

  it('keeps hyphens that are not line breaks', () => {
    expect(normaliseText('well-known')).toBe('well-known');
    expect(normaliseText('state-of-the-art')).toBe('state-of-the-art');
  });

  it('drops soft hyphens without leaving a gap', () => {
    expect(normaliseText('exam\u00adple')).toBe('example');
  });

  it('strips zero-width characters and collapses whitespace', () => {
    expect(normaliseText('a\u200bb\u00a0c   d')).toBe('ab c d');
    expect(normaliseText('  padded  ')).toBe('padded');
  });
});
