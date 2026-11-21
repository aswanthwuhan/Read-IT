import { spellAmount, spellOrdinalText, spellYearText } from './numbers';

export function expandRanges(text: string): string {
  let out = text.replace(
    /\b(\d+)(st|nd|rd|th)-(\d+)(st|nd|rd|th)\b/gi,
    (match, first: string, _firstSuffix: string, second: string, _secondSuffix: string) => {
      const firstWord = spellOrdinalText(first);
      const secondWord = spellOrdinalText(second);
      return firstWord === null || secondWord === null ? match : `${firstWord} to ${secondWord}`;
    },
  );

  out = out.replace(
    /\b(\d{4})-(\d{2}|\d{4})\b/g,
    (match, first: string, second: string) => {
      const firstValue = Number(first);
      if (firstValue < 1000 || firstValue > 2099) return match;
      if (second.length === 4) {
        const secondValue = Number(second);
        if (secondValue < 1000 || secondValue > 2099) return match;
        return `${spellYearText(first)} to ${spellYearText(second)}`;
      }
      // "1990-95" drops the repeated century; "2024-25" drops the repeated
      // "twenty", which is why the short half is a cardinal.
      return `${spellYearText(first)} to ${spellAmount(second)}`;
    },
  );

  return out.replace(
    /\b(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\b/g,
    (_match, first: string, second: string) => `${spellAmount(first)} to ${spellAmount(second)}`,
  );
}

/**
 * "COVID-19" is a name plus a number, not a range. This runs after
 * expandRanges so real numeric ranges keep their "to" reading.
 */
export function expandLetteredNumbers(text: string): string {
  return text.replace(/\b([A-Za-z]+)-(\d+)\b/g, '$1 $2');
}

export function expandRatiosAndDimensions(text: string): string {  // Times have already consumed "9:00"; what is left with a colon is a ratio.
  let out = text.replace(
    /\b(\d+)\s*:\s*(\d+)\b/g,
    (_match, first: string, second: string) => `${spellAmount(first)} to ${spellAmount(second)}`,
  );

  out = out.replace(
    /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\b/g,
    (_match, first: string, second: string) => `${spellAmount(first)} by ${spellAmount(second)}`,
  );

  return out;
}
