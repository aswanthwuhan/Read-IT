/**
 * Text splitting that keeps a Kokoro synthesis inside the model's input window.
 *
 * `kokoro-js` tokenizes with `truncation: true` (510 phoneme tokens), so handing
 * it a whole sentence means everything past that limit is dropped before the
 * model sees it: the audio simply stops there and the listener hears the voice
 * trail off, mumble, or lose its last words. Measured on the fp32 model, a
 * 110-word sentence rendered 26.45 s while the same text in two halves rendered
 * 31.85 s — 5.4 s (17%) of it was never synthesised.
 *
 * The budgets are measured against the same eSpeak build kokoro-js uses, over
 * every long sentence in the books plus the worst cases from the
 * first sweep (17 504 sentences, 19 464 pieces):
 * prose costs ~1.2 tokens per character, but a *digit* becomes a whole number
 * word and a URL is spelled letter by letter, so a character cap alone is not
 * safe. At 380 characters a chunk of OCR'd number columns measured 1 546 tokens
 * and a 378-character line of reference URLs 716, both silently losing their
 * endings — the very bug this file exists to fix. With the budgets below the
 * worst piece measured 594 tokens and only 2 of the 19 464 pieces were over the
 * window; both are the same reference line of URLs, which no character budget
 * separates from prose because every letter of it is spelled out.
 *
 * The native Kokoro engine and Pocket split sentences with `clauseChunk`; the
 * web engine had no splitting at all, which is why only the web build trailed
 * off at the end of long sentences. The native engine knows the real token
 * counts (`splitForModelByTokens`), so it cuts on measured tokens instead of
 * these character/digit/word proxies.
 */
import { wordTokenCounts } from '../kokoro/g2p/index';
import { splitIntoClauses } from './clauseChunk';

/** Phoneme tokens one `generate()` call can hold; kokoro-js truncates at 510. */
export const MODEL_TOKEN_LIMIT = 510;

/**
 * Characters per chunk. 320 characters of prose is ~390 tokens, which leaves
 * room for long drug names and Greek letters; 380 was too long (see above).
 */
export const MAX_CHUNK_CHARS = 320;

/**
 * Digits per chunk. A digit is not one token: espeak reads "11121314" as a string
 * of number words, so eight characters can cost forty tokens. Digit runs are what
 * put the measured 380-character chunks over the window, so they get their own
 * budget instead of being counted as ordinary characters.
 */
export const MAX_CHUNK_DIGITS = 16;

/** Words per chunk. Drug names cost far more tokens per word than prose does. */
export const MAX_CHUNK_WORDS = 40;

/** Kokoro's own rate; only used when there is nothing to generate (blank text). */
const KOKORO_SAMPLE_RATE = 24000;

function countDigits(text: string): number {
  let count = 0;
  for (const ch of text) if (ch >= '0' && ch <= '9') count++;
  return count;
}

/** Whether the model can hold `chunk` in one call. */
export function fitsModelWindow(chunk: string): boolean {
  return chunk.length <= MAX_CHUNK_CHARS && countDigits(chunk) <= MAX_CHUNK_DIGITS;
}

/**
 * Wrap a chunk whose words alone outrun the budgets, never splitting a word: a
 * cut inside a word is unpronounceable, while a cut between words is a breath.
 * A single word longer than the budget is kept whole (no English word is).
 */
function wrapByBudget(chunk: string): string[] {
  if (fitsModelWindow(chunk)) return [chunk];
  const parts: string[] = [];
  let current = '';
  for (const word of chunk.split(' ')) {
    if (current === '') current = word;
    else if (fitsModelWindow(`${current} ${word}`)) current = `${current} ${word}`;
    else {
      parts.push(current);
      current = word;
    }
  }
  if (current !== '') parts.push(current);
  return parts;
}

/**
 * Split one sentence into pieces the model can hold. A sentence that already
 * fits comes back untouched, so short text costs nothing extra.
 *
 * Chunks are filled towards the word budget rather than shortened: the web
 * engine synthesises a whole sentence before it plays any of it, so a short
 * first chunk wins no latency (unlike the streaming native engine), while every
 * extra chunk is another model call. Half a budget still lets a comma early in
 * a long sentence become the seam instead of a mid-clause wrap.
 */
