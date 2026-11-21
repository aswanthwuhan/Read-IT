import { createHash, webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { algorithmFromUri, deobfuscateFont } from './obfuscation';

const IDPF_URI = 'http://www.idpf.org/2008/embedding';
const ADOBE_URI = 'http://ns.adobe.com/pdf/enc#RC';
const IDPF_WINDOW = 1040;
const ADOBE_WINDOW = 1024;
const UUID_URN = 'urn:uuid:279f39a4-9b7b-4c0c-8a3f-72a22b9f7a51';
const UUID_HEX = '279f39a49b7b4c0c8a3f72a22b9f7a51';

beforeAll(() => {
  // jsdom exposes Crypto.getRandomValues but no SubtleCrypto; the module hashes
  // through globalThis.crypto.subtle, so lend it Node's WebCrypto.
  if (!globalThis.crypto.subtle) {
    vi.stubGlobal('crypto', webcrypto);
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** 2000 deterministic bytes: long enough to straddle either XOR window. */
function fakeFont(length = 2000): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = (i * 37 + 11) & 0xff;
  }
  return bytes;
}

function sha1(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha1').update(bytes).digest());
}

function hexBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function idpfKey(identifier: string): Uint8Array {
  // §4.4.3 removes every whitespace character before hashing.
  return sha1(new TextEncoder().encode(identifier.replace(/[\u0020\u0009\u000a\u000d]/g, '')));
}

/** Adobe's key is the UUID itself: no hash, sixteen bytes. */
function adobeKey(uuidHex: string): Uint8Array {
  return hexBytes(uuidHex);
}

/**
 * The test's own obfuscator: XOR is its own inverse, but the key material and
 * the window are derived here rather than borrowed from the module.
 */
function obfuscate(data: Uint8Array, key: Uint8Array, windowLength: number): Uint8Array {
  const out = new Uint8Array(data);
  const limit = Math.min(windowLength, out.length);
  for (let i = 0; i < limit; i++) {
    out[i] ^= key[i % key.length];
  }
  return out;
}

describe('algorithmFromUri', () => {
  it('maps the IDPF algorithm URI', () => {
    expect(algorithmFromUri(IDPF_URI)).toBe('idpf');
  });

  it('maps the Adobe algorithm URI', () => {
    expect(algorithmFromUri(ADOBE_URI)).toBe('adobe');
  });

  it('returns null for an unknown algorithm URI', () => {
    expect(algorithmFromUri('http://example.com/2008/other')).toBeNull();
    expect(algorithmFromUri('')).toBeNull();
  });
});

describe('deobfuscateFont', () => {
  it('round-trips the IDPF scheme and only touches the first 1040 bytes', async () => {
    const original = fakeFont();
    const key = idpfKey(UUID_URN);
    // A zero key byte would leave its position unchanged and weaken the check.
    expect(key.every((byte) => byte !== 0)).toBe(true);

    const obfuscated = obfuscate(original, key, IDPF_WINDOW);
    const restored = await deobfuscateFont(obfuscated, UUID_URN, 'idpf');

    expect(Array.from(restored)).toEqual(Array.from(original));
    for (let i = 0; i < IDPF_WINDOW; i++) {
      expect(restored[i]).not.toBe(obfuscated[i]);
    }
    expect(Array.from(restored.slice(IDPF_WINDOW))).toEqual(
      Array.from(obfuscated.slice(IDPF_WINDOW)),
    );
  });

  it('round-trips the Adobe scheme and only touches the first 1024 bytes', async () => {
    const original = fakeFont();
    const key = adobeKey(UUID_HEX);
    expect(key.every((byte) => byte !== 0)).toBe(true);

    const obfuscated = obfuscate(original, key, ADOBE_WINDOW);
    const restored = await deobfuscateFont(obfuscated, UUID_URN, 'adobe');

    expect(Array.from(restored)).toEqual(Array.from(original));
    for (let i = 0; i < ADOBE_WINDOW; i++) {
      expect(restored[i]).not.toBe(obfuscated[i]);
    }
    expect(Array.from(restored.slice(ADOBE_WINDOW))).toEqual(
      Array.from(obfuscated.slice(ADOBE_WINDOW)),
    );
  });

  it('reads a bare UUID and a braced UUID for the Adobe key', async () => {
    const original = fakeFont(64);
    const key = adobeKey(UUID_HEX);
    const obfuscated = obfuscate(original, key, ADOBE_WINDOW);

    for (const identifier of [UUID_HEX, `{${UUID_HEX}}`]) {
      const restored = await deobfuscateFont(obfuscated, identifier, 'adobe');
      expect(Array.from(restored)).toEqual(Array.from(original));
    }
  });

  it('removes all whitespace from the IDPF identifier', async () => {
    const original = fakeFont(64);
    // A producer following §4.4.3 hashes the identifier with every space, tab and
    // newline removed; if the reader only trims, the keys differ and the font
    // stays garbled.
    const obfuscated = obfuscate(original, idpfKey('book42'), 64);
    const restored = await deobfuscateFont(obfuscated, ' \tbook 42\n ', 'idpf');
    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  it.each(['idpf', 'adobe'] as const)('handles %s files shorter than the window', async (algorithm) => {
    for (const length of [0, 10, IDPF_WINDOW - 1]) {
      const original = fakeFont(length);
      const key = algorithm === 'idpf' ? idpfKey(UUID_URN) : adobeKey(UUID_HEX);
      const obfuscated = obfuscate(original, key, algorithm === 'idpf' ? IDPF_WINDOW : ADOBE_WINDOW);

      const restored = await deobfuscateFont(obfuscated, UUID_URN, algorithm);
      expect(restored.length).toBe(length);
      expect(Array.from(restored)).toEqual(Array.from(original));
      expect(restored).not.toBe(obfuscated);
    }
  });

  it.each(['idpf', 'adobe'] as const)('does not mutate the input array (%s)', async (algorithm) => {
    const original = fakeFont();
    const key = algorithm === 'idpf' ? idpfKey(UUID_URN) : adobeKey(UUID_HEX);
    const obfuscated = obfuscate(original, key, algorithm === 'idpf' ? IDPF_WINDOW : ADOBE_WINDOW);
    const snapshot = Uint8Array.from(obfuscated);

    const restored = await deobfuscateFont(obfuscated, UUID_URN, algorithm);

    expect(Array.from(obfuscated)).toEqual(Array.from(snapshot));
    expect(restored).not.toBe(obfuscated);
  });

  it('rejects an Adobe identifier without a UUID', async () => {
    await expect(deobfuscateFont(fakeFont(32), 'not-a-uuid', 'adobe')).rejects.toThrow(
      /32-hex-digit UUID/,
    );
  });
});
