import { spellNumber, spellOrdinalText } from './numbers';

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

// Only canonical numerals are expanded. Without this check "DIX" and "MIX"
// would be silently read as numbers inside ordinary prose.
const CANONICAL_ROMAN = /^M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

function romanValue(text: string): number | null {
  const upper = text.toUpperCase();
  if (upper.length === 0 || upper.length > 15 || !CANONICAL_ROMAN.test(upper)) return null;
  let total = 0;
  let previous = 0;
  for (let index = upper.length - 1; index >= 0; index -= 1) {
    const value = ROMAN_VALUES[upper[index]];
    if (value < previous) {
      total -= value;
    } else {
      total += value;
      previous = value;
    }
  }
  return total > 0 ? total : null;
}

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function expandRomanNumerals(text: string): string {
  let out = text.replace(
    /\bWorld War\s+([IVXLCDM]+)\b/g,
    (match, numeral: string) => {
      const value = romanValue(numeral);
      return value === null ? match : `World War ${capitalised(spellNumber(value))}`;
    },
  );

  out = out.replace(
    /\b(Chapter|Part|Act|Book|Volume|Section|Appendix|Article)\s+([IVXLCDM]+)\b/g,
    (match, cue: string, numeral: string) => {
      const value = romanValue(numeral);
      if (value === null) return match;
      // Rank words are already lower-case in the expected speech form.
      return `${cue.toLowerCase()} ${spellNumber(value)}`;
    },
  );

  return out.replace(
    /\b(Henry|Edward|George|William|Charles|James|Richard|Philip|Louis|Elizabeth|Frederick|Napoleon)\s+([IVXLCDM]+)\b/g,
    (match, name: string, numeral: string) => {
      const value = romanValue(numeral);
      if (value === null) return match;
      const ordinal = spellOrdinalText(String(value));
      return ordinal === null ? match : `${name} the ${ordinal}`;
    },
  );
}
