import { describe, expect, it } from 'vitest';
import { mapNormalised } from './speechMap';

/** Every entry points into the original, and the map never runs backwards. */
function expectWellFormed(original: string, normalised: string, map: number[]): void {
  expect(map).toHaveLength(normalised.length);
  const last = Math.max(0, original.length - 1);
  let previous = 0;
  for (const at of map) {
    expect(Number.isInteger(at)).toBe(true);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThanOrEqual(last);
    expect(at).toBeGreaterThanOrEqual(previous);
    previous = at;
  }
}

describe('mapNormalised', () => {
  it('maps identical strings to their own indices', () => {
    expect(mapNormalised('abc', 'abc')).toEqual([0, 1, 2]);
    const sentence = 'The cat sat.';
    expect(mapNormalised(sentence, sentence)).toEqual(sentence.split('').map((_, i) => i));
  });

  it('anchors a fraction expansion to its source digit', () => {
    const original = '1/2 of it';
    const normalised = 'one half of it';
    const map = mapNormalised(original, normalised);
    expectWellFormed(original, normalised, map);

    // The untouched tail points at the real characters on the page.
    const spokenAt = normalised.indexOf('of it');
    const sourceAt = original.indexOf('of it');
    expect(spokenAt).toBeGreaterThanOrEqual(0);
    expect(sourceAt).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 'of it'.length; i += 1) {
      expect(map[spokenAt + i]).toBe(sourceAt + i);
    }

    // The words replacing "/2" all belong to the digit at the start. The space
    // that joins the expansion to "of it" is the source space itself (index 3),
    // so it is checked with the tail rather than as an expansion character.
    const digit = original.indexOf('1');
    for (let i = 0; i < spokenAt; i += 1) {
      if (normalised[i] === ' ') continue;
      expect(map[i]).toBe(digit);
    }
    expect(map[spokenAt - 1]).toBe(original.indexOf(' '));
  });

  it('anchors an expansion in the middle of a sentence to the digit', () => {
    const original = 'a 5 b';
    const normalised = 'a five b';
    const map = mapNormalised(original, normalised);
    expectWellFormed(original, normalised, map);
    const digit = original.indexOf('5');
    const five = normalised.indexOf('five');
    for (let i = 0; i < 'five'.length; i += 1) {
      expect(map[five + i]).toBe(digit);
    }
    expect(map[normalised.indexOf('b')]).toBe(original.indexOf('b'));
  });

  it('keeps an expansion local when its words repeat a character of the sentence', () => {
    // Edit distance alone ties: the "t" of "cost" can be paired with the "t"
    // of "two" as cheaply as with its own "t". The tie-break must keep the
    // expansion on the digits and leave the untouched words on themselves.
    const original = 'It cost €1.2bn.';
    const normalised = 'It cost one point two billion euros.';
    const map = mapNormalised(original, normalised);
    expectWellFormed(original, normalised, map);

    for (let i = 0; i < 'It cost'.length; i += 1) expect(map[i]).toBe(i);
    const one = normalised.indexOf('one point two');
    expect(one).toBeGreaterThan(0);
    for (let i = 0; i < 'one point two'.length; i += 1) {
      if (normalised[one + i] === ' ') continue;
      expect(map[one + i], `one point two[${i}]`).toBeGreaterThanOrEqual(original.indexOf('€'));
      expect(map[one + i], `one point two[${i}]`).toBeLessThan(original.indexOf('bn'));
    }
    expect(map[normalised.indexOf('euros')]).toBeGreaterThanOrEqual(original.indexOf('b'));
    expect(map[normalised.lastIndexOf('.')]).toBe(original.lastIndexOf('.'));
  });

  it('maps a late expansion to its own source, not index 0', () => {
    const original = 'Doses of 1 and 2 and 3 were compared.';
    const normalised = 'Doses of one and two and three were compared.';
    const map = mapNormalised(original, normalised);
    expectWellFormed(original, normalised, map);
    const three = normalised.indexOf('three');
    expect(map[three]).toBe(original.indexOf('3'));
    expect(map[three]).toBeGreaterThan(0);
  });

  it('aligns a 400-character sentence within a fraction of a frame', () => {
    // Worst case for the O(n·m) table: a long sentence whose every number
    // expands. This runs once per sentence at chapter-plan time, not on the
    // playback clock; a generous bound only catches a catastrophic regression.
    const original = '1 '.repeat(200).trim();
    const normalised = 'one '.repeat(200).trim();
    expect(original.length).toBe(399);
    const started = performance.now();
    const map = mapNormalised(original, normalised);
    const elapsed = performance.now() - started;
    expectWellFormed(original, normalised, map);
    expect(elapsed).toBeLessThan(1000);
  });

  it('skips deleted characters', () => {
    const original = 'word¹²';
    const normalised = 'word';
    const map = mapNormalised(original, normalised);
    expect(map).toEqual([0, 1, 2, 3]);
    expectWellFormed(original, normalised, map);
  });

  it('stays in range and monotonic for awkward inputs', () => {
    const pairs: Array<[string, string]> = [
      ['', ''],
      ['', 'anything'],
      ['anything', ''],
      ['abc', 'xabc'],
      ['abc', 'abcx'],
      ['xabc', 'abc'],
      ['Dr. Smith', 'Doctor Smith'],
      ['It cost €1.2bn.', 'It cost one point two billion euros.'],
      ['  trimmed  ', 'trimmed'],
    ];
    for (const [original, normalised] of pairs) {
      expectWellFormed(original, normalised, mapNormalised(original, normalised));
    }
  });
});