export function splitForModel(text: string): string[] {
  const normalised = text.trim().replace(/\s+/g, ' ');
  if (normalised === '') return [];
  const clauses = splitIntoClauses(normalised, {
    maxWords: MAX_CHUNK_WORDS,
    minWords: MAX_CHUNK_WORDS / 2,
  });
  return clauses.flatMap(wrapByBudget);
}

/**
 * Tokens one native `Kokoro.synthesize()` call is aimed at: the 510-token window
 * minus a margin, so the clause the engine measures after the split still fits.
 */
export const NATIVE_TOKEN_BUDGET = 480;

/** Per-word Kokoro token counts; `wordTokenCounts` in the app, a stub in tests. */
export type WordTokenCounter = (text: string) => Promise<number[] | null>;

/**
 * Split one sentence by its real phoneme-token count, for the native engine.
 *
 * The web budgets above cannot see pronunciation: "11121314" is eight characters
 * but forty tokens, and a URL is spelled letter by letter, so a character cap
 * either truncates or over-splits. Sherpa-onnx exposes the same 510-token window,
 * so measuring `tokensFor` is both safe and cheaper: a sentence under the budget
 * stays one call. Only when it is over does the text split at clause seams, then
 * between words if a single clause is still too long — never inside a word.
 *
 * Returns `splitForModel`'s pieces when the dictionaries are not loaded
 * (`tokensFor` → null), so an offline first run still gets a usable split.
 */
export async function splitForModelByTokens(
  text: string,
  tokenBudget = NATIVE_TOKEN_BUDGET,
  countWords: WordTokenCounter = wordTokenCounts
): Promise<string[]> {
  const normalised = text.trim().replace(/\s+/g, ' ');
  if (normalised === '') return [];
  const counts = await countWords(normalised);
  // The counter is one phonemisation of the whole sentence, not one per
  // candidate clause: the Misaki tagger is the expensive part.
  if (!counts) return splitForModel(normalised);

  const words = normalised.split(' ');
  // A G2P tokenizer that groups words differently is not a splitter we can
  // trust for offsets; fall back rather than cut inside a word.
  if (counts.length !== words.length) return splitForModel(normalised);

  const prefix: number[] = [0];
  for (const count of counts) prefix.push(prefix[prefix.length - 1]! + count);
  const total = prefix[prefix.length - 1]!;
  // The common case: one model call, exactly as before token splitting.
  if (total <= tokenBudget) return [normalised];

  const pieces: string[] = [];
  let start = 0;
  while (start < words.length) {
    // Longest run of whole words that fits the budget.
    let end = start + 1;
    while (end < words.length && prefix[end + 1]! - prefix[start]! <= tokenBudget) end += 1;
    // Prefer a clause seam (the word before it keeps its punctuation) when it
    // still fills at least half the budget; otherwise cut between words.
    let cut = end;
    for (let candidate = end; candidate > start + 1; candidate -= 1) {
      if (!/[.,;:!?…—–-]$/.test(words[candidate - 1]!)) continue;
      if (prefix[candidate]! - prefix[start]! >= tokenBudget / 2) {
        cut = candidate;
        break;
      }
    }
    pieces.push(words.slice(start, cut).join(' '));
    start = cut;
  }
  return pieces;
}

/** One generated piece and the sample rate it came back at. */
export interface PieceAudio {
  audio: Float32Array;
  sampleRate: number;
}

/**
 * Generate `text` piece by piece, in order, and hand back the pieces.
 *
 * `cancelled()` is checked between pieces: a stopped utterance must not spend
 * seconds synthesising audio nobody will hear, and the caller must post
 * `stopped` rather than a result — a result for a superseded request plays over
 * the sentence that replaced it. Returns `null` when it was cancelled.
 */
export async function generateInPieces(
  text: string,
  generate: (piece: string) => Promise<PieceAudio>,
  cancelled: () => boolean = () => false
): Promise<{ parts: Float32Array[]; sampleRate: number } | null> {
  const parts: Float32Array[] = [];
  let sampleRate = KOKORO_SAMPLE_RATE;
  for (const piece of splitForModel(text)) {
    const generated = await generate(piece);
    parts.push(generated.audio);
    sampleRate = generated.sampleRate;
    if (cancelled()) return null;
  }
  return { parts, sampleRate };
}
