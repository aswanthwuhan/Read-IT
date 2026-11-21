import { spellDigits, spellNumberText } from './numbers';

// Toll-free and premium-rate prefixes that read as a number ("eight hundred")
// rather than digit by digit.
const EXCHANGE_CODES = new Set([
  '800', '833', '844', '855', '866', '877', '888', '900',
]);

function looksLikeYearPair(groups: string[]): boolean {
  if (groups.length !== 2) return false;
  const first = groups[0];
  const second = groups[1];
  if (first.length !== 4 || second.length !== 4) return false;
  // "2019-2023" is a year range, not a two-part telephone number.
  return Number(first) >= 1000 && Number(first) <= 2099
    && Number(second) >= 1000 && Number(second) <= 2099;
}

function groupWords(group: string, index: number): string {
  if (index === 0 && group === '1') return spellNumberText(group) ?? group;
  if (EXCHANGE_CODES.has(group)) return spellNumberText(group) ?? group;
  return spellDigits(group);
}

export function expandPhoneNumbers(text: string): string {
  return text.replace(/\b\d+(?:-\d+)+\b/g, (match) => {
    const groups = match.split('-');
    const digitCount = groups.reduce((total, group) => total + group.length, 0);
    const hasShortGroup = groups.some((group) => group.length >= 3);
    const hasLongGroup = groups.some((group) => group.length >= 4);
    const qualifies = groups.length >= 3 || (hasShortGroup && hasLongGroup);
    if (digitCount < 7 || !qualifies || looksLikeYearPair(groups)) return match;

    const words = groups.map((group, index) => groupWords(group, index));
    // The country code and the exchange code form one spoken block:
    // "one eight hundred", not "one, eight hundred".
    if (groups.length > 1 && groups[0] === '1' && EXCHANGE_CODES.has(groups[1])) {
      return [`${words[0]} ${words[1]}`, ...words.slice(2)].join(', ');
    }
    return words.join(', ');
  });
}
