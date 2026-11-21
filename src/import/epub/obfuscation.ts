/**
 * Embedded-font de-obfuscation for EPUB.
 *
 * Follows EPUB 3.3 §4.4.3 (Obfuscation), which retains the IDPF scheme from the
 * EPUB 2.0.1 Font Mangling Specification, plus the legacy Adobe scheme that
 * EPUB 2 reading systems supported:
 *
 * - IDPF: key = SHA-1 of the publication unique identifier encoded as UTF-8,
 *   with leading and trailing whitespace removed. XOR the first 1040 bytes of
 *   the font with the 20-byte key repeated.
 * - Adobe: key = SHA-1 of the UUID bytes (16) taken from the identifier's 32
 *   hex digits. XOR the first 1024 bytes with the key repeated.
 *
 * Both operations are involutions: obfuscating and de-obfuscating are the same
 * XOR, so a caller can use this for either direction.
 */

export type ObfuscationAlgorithm = 'idpf' | 'adobe';

/** Values of the `EncryptedData/EncryptionMethod@Algorithm` attribute. */
const IDPF_URI = 'http://www.idpf.org/2008/embedding';
const ADOBE_URI = 'http://ns.adobe.com/pdf/enc#RC';

const IDPF_WINDOW = 1040;
const ADOBE_WINDOW = 1024;

/**
 * The attribute is an exact URI in encryption.xml. EPUB 3.3 §4.4.3 also allows
 * other algorithms, so anything we cannot handle maps to null rather than
 * throwing: the caller decides whether to skip the resource or fail the import.
 */
export function algorithmFromUri(uri: string): ObfuscationAlgorithm | null {
  switch (uri) {
    case IDPF_URI:
      return 'idpf';
    case ADOBE_URI:
      return 'adobe';
    default:
      return null;
  }
}

async function sha1(bytes: Uint8Array): Promise<Uint8Array> {
  // WebCrypto's DOM type excludes SharedArrayBuffer-backed views; a small copy
  // gives it a plain ArrayBuffer without narrowing every caller.
  const input = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-1', input);
  return new Uint8Array(digest);
}

function xorWindow(data: Uint8Array, key: Uint8Array, windowLength: number): Uint8Array {
  // Copy first: the caller's buffer may be a view the reader still holds.
  const out = new Uint8Array(data);
  // A file shorter than the window is obfuscated only up to its own length;
  // §4.4.3 assumes a well-formed font, but truncated files occur in the wild.
  const limit = Math.min(windowLength, out.length);
  for (let i = 0; i < limit; i++) {
    out[i] ^= key[i % key.length];
  }
  return out;
}

/**
 * Adobe does not hash: the key is the publication identifier's 16 UUID bytes.
 * Real package documents write it as `urn:uuid:...`, bare hex, or the hex in
 * braces with hyphens, so accept the common spellings.
 */
function adobeUuidBytes(identifier: string): Uint8Array {
  const hex = identifier
    .trim()
    .replace(/^urn:uuid:/i, '')
    .replace(/[{}\s-]/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    // Guessing a key would silently corrupt the glyphs, so fail loudly; the
    // alternative is a font that loads but renders as garbage.
    throw new Error('Adobe font obfuscation requires a 32-hex-digit UUID identifier');
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function deobfuscateFont(
  data: Uint8Array,
  identifier: string,
  algorithm: ObfuscationAlgorithm,
): Promise<Uint8Array> {
  if (algorithm === 'idpf') {
    // §4.4.3: every whitespace character is removed before hashing (not just the
    // ends), and what remains is hashed exactly as written — its case and URN
    // prefix are significant.
    const key = await sha1(new TextEncoder().encode(identifier.replace(/[\u0020\u0009\u000a\u000d]/g, '')));
    return xorWindow(data, key, IDPF_WINDOW);
  }

  return xorWindow(data, adobeUuidBytes(identifier), ADOBE_WINDOW);
}
