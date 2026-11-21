import { spellAmount, spellNumber, spellOrdinalText } from './numbers';

const SUPERSCRIPT_RUN = /[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]{2,}/g;
const SUPERSCRIPT_POWER: Record<string, number> = {
  '\u00B2': 2,
  '\u00B3': 3,
  '\u2074': 4,
  '\u2075': 5,
  '\u2076': 6,
  '\u2077': 7,
  '\u2078': 8,
  '\u2079': 9,
};

export function dropFootnoteMarkers(text: string): string {
  // A run of two or more superscript digits is a footnote or citation key,
  // not an exponent. A single ² on "mc²" is a real square.
  return text.replace(SUPERSCRIPT_RUN, '');
}

function powerWords(power: number): string {
  if (power === 2) return 'squared';
  if (power === 3) return 'cubed';
  const ordinal = spellOrdinalText(String(power));
  return ordinal === null ? `to the power of ${spellNumber(power)}` : `to the ${ordinal} power`;
}

function exponentBase(base: string): string {
  // "mc²" is read as two spoken letters, while a single "x" stays a word.
  return base.length > 1 && base.length <= 3 ? [...base].join(' ') : base;
}

export function expandExponents(text: string): string {
  let out = text.replace(
    /\b([A-Za-z]+)\s*\^\s*(\d+)/g,
    (_match, base: string, power: string) => `${exponentBase(base)} ${powerWords(Number(power))}`,
  );

  out = out.replace(
    /\b([A-Za-z]+)([\u00B2\u00B3\u2074-\u2079])/g,
    (match, base: string, symbol: string) => {
      const power = SUPERSCRIPT_POWER[symbol];
      return power === undefined ? match : `${exponentBase(base)} ${powerWords(power)}`;
    },
  );

  return out;
}

export function expandSquareRoots(text: string): string {
  return text.replace(
    /\u221A\s*(-?)(\d[\d,]*(?:\.\d+)?)/g,
    (_match, sign: string, amount: string) => {
      const words = `the square root of ${spellAmount(amount)}`;
      return sign === '-' ? `minus ${words}` : words;
    },
  );
}

export function expandOperatorSymbols(text: string): string {
  // The digit before the operator is required, so "C++" and ordinary prose
  // keep their symbols. Ranges have already been consumed by this point.
  let out = text
    .replace(/(\d)\s*-\s*(?=\d)/g, '$1 minus ')
    .replace(/(\d)\s*\+\s*/g, '$1 plus ')
    .replace(/(\d)\s*=\s*/g, '$1 equals ')
    .replace(/(\d)\s*×\s*/g, '$1 times ')
    .replace(/(\d)\s*÷\s*/g, '$1 divided by ');

  out = out
    .replaceAll('±', 'plus or minus')
    .replaceAll('≈', 'approximately')
    .replaceAll('≤', 'less than or equal to')
    .replaceAll('≥', 'greater than or equal to')
    .replaceAll('≠', 'not equal to')
    .replaceAll('∞', 'infinity');

  return out;
}
