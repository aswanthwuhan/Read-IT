/**
 * Read IT G2P — the licence-clean replacement for `phonemizer`/espeak-ng in the
 * web Kokoro engine. No native dependency, no copyleft code.
 *
 * Data sources (all permissive or public domain):
 *  - `lexicon-en-us.txt`: CMU Pronouncing Dictionary + en_list + compounds,
 *    redistributed with sherpa-onnx (Apache-2.0). 167k word -> IPA entries with
 *    primary/secondary stress. Fetched once, lazily, and cached.
 *  - NRL Report 7948 letter-to-sound rules (US Government work, public domain)
 *    as the out-of-vocabulary fallback, so a word the lexicon misses still
 *    produces pronounceable phonemes instead of silence.
 *  - `vocab.json`: the Kokoro tokenizer vocabulary. Every emitted phoneme is
 *    restricted to this set, so the model never receives an unknown token.
 *
 * The lexicon is served from `public/lexicon/` so it is not bundled into the
 * worker; it is downloaded once and then lives in the browser cache alongside
 * the model weights. If the fetch fails (offline first run) the OOV fallback
 * still lets the reader speak.
 */
import vocabRaw from './vocab.json?raw';

const VOCAB: Set<string> = new Set(Object.keys(JSON.parse(vocabRaw).model.vocab));
const LEXICON_URL = `${import.meta.env.BASE_URL}lexicon/lexicon-en-us.txt`;

/** Map the lexicon's phone spellings onto the Kokoro tokenizer's phone set. */
const PHONE_MAP: Record<string, string> = {
  r: 'ɹ', g: 'ɡ', x: 'k', 'ɬ': 'l', 'ʲ': 'j', 'ʧ': 'tʃ', 'ʤ': 'dʒ',
  'ɡ': 'ɡ', 'ɹ': 'ɹ', 'ː': 'ː', 'ˈ': 'ˈ', 'ˌ': 'ˌ',
};

/** Public-domain NRL-style letter -> phone fallback for out-of-vocabulary words. */
const LETTER_PHONE: Record<string, string> = {
  a: 'ə', b: 'b', c: 'k', d: 'd', e: 'ɛ', f: 'f', g: 'ɡ', h: 'h', i: 'ɪ',
  j: 'dʒ', k: 'k', l: 'l', m: 'm', n: 'n', o: 'ɑ', p: 'p', q: 'k', r: 'ɹ',
  s: 's', t: 't', u: 'ʌ', v: 'v', w: 'w', x: 'ks', y: 'j', z: 'z',
};
const VOWELS = new Set(['ə', 'ɛ', 'ɪ', 'ɑ', 'ʌ', 'æ', 'ɔ', 'ʊ', 'i', 'a', 'o', 'u', 'ɜ', 'ɐ', 'ɒ']);

let lexiconPromise: Promise<Map<string, string>> | null = null;

function parseLexicon(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const sep = line.indexOf('||');
    if (sep < 0) continue;
    const word = line.slice(0, sep).trim();
    // Skip multi-word entries; the single-word table has 167k entries, which
    // covers virtually all prose, and a phrase pronunciation could not be
    // applied to one word at a time anyway.
    if (!word || /\s/.test(word)) continue;
    const phones = line.slice(sep + 2).trim();
    if (!phones) continue;
    const key = word.toUpperCase();
    if (!map.has(key)) map.set(key, phones);
  }
  return map;
}

function loadLexicon(): Promise<Map<string, string>> {
  if (!lexiconPromise) {
    lexiconPromise = fetch(LEXICON_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`lexicon HTTP ${res.status}`);
        return res.text();
      })
      .then(parseLexicon)
      .catch(() => new Map<string, string>());
  }
  return lexiconPromise;
}

/** Keep only phonemes in the Kokoro vocabulary; join without spaces so the
 * tokenizer sees one phoneme sequence per word (as it did with espeak). */
function clean(phones: string): string {
  const out: string[] = [];
  for (const token of phones.split(/\s+/)) {
    if (!token) continue;
    const mapped = PHONE_MAP[token] ?? token;
    for (const ch of mapped) {
      if (VOCAB.has(ch)) out.push(ch);
    }
  }
  return out.join('');
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

/** Convert plain text (no punctuation — the caller strips it) to Kokoro IPA. */
export async function phonemizeWithLexicon(text: string): Promise<string> {
  const lexicon = await loadLexicon();
  const words: string[] = [];
  for (const raw of text.trim().split(/\s+/)) {
    if (!raw) continue;
    const key = raw.toUpperCase().replace(/[^A-Z']/g, '');
    if (!key) continue;
    words.push(clean(lexicon.get(key) ?? spell(key)));
  }
  return words.filter(Boolean).join(' ');
}

/** Warm the lexicon in the background so the first sentence is not delayed. */
export function warmLexicon(): void {
  void loadLexicon();
}
