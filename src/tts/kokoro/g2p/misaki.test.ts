import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { phonemizeWithLexicon, tokensFor } from './index';

/**
 * The real dictionaries, served through a fetch stub so the production load
 * path (fetch → parse → Lexicon/LetterToSound) is what runs here.
 */
const files: Record<string, string> = {
  'lexicon/lexicon-en-us.txt': readFileSync('public/lexicon/lexicon-en-us.txt', 'utf8'),
  'lexicon/us_gold.json': readFileSync('public/lexicon/us_gold.json', 'utf8'),
  'lexicon/en-us.tsv': readFileSync('public/lexicon/en-us.tsv', 'utf8'),
};

// The dictionaries are ~16 MB and the Lexicon is built once, so load them a
// single time for the whole file instead of once per test.
beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const key = String(url).replace(/^.*\/lexicon\//, 'lexicon/');
      const body = files[key];
      if (body === undefined) return Promise.reject(new Error(`no ${url}`));
      return Promise.resolve(new Response(body));
    }),
  );
  await phonemizeWithLexicon('');
}, 60000);

afterAll(() => {
  vi.unstubAllGlobals();
});

/** Code points, so expectations survive the console's encoding. */
function codes(text: string): number[] {
  return Array.from(text).map((c) => c.codePointAt(0)!);
}

describe('Misaki G2P', () => {
  it('reads inflected words through the suffix rules', async () => {
    expect(codes(await phonemizeWithLexicon('running'))).toEqual([0x0279, 0x02c8, 0x028c, 0x006e, 0x026a, 0x014b]);
    expect(codes(await phonemizeWithLexicon('cats'))).toEqual([0x006b, 0x02c8, 0x00e6, 0x0074, 0x0073]);
    expect(codes(await phonemizeWithLexicon('walked'))).toEqual([0x0077, 0x02c8, 0x0254, 0x006b, 0x0074]);
    expect(codes(await phonemizeWithLexicon('walking'))).toEqual([0x0077, 0x02c8, 0x0254, 0x006b, 0x026a, 0x014b]);
  });

  it('uses the function-word forms that depend on the next sound', async () => {
    expect(codes(await phonemizeWithLexicon('a cat'))).toEqual([0x0250, 0x0020, 0x006b, 0x02c8, 0x00e6, 0x0074]);
    expect(codes(await phonemizeWithLexicon('an apple'))).toEqual([0x0250, 0x006e, 0x0020, 0x02c8, 0x00e6, 0x0070, 0x1d4a, 0x006c]);
    expect(codes(await phonemizeWithLexicon('the cat'))).toEqual([0x00f0, 0x0259, 0x0020, 0x006b, 0x02c8, 0x00e6, 0x0074]);
    expect(codes(await phonemizeWithLexicon('the apple'))).toEqual([0x00f0, 0x0069, 0x0020, 0x02c8, 0x00e6, 0x0070, 0x1d4a, 0x006c]);
  });

  it('reads numbers as words and expands unit abbreviations', async () => {
    const year = await phonemizeWithLexicon('1999');
    expect(year.split(' ')).toHaveLength(3);
    expect(year).toContain('nˌIntˈin');

    const km = await phonemizeWithLexicon('5 km');
    expect(km).toContain('fˈIv');
    expect(km).toContain('kɪlˈɑːmɪTɚz');

    expect(codes(await phonemizeWithLexicon('20 ft'))).toEqual([
      0x0074, 0x0077, 0x02c8, 0x025b, 0x006e, 0x0074, 0x0069, 0x0020, 0x0066, 0x02c8, 0x0069, 0x0074,
    ]);
  });

  it('folds diacritics before looking up or guessing', async () => {
    expect(codes(await phonemizeWithLexicon('café'))).toEqual([0x006b, 0x00e6, 0x0066, 0x02c8, 0x0041]);
  });

  it('keeps compounds, possessives and contractions as one word', async () => {
    expect(codes(await phonemizeWithLexicon("Richard's"))).toEqual([
      0x0279, 0x02c8, 0x026a, 0x0074, 0x0283, 0x0259, 0x0279, 0x0064, 0x007a,
    ]);
    expect(codes(await phonemizeWithLexicon("don't"))).toEqual([0x0064, 0x02c8, 0x004f, 0x006e, 0x0074]);
    expect(codes(await phonemizeWithLexicon('well-known'))).toEqual([
      0x0077, 0x02c8, 0x025b, 0x006c, 0x006e, 0x02c8, 0x004f, 0x006e,
    ]);
  });

  it('pronounces a name the lexicon already carries', async () => {
    expect(codes(await phonemizeWithLexicon('Tolkien'))).toEqual([
      0x0074, 0x02cc, 0x004f, 0x006c, 0x006b, 0x0069, 0x02c8, 0x025b, 0x006e,
    ]);
  });

  it('produces pre-tokenised phonemes for the native sherpa path', async () => {
    // Native Android uses these instead of sherpa's lexicon frontend, so its
    // spelling follows the same rules as the web engine.
    expect(codes((await phonemizeWithLexicon('High')).replaceAll(' ', ''))).toEqual([
      0x0068, 0x02c8, 0x0049,
    ]);
    expect(await tokensFor('High')).toEqual(['h', 'ˈ', 'I']);
    expect(await tokensFor('a cat')).toEqual(['ɐ', 'k', 'ˈ', 'æ', 't']);
    expect((await tokensFor('5 km') ?? []).length).toBeGreaterThan(4);
  });

  it('reads a heteronym from its part of speech', async () => {
    // "I read it" is present tense; the gold dictionary's DEFAULT is present.
    const present = await phonemizeWithLexicon('I read the book');
    expect(present).toContain('ɹˈid');
    expect(present).not.toContain('ɹˈɛd');
  });

  it('reads a standalone capital A as a letter, not the article "uh"', async () => {
    expect(await phonemizeWithLexicon('plan A')).toContain('\u02c8A');
    expect(await phonemizeWithLexicon('grade A')).not.toContain('ɐ');
    // A capital A followed by a noun is still the article.
    expect(await phonemizeWithLexicon('A cat')).toContain('ɐ');
  });

  it('reads a negative number as "minus …", not an em-dash', async () => {
    for (const text of ['-5', '-0.5', '−5']) {
      const spoken = await phonemizeWithLexicon(text);
      expect(spoken).not.toContain('—');
      expect(spoken.toLowerCase()).toContain('m');
    }
  });

  it('does not mistake an intra-word hyphen for a minus sign', async () => {
    const covid = await phonemizeWithLexicon('COVID-19');
    const covidOnly = await phonemizeWithLexicon('COVID');
    expect(covid.length).toBeGreaterThan(covidOnly.length + 3);
    const range = await phonemizeWithLexicon('1939-1945');
    expect(range.split(' ').filter(Boolean).length).toBeGreaterThan(4);
  });

  it('voices a slash as "slash"', async () => {
    const spoken = await phonemizeWithLexicon('1/2');
    expect(spoken.split(' ').filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(spoken).toContain('ʃ');
  });
});
