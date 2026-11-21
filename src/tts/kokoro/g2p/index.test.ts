import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { phonemizeWithLexicon } from './index';

describe('phonemizeWithLexicon', () => {
  beforeEach(() => {
    // Force the licence-clean OOV fallback: the number handling must work
    // whether or not the CMU lexicon has finished downloading.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('speaks digit-only tokens instead of dropping them', async () => {
    const result = await phonemizeWithLexicon('5');
    const groups = result.split(' ').filter(Boolean);
    expect(groups).toHaveLength(1);
    expect(groups[0]).not.toBe('');
  });

  it('splits a year into the digit tokens produce by normalize_text', async () => {
    // normalize_text turns 2024 into "20 24"; "24" becomes "twenty four".
    const result = await phonemizeWithLexicon('20 24');
    const groups = result.split(' ').filter(Boolean);
    expect(groups).toHaveLength(3);
    expect(groups.every(Boolean)).toBe(true);
  });

  it('keeps every word around a decimal', async () => {
    // normalize_text produces "3 point 5" for 3.5.
    const result = await phonemizeWithLexicon('3 point 5');
    expect(result.split(' ').filter(Boolean)).toHaveLength(3);
  });

  it('spells zero and larger grouped numbers', async () => {
    expect((await phonemizeWithLexicon('0')).split(' ').filter(Boolean)).toHaveLength(1);
    expect((await phonemizeWithLexicon('1234')).split(' ').filter(Boolean)).toHaveLength(6);
  });

  it('leaves ordinary words untouched', async () => {
    const result = await phonemizeWithLexicon('Hello 20');
    expect(result.split(' ').filter(Boolean)).toHaveLength(2);
  });

  it('handles decimals, negatives and grouped digits offline', async () => {
    expect((await phonemizeWithLexicon('3.5')).split(' ').filter(Boolean)).toHaveLength(3);
    expect((await phonemizeWithLexicon('-5')).split(' ').filter(Boolean)).toHaveLength(2);
    expect((await phonemizeWithLexicon('1,000')).split(' ').filter(Boolean)).toHaveLength(2);
  });
});
