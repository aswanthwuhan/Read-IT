/**
 * Read IT G2P — English phonemisation for the web Kokoro engine.
 *
 * The pipeline is the Apache-2.0 Misaki port that OpenReader (MIT) uses, see
 * `misaki/PROVENANCE.md` and `assets/LICENSE.txt`:
 *  - `us_gold.json`: Misaki's gold dictionary with part-of-speech variants
 *    ("read" present vs past, "record" noun vs verb), 90k entries.
 *  - `lexicon-en-us.txt`: Read IT's merged Misaki + sherpa-onnx dictionary
 *    (326k entries) as the silver dictionary, so names and technical words the
 *    gold set lacks still resolve.
 *  - `en-us.tsv`: letter-to-sound rules induced from those dictionaries, used
 *    for out-of-vocabulary words instead of spelling them letter by letter.
 *  - number-to-words, plural/-ed/-ing and contraction rules, function-word
 *    forms ("a"/"an"/"the"/"to") and diacritic folding.
 *
 * No espeak-ng, no copyleft code. If the data cannot be fetched (offline first
 * run) a small built-in fallback still speaks numbers and spells OOV words.
 */
import vocabRaw from './vocab.json?raw';
import { G2P } from './misaki/g2p';
import { LetterToSound } from './misaki/letter-to-sound';
import { Lexicon } from './misaki/lexicon';
import type { GoldValue } from './misaki/lexicon';

// The dictionaries use syllabic-consonant and cedilla combining marks that the
// tokenizer vocabulary does not list on its own but accepts attached to a phone.
const VOCAB: Set<string> = new Set([
  ...Object.keys(JSON.parse(vocabRaw).model.vocab),
  '\u0329',
  '\u0327',
]);
const BASE = import.meta.env.BASE_URL;
const LEXICON_URL = `${BASE}lexicon/lexicon-en-us.txt`;
const GOLD_URL = `${BASE}lexicon/us_gold.json`;
const RULES_URL = `${BASE}lexicon/en-us.tsv`;

/** Map the dictionaries' phone spellings onto the Kokoro tokenizer's phone set. */
const PHONE_MAP: Record<string, string> = {
  r: 'ɹ', g: 'ɡ', x: 'k', 'ɬ': 'l', 'ʲ': 'j', 'ʧ': 'tʃ', 'ʤ': 'dʒ',
  'ɡ': 'ɡ', 'ɹ': 'ɹ', 'ː': 'ː', 'ˈ': 'ˈ', 'ˌ': 'ˌ',
};

/** Public-domain NRL-style letter -> phone fallback when the data is unavailable. */
const LETTER_PHONE: Record<string, string> = {
  a: 'ə', b: 'b', c: 'k', d: 'd', e: 'ɛ', f: 'f', g: 'ɡ', h: 'h', i: 'ɪ',
  j: 'dʒ', k: 'k', l: 'l', m: 'm', n: 'n', o: 'ɑ', p: 'p', q: 'k', r: 'ɹ',
  s: 's', t: 't', u: 'ʌ', v: 'v', w: 'w', x: 'ks', y: 'j', z: 'z',
};
const VOWELS = new Set(['ə', 'ɛ', 'ɪ', 'ɑ', 'ʌ', 'æ', 'ɔ', 'ʊ', 'i', 'a', 'o', 'u', 'ɜ', 'ɐ', 'ɒ']);

/** The merged dictionary, keyed lowercase like Misaki's own dictionaries. */
function parseLexicon(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const sep = line.indexOf('||');
    if (sep < 0) continue;
    const word = line.slice(0, sep).trim();
    // Skip multi-word entries; a phrase pronunciation cannot be applied to one
    // word at a time anyway.
    if (!word || /\s/.test(word)) continue;
    // The merged file writes one phone per field ("k ɪ lˈ ɑː ..."); Misaki's
    // own dictionaries hold one continuous string. Strip the separators.
    const phones = line
      .slice(sep + 2)
      .trim()
      .replace(/\s+/gu, '');
    if (!phones) continue;
    const key = word.toLowerCase();
    if (out[key] === undefined) out[key] = phones;
  }
  return out;
}

/** Keep only phonemes the Kokoro tokenizer knows, preserving word spaces. */
function filterVocab(phonemes: string): string {
  let out = '';
  for (const ch of phonemes) {
    if (/\s/.test(ch)) {
      if (out && !out.endsWith(' ')) out += ' ';
      continue;
    }
    const mapped = PHONE_MAP[ch] ?? ch;
    for (const phone of mapped) if (VOCAB.has(phone)) out += phone;
  }
  return out.trim();
}

function spell(word: string): string {
  const out: string[] = [];
  let stressed = false;
  for (const ch of word.toLowerCase()) {
    const phone = LETTER_PHONE[ch];
    if (!phone) continue;
    if (!stressed && VOWELS.has(phone[0])) {
      out.push('ˈ');
      stressed = true;
    }
    out.push(phone);
  }
  return out.join('');
}

