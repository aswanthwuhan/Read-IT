import { NumberToWords } from '../kokoro/g2p/misaki/number-to-words';

// Number spelling lives in one place: the vendored Misaki formatter. These
// helpers only choose which form (cardinal, ordinal, year, decimal) to ask for.
export function spellNumber(value: number): string {
  return NumberToWords.cardinal(value);
}

export function spellNumberText(text: string): string | null {
  const digits = text.replaceAll(',', '');
  return /^[0-9]+$/.test(digits) ? NumberToWords.cardinalText(digits) : null;
}

export function spellOrdinalText(text: string): string | null {
  return NumberToWords.ordinalText(text.replaceAll(',', ''));
}

export function spellYear(value: number): string {
  // The vendored formatter writes "nineteen oh-five"; speech reads the "oh"
  // as its own word, so the hyphen is the only thing to change.
  return NumberToWords.year(value).replaceAll('oh-', 'oh ');
}

export function spellYearText(text: string): string {
  const digits = text.replaceAll(',', '');
  if (digits.length === 2) {
    const short = Number(digits);
    // Two-digit years in running text are almost always 20xx or 19xx.
    return spellYear(short <= 29 ? 2000 + short : 1900 + short);
  }
  return spellYear(Number(digits));
}

export function spellDigits(text: string): string {
  if (!/^[0-9]+$/.test(text)) return text;
  return [...text].map((digit) => NumberToWords.cardinal(Number(digit))).join(' ');
}

/** Spells a cardinal or decimal amount, keeping the fraction digit by digit. */
export function spellAmount(raw: string): string {
  const clean = raw.replaceAll(',', '');
  const dot = clean.indexOf('.');
  if (dot === -1) return spellNumberText(clean) ?? clean;
  const whole = clean.slice(0, dot);
  const fraction = clean.slice(dot + 1);
  const wholeWords = whole === '' ? 'zero' : spellNumberText(whole) ?? spellDigits(whole);
  return `${wholeWords} point ${spellDigits(fraction)}`;
}

export function expandVersions(text: string): string {
  return text.replace(
    /(?:\bversion\b|\bv)\s*(\d+(?:\.\d+)+)\b/gi,
    (_match, version: string) => {
      const parts = version.split('.').map((part) => spellNumberText(part) ?? part);
      return `version ${parts.join(' point ')}`;
    },
  );
}

export function expandIpAddresses(text: string): string {
  return text.replace(
    /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g,
    (match, first: string, second: string, third: string, fourth: string) => {
      const octets = [first, second, third, fourth];
      // A dotted quad that is not a valid address is more likely a version or
      // a citation, so leave it for the other rules.
      if (octets.some((octet) => Number(octet) > 255)) return match;
      return octets.map((octet) => spellDigits(octet)).join(' dot ');
    },
  );
}

function isYearBoundary(after: string): boolean {
  // A bare year is followed by punctuation or the end of the text. A number
  // followed by a word ("1500 metres") stays a cardinal quantity.
  return /^[.,;:!?)\]}'"]+(?:\s|$)/.test(after) || after.trim() === '';
}

export function expandYears(text: string): string {
  return text.replace(
    /\b(\d{4})\b/g,
    (match, digits: string, offset: number, whole: string) => {
      const value = Number(digits);
      if (value < 1000 || value > 2099) return match;
      const before = whole.slice(0, offset);
      const after = whole.slice(offset + match.length);
      const cued = /(?:\b(?:in|since|by|until|till|from|of|year|circa|during|before|after|through|between|early|late|mid|the year)\s+|©\s*)$/i.test(before);
      if (!cued && !isYearBoundary(after)) return match;
      return spellYear(value);
    },
  );
}

export function expandOrdinals(text: string): string {
  return text.replace(
    /\b(\d+)(st|nd|rd|th)\b/gi,
    (match, digits: string) => spellOrdinalText(digits) ?? match,
  );
}

export function expandSignedNumbers(text: string): string {
  // Only a sign that is not glued to the previous word counts: "COVID-19"
  // and the two halves of a range are not negative numbers.
  return text.replace(
    /(^|[^\w.-])-(\d[\d,]*(?:\.\d+)?)/g,
    (_match, prefix: string, amount: string) => `${prefix}minus ${spellAmount(amount)}`,
  );
}

export function expandPlainNumbers(text: string): string {
  return text.replace(/\b\d[\d,]*(?:\.\d+)?\b/g, (match) => spellAmount(match));
}
