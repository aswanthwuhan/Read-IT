import { describe, expect, it } from 'vitest';
import { FIXTURES } from './fixtures';
import { normaliseForSpeech } from './index';

describe('normaliseForSpeech', () => {
  for (const fixture of FIXTURES) {
    it(`expands ${JSON.stringify(fixture.input)}`, () => {
      expect(normaliseForSpeech(fixture.input)).toBe(fixture.expected);
    });
  }
});

describe('normaliseForSpeech invariants', () => {
  it('is idempotent over every fixture', () => {
    for (const fixture of FIXTURES) {
      const once = normaliseForSpeech(fixture.input);
      expect(normaliseForSpeech(once), fixture.input).toBe(once);
    }
  });

  it('leaves no ASCII digits in any fixture output', () => {
    for (const fixture of FIXTURES) {
      expect(normaliseForSpeech(fixture.input), fixture.input).not.toMatch(/[0-9]/);
    }
  });
});
