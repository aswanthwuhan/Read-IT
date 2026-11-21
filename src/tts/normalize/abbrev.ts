import { spellNumberText } from './numbers';

// Each numbered reference is handled with its number so the generic number
// pass never sees an orphaned digit ("Ch. 4" must not become "Ch. four").
const REFERENCE_WORDS: Record<string, string> = {
  Ch: 'chapter',
  Fig: 'figure',
  Eq: 'equation',
  Sec: 'section',
  No: 'number',
};

function numberWords(text: string): string | null {
  return spellNumberText(text);
}

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * Re-cases an expansion that opens a sentence. Bare fragments at the start of
 * the input ("Ch. 4") keep the shipped lower-case form; a capital is only
 * needed once the expansion is part of a sentence.
 */
function sentenceCase(match: string, expansion: string, whole: string, offset: number): string {
  const before = whole.slice(0, offset);
  const after = whole.slice(offset + match.length);
  const startsSentence = offset === 0 || /(?:\n[ \t]*|[.?!][ \t]+)$/.test(before);
  if (!startsSentence) return expansion;
  if (offset === 0 && after.trim() === '') return expansion;

  const sourceHasCapital = /^[A-Z]/.test(match);
  const finishesSentence = /[.?!]/.test(after);
  // A lower-case abbreviation in an unterminated fragment stays lower-case,
  // matching the long-standing "e.g. this" reading.
  if (offset === 0 && !sourceHasCapital && !finishesSentence) return expansion;
  return capitalised(expansion);
}

export function expandAbbreviations(text: string): string {
  let out = text
    .replace(
      /\be\.g\.,?\s*/gi,
      (match, offset: number, whole: string) => sentenceCase(match, 'for example ', whole, offset),
    )
    .replace(
      /\bi\.e\.,?\s*/gi,
      (match, offset: number, whole: string) => sentenceCase(match, 'that is ', whole, offset),
    )
    .replace(
      /\bvs\.?(?=\s|$)/gi,
      (match, offset: number, whole: string) => sentenceCase(match, 'versus', whole, offset),
    )
    .replace(
      /\bapprox\.(?=\s|$)/gi,
      (match, offset: number, whole: string) => sentenceCase(match, 'approximately', whole, offset),
    )
    .replace(
      /\bw\/o\b/gi,
      (match, offset: number, whole: string) => sentenceCase(match, 'without', whole, offset),
    )
    .replace(
      /\bw\//gi,
      (match, offset: number, whole: string) => sentenceCase(match, 'with', whole, offset),
    );

  // "Oxford St." is a street; "St. Mary" is a saint. The surrounding word
  // decides, and anything else is left alone under the ambiguity rule.
  out = out
    .replace(
      /\b([A-Z][a-z]+)\s+St\.(?=\s|$)/g,
      (match, place: string, offset: number, whole: string) =>
        sentenceCase(match, `${place} Street`, whole, offset),
    )
    .replace(
      /\bSt\.\s+(?=[A-Z])/g,
      (match, offset: number, whole: string) => sentenceCase(match, 'Saint ', whole, offset),
    )
    .replace(
      /\bDr\./g,
      (match, offset: number, whole: string) => sentenceCase(match, 'Doctor', whole, offset),
    );

  out = out.replace(
    /\b(pp|p)\.\s*(\d+)(?:\s*-\s*(\d+))?/g,
    (match, cue: string, first: string, second: string | undefined, offset: number, whole: string) => {
      const firstWord = numberWords(first);
      if (firstWord === null) return match;
      const label = cue === 'pp' ? 'pages' : 'page';
      if (second === undefined) return sentenceCase(match, `${label} ${firstWord}`, whole, offset);
      const secondWord = numberWords(second);
      if (secondWord === null) return match;
      return sentenceCase(match, `${label} ${firstWord} to ${secondWord}`, whole, offset);
    },
  );

  return out.replace(
    /\b(Ch|Fig|Eq|Sec|No)\.\s*(\d+)(?:\s*-\s*(\d+))?/g,
    (match, cue: string, first: string, second: string | undefined, offset: number, whole: string) => {
      const firstWord = numberWords(first);
      if (firstWord === null) return match;
      const label = REFERENCE_WORDS[cue] ?? cue.toLowerCase();
      if (second === undefined) return sentenceCase(match, `${label} ${firstWord}`, whole, offset);
      const secondWord = numberWords(second);
      if (secondWord === null) return match;
      return sentenceCase(match, `${label} ${firstWord} to ${secondWord}`, whole, offset);
    },
  );
}
