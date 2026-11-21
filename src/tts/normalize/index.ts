import { expandAbbreviations } from './abbrev';
import {
  expandIsoDates,
  expandQuarters,
  expandSlashDates,
  expandTimes,
  expandWeekdays,
} from './dates';
import { expandFractions } from './fractions';
import {
  expandIpAddresses,
  expandOrdinals,
  expandPlainNumbers,
  expandSignedNumbers,
  expandVersions,
  expandYears,
} from './numbers';
import { expandPhoneNumbers } from './phones';
import { expandLetteredNumbers, expandRanges, expandRatiosAndDimensions } from './ranges';
import { expandRomanNumerals } from './roman';
import {
  dropFootnoteMarkers,
  expandExponents,
  expandOperatorSymbols,
  expandSquareRoots,
} from './symbols';
import { expandMoney, expandUnits } from './units';

/**
 * Rewrites text into the words a speech engine should say.
 *
 * The order is fixed and each rule consumes its digits in one pass. The most
 * specific forms (dates, times, currency, units) run before the generic number
 * pass; otherwise their parts would be read as unrelated integers. When no
 * rule is confident, the original text is returned unchanged.
 */
export function normaliseForSpeech(text: string): string {
  let out = text
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replaceAll('\u2212', '-');

  // An en or em dash between digits is a range; elsewhere it is punctuation.
  out = out.replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1-$2');

  out = dropFootnoteMarkers(out);
  out = expandVersions(out);
  out = expandIpAddresses(out);
  out = expandIsoDates(out);
  out = expandSlashDates(out);
  out = expandWeekdays(out);
  out = expandTimes(out);
  out = expandQuarters(out);
  out = expandRatiosAndDimensions(out);
  out = expandMoney(out);
  out = expandUnits(out);
  out = expandFractions(out);
  out = expandPhoneNumbers(out);
  out = expandAbbreviations(out);
  out = expandRanges(out);
  out = expandLetteredNumbers(out);
  out = expandRomanNumerals(out);
  out = expandExponents(out);
  out = expandSquareRoots(out);
  out = expandOperatorSymbols(out);
  out = expandSignedNumbers(out);
  out = expandYears(out);
  out = expandOrdinals(out);
  out = expandPlainNumbers(out);

  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