const SMALL_NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [
  '', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion',
  'sextillion', 'septillion', 'octillion', 'nonillion', 'decillion',
];

function underThousand(n: number): string[] {
  const out: string[] = [];
  if (n >= 100) {
    out.push(SMALL_NUMBERS[Math.floor(n / 100)], 'hundred');
    n %= 100;
  }
  if (n >= 20) {
    out.push(TENS[Math.floor(n / 10)]);
    if (n % 10) out.push(SMALL_NUMBERS[n % 10]);
  } else if (n > 0) {
    out.push(SMALL_NUMBERS[n]);
  }
  return out;
}

/** Spell a digit-only token as English words when the dictionaries are absent. */
function numberWords(token: string): string[] {
  let value = BigInt(token);
  if (value === 0n) return ['zero'];
  const out: string[] = [];
  let scale = 0;
  while (value > 0n && scale < SCALES.length) {
    const part = Number(value % 1000n);
    if (part > 0) {
      const words = underThousand(part);
      if (scale > 0) words.push(SCALES[scale]);
      out.unshift(...words);
    }
    value /= 1000n;
    scale += 1;
  }
  // Beyond the largest named scale, read the digits individually so the number
  // is still spoken instead of disappearing from the audio.
  if (out.length === 0) return [...token].map((digit) => SMALL_NUMBERS[Number(digit)]);
  return out;
}

/** The pre-data fallback: numbers as words, OOV spelled, no dictionary. */
function fallbackPhonemize(text: string): string {
  const words: string[] = [];
  for (const raw of text.trim().split(/\s+/)) {
    if (!raw) continue;
    const tokens = /^\d+$/.test(raw) ? numberWords(raw) : [raw];
    for (const token of tokens) {
      const key = token.toLowerCase().replace(/[^a-z']/g, '');
      if (!key) continue;
      words.push(filterVocab(spell(key)));
    }
  }
  return words.filter(Boolean).join(' ');
}

let g2pPromise: Promise<G2P | null> | null = null;

async function loadG2P(): Promise<G2P | null> {
  if (!g2pPromise) {
    g2pPromise = (async () => {
      const [silverText, goldText, rulesText] = await Promise.all([
        fetch(LEXICON_URL).then((res) => {
          if (!res.ok) throw new Error(`lexicon HTTP ${res.status}`);
          return res.text();
        }),
        fetch(GOLD_URL).then((res) => {
          if (!res.ok) throw new Error(`gold HTTP ${res.status}`);
          return res.text();
        }),
        fetch(RULES_URL).then((res) => {
          if (!res.ok) throw new Error(`rules HTTP ${res.status}`);
          return res.text();
        }),
      ]);
      const gold = JSON.parse(goldText) as Record<string, GoldValue>;
      const silver = parseLexicon(silverText);
      return new G2P({
        lexicon: new Lexicon({
          british: false,
          data: { gold, silver },
          letterToSound: new LetterToSound(rulesText),
        }),
        // Kokoro's own pipeline drops an unresolvable word rather than reading
        // a marker; the letter-to-sound rules make that rare.
        unk: '',
      });
    })().catch(() => {
      // This call falls back to spelling; a later sentence retries the load.
      g2pPromise = null;
      return null;
    });
  }
  return g2pPromise;
}

/** Convert plain text (no punctuation — the caller strips it) to Kokoro IPA. */
export async function phonemizeWithLexicon(text: string): Promise<string> {
  const g2p = await loadG2P();
  if (g2p) return filterVocab(g2p.phonemize(text).phonemes);
  return fallbackPhonemize(text);
}

/**
 * Pre-tokenised Kokoro phonemes for sherpa-onnx's native TTS path. Sending
 * these instead of raw text gives Android the same pronunciation rules the web
 * engine uses, and skips sherpa's own lexicon frontend for each sentence.
 * Returns null when the dictionaries are not available (offline first run), so
 * the caller can fall back to sending text.
 */
export async function tokensFor(text: string): Promise<string[] | null> {
  const phonemes = await phonemizeWithLexicon(text);
  // Kokoro's vocabulary holds one phoneme (or punctuation mark) per token;
  // phonemizeWithLexicon only spaces words, so split by code point and drop
  // those word separators.
  const tokens = Array.from(phonemes).filter((ch) => ch !== ' ' && VOCAB.has(ch));
  return tokens.length > 0 ? tokens : null;
}

/** Warm the dictionaries in the background so the first sentence is not delayed. */
export function warmLexicon(): void {
  void loadG2P();
}

/** Test hook: drop the cached pipeline so a new fetch stub takes effect. */
export function resetG2PForTests(): void {
  g2pPromise = null;
}
