/**
 * Decoding a text file whose encoding is not declared.
 *
 * Text files are the one format with no metadata: a Russian novel saved as
 * windows-1251 and a Japanese one in Shift-JIS both arrive as bytes. Decoding
 * them as UTF-8 replaces every high byte with U+FFFD, which is what "cp1251
 * imports as mojibake" looked like. A byte-order mark settles the question when
 * present; otherwise `chardet` scores the usual suspects.
 */

/** BOMs are checked by hand because chardet can miss a two-byte one. */
function bomEncoding(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

/**
 * WHATWG names differ from the labels chardet reports (`ISO-8859-1` is really
 * windows-1252 on the web, `KOI8-R` is `koi8-r`). TextDecoder itself is the
 * authority on what it accepts, so unsupported labels fall back to UTF-8.
 */
function decoderFor(label: string): TextDecoder | null {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
}

export async function decodeText(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) return '';

  const bom = bomEncoding(bytes);
  if (bom) return new TextDecoder(bom).decode(bytes);

  // UTF-8 is by far the common case; `fatal` makes it a decision rather than a
  // guess, because invalid sequences throw instead of becoming U+FFFD.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8: ask for the most likely legacy encoding. Loaded here rather
    // than imported up front so UTF-8 files never pay for the detector.
  }

  const { detect } = await import('chardet');
  const guess = detect(bytes);
  if (guess) {
    const decoder = decoderFor(guess);
    if (decoder) return decoder.decode(bytes);
  }

  // Unknown high bytes: windows-1252 at least keeps every character distinct and
  // reversible, where UTF-8 would turn them all into the same replacement glyph.
  return new TextDecoder('windows-1252').decode(bytes);
}
