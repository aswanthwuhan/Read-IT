import { describe, expect, it } from 'vitest';
import { decodeText } from './charset';

function bytesOf(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** windows-1251 has Cyrillic А–я at 0xC0–0xFF, in code-point order. */
function cp1251(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code === 0x401) out.push(0xa8);
    else if (code === 0x451) out.push(0xb8);
    else if (code >= 0x410 && code <= 0x44f) out.push(code - 0x410 + 0xc0);
    else out.push(0x3f);
  }
  return new Uint8Array(out);
}

/** The handful of windows-1252 code points used in the fixture. */
const CP1252: Record<string, number> = { é: 0xe9, è: 0xe8, à: 0xe0, ï: 0xef, '—': 0x97 };

function cp1252(text: string): Uint8Array {
  return new Uint8Array([...text].map((ch) => CP1252[ch] ?? ch.charCodeAt(0)));
}

describe('decodeText', () => {
  it('reads UTF-8 with a byte-order mark', async () => {
    expect(await decodeText(bytesOf([0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xc3, 0xa9]))).toBe('café');
  });

  it('reads UTF-16LE with a byte-order mark', async () => {
    expect(await decodeText(bytesOf([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]))).toBe('AB');
  });

  it('reads plain UTF-8 without a mark', async () => {
    const bytes = new TextEncoder().encode('Thiazides act on the distal tubule.');
    expect(await decodeText(bytes)).toBe('Thiazides act on the distal tubule.');
  });

  it('recovers windows-1251 Cyrillic instead of mojibake', async () => {
    const text = 'Привет мир. Это проверка кодировки текста, чтобы определить её правильно.';
    expect(await decodeText(cp1251(text))).toBe(text);
  });

  it('recovers windows-1252 accents', async () => {
    const text = 'Le café était très naïf — voilà pourquoi on écrit à la main.';
    expect(await decodeText(cp1252(text))).toBe(text);
  });

  it('returns an empty string for an empty file', async () => {
    expect(await decodeText(bytesOf([]))).toBe('');
  });

  it('accepts an ArrayBuffer', async () => {
    const bytes = new TextEncoder().encode('plain');
    expect(await decodeText(bytes.buffer as ArrayBuffer)).toBe('plain');
  });
});
