import { spellNumberText } from './numbers';

const DENOMINATORS: Record<number, [one: string, many: string]> = {
  2: ['half', 'halves'],
  3: ['third', 'thirds'],
  4: ['quarter', 'quarters'],
  5: ['fifth', 'fifths'],
  6: ['sixth', 'sixths'],
  7: ['seventh', 'sevenths'],
  8: ['eighth', 'eighths'],
  9: ['ninth', 'ninths'],
  10: ['tenth', 'tenths'],
};

const VULGAR: Record<string, [numerator: number, denominator: number]> = {
  '½': [1, 2],
  '⅓': [1, 3],
  '⅔': [2, 3],
  '¼': [1, 4],
  '¾': [3, 4],
  '⅕': [1, 5],
  '⅖': [2, 5],
  '⅗': [3, 5],
  '⅘': [4, 5],
  '⅙': [1, 6],
  '⅚': [5, 6],
  '⅛': [1, 8],
  '⅜': [3, 8],
  '⅝': [5, 8],
  '⅞': [7, 8],
};

type OneStyle = 'word' | 'article' | 'omit';

function fractionWords(numerator: number, denominator: number, oneStyle: OneStyle): string | null {
  const names = DENOMINATORS[denominator];
  if (names === undefined) return null;
  if (numerator === 1) {
    if (oneStyle === 'omit') return names[0];
    if (oneStyle === 'article') return `a ${names[0]}`;
    return `${spellNumberText('1') ?? 'one'} ${names[0]}`;
  }
  const numeratorWord = spellNumberText(String(numerator));
  if (numeratorWord === null) return null;
  return `${numeratorWord} ${names[1]}`;
}

export function expandFractions(text: string): string {
  // A vulgar fraction attached to a whole number is mixed ("3½").
  let out = text.replace(
    /(\d+)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g,
    (match, whole: string, glyph: string) => {
      const parts = VULGAR[glyph];
      if (parts === undefined) return match;
      const wholeWord = spellNumberText(whole);
      const fraction = fractionWords(parts[0], parts[1], 'article');
      if (wholeWord === null || fraction === null) return match;
      return `${wholeWord} and ${fraction}`;
    },
  );

  out = out.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (glyph) => {
    const parts = VULGAR[glyph];
    return parts === undefined ? glyph : fractionWords(parts[0], parts[1], 'omit') ?? glyph;
  });

  // "5+1/2" is a mixed number. Doing it before the operator pass keeps the
  // plus sign from being read as arithmetic.
  out = out.replace(
    /\b(\d+)\s*\+\s*(\d+)\s*\/\s*(\d+)\b/g,
    (match, whole: string, numerator: string, denominator: string) => {
      const wholeWord = spellNumberText(whole);
      const fraction = fractionWords(Number(numerator), Number(denominator), 'article');
      if (wholeWord === null || fraction === null) return match;
      return `${wholeWord} and ${fraction}`;
    },
  );

  return out.replace(
    /\b(\d+)\s*\/\s*(\d+)\b/g,
    (match, numerator: string, denominator: string) => {
      // Small fractions are safe; "24/7" and similar stay for the plain
      // number pass rather than becoming an implausible "sevenths".
      const top = Number(numerator);
      const bottom = Number(denominator);
      if (top > 10 || bottom > 10) return match;
      const words = fractionWords(top, bottom, 'word');
      return words ?? match;
    },
  );
}
