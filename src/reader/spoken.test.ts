import { describe, expect, it, vi } from 'vitest';
import * as normalize from '../tts/normalize';
import { speakPlan, spokenText, type SpeakOptions } from './spoken';

const CITATIONS: SpeakOptions = { citations: true, brackets: 'read' };
const NOTHING: SpeakOptions = { citations: false, brackets: 'read' };
const ANNOUNCE: SpeakOptions = { citations: true, brackets: 'announce' };
const SKIP: SpeakOptions = { citations: true, brackets: 'skip' };

/**
 * The promise the index map makes: `charMap[i]` points at a real character in
 * the original, never runs backwards, and covers the whole spoken text — so a
 * word highlight or a selection offset lands on the text the reader sees.
 */
function expectMapped(original: string, plan: { text: string; charMap: number[] | null }): void {
  expect(plan.text.length).toBeGreaterThan(0);
  if (plan.charMap === null) {
    expect(plan.text).toBe(original);
    return;
  }
  expect(plan.charMap).toHaveLength(plan.text.length);
  let previous = 0;
  for (const at of plan.charMap) {
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(original.length);
    expect(at).toBeGreaterThanOrEqual(previous);
    previous = at;
  }
}

/** The words kept from the sentence still point at themselves, character for character. */
function expectWordsMapped(
  original: string,
  plan: { text: string; charMap: number[] | null },
  words: string[]
): void {
  expect(plan.charMap).not.toBeNull();
  for (const word of words) {
    const at = plan.text.indexOf(word);
    expect(at, word).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < word.length; i++) {
      expect(original[plan.charMap![at + i]!], `${word}[${i}]`).toBe(word[i]);
    }
  }
}

describe('speakPlan: citations', () => {
  it('leaves citations alone but normalises the number when both switches are off', () => {
    const original = 'Aspirin works [12].';
    const plan = speakPlan(original, NOTHING);
    expect(plan.text).toBe('Aspirin works [twelve].');
    expect(plan.charMap).toHaveLength(plan.text.length);
    expectMapped(original, plan);
  });

  it('drops numeric citations', () => {
    expect(spokenText('Aspirin works [12].', CITATIONS)).toBe('Aspirin works.');
    expect(spokenText('Trials [12, 15] agree.', CITATIONS)).toBe('Trials agree.');
    expect(spokenText('Rates [3–5] differ.', CITATIONS)).toBe('Rates differ.');
  });

  it('drops author–year citations', () => {
    expect(spokenText('Metformin (Smith et al., 2019) lowers glucose.', CITATIONS)).toBe(
      'Metformin lowers glucose.'
    );
    expect(spokenText('It works (Smith, 2019; Jones & Co., 2020).', CITATIONS)).toBe('It works.');
  });

  it('keeps a dose in parentheses that is not a citation', () => {
    expect(spokenText('Give 2 mg (twice daily) with food.', CITATIONS)).toBe(
      'Give two milligrams (twice daily) with food.'
    );
    expect(spokenText('See (Fig. 2) for the curve.', CITATIONS)).toBe('See (figure two) for the curve.');
  });

  it('keeps citations untouched when the citation switch is off', () => {
    expect(spokenText('Metformin (Smith et al., 2019) lowers glucose.', { citations: false, brackets: 'announce' })).toBe(
      'Metformin (Smith et al., twenty nineteen) lowers glucose.'
    );
    expect(spokenText('It works [12].', { citations: false, brackets: 'skip' })).toBe('It works [twelve].');
  });

  it('never announces a citation as an aside', () => {
    expect(spokenText('Metformin (Smith et al., 2019) lowers glucose.', ANNOUNCE)).toBe(
      'Metformin lowers glucose.'
    );
    expect(spokenText('Trials agree (Smith, 2019).', ANNOUNCE)).toBe('Trials agree.');
  });

  it('does not leave a double space or a space before punctuation', () => {
    expect(spokenText('A [1] B', CITATIONS)).toBe('A B');
    expect(spokenText('Works [12] .', CITATIONS)).toBe('Works.');
    expect(spokenText('Works [12].', CITATIONS)).toBe('Works.');
  });
});

describe('speakPlan: brackets, pause', () => {
  const PAUSE: SpeakOptions = { citations: true, brackets: 'pause' };

  it('sets an acronym off with commas and no extra words', () => {
    expect(spokenText('The autonomic nervous system (ANS) controls the gut.', PAUSE)).toBe(
      'The autonomic nervous system, ANS, controls the gut.'
    );
  });

  it('sets an explanation off with commas', () => {
    expect(spokenText('Moby Dick (a novel) is long.', PAUSE)).toBe(
      'Moby Dick, a novel, is long.'
    );
  });

  it('adds no comma before the full stop', () => {
    expect(spokenText('It works (as above).', PAUSE)).toBe('It works, as above.');
  });

  it('reads a sentence-initial aside without a leading comma', () => {
    expect(spokenText('(See Fig. 2) Capsaicin burns.', PAUSE)).toBe('See figure two, Capsaicin burns.');
  });

  it('never says bracket', () => {
    const text = spokenText('Atropine (an antimuscarinic) [3] and (ACh) block (e.g. at M2) receptors.', PAUSE);
    expect(text).not.toMatch(/bracket/i);
  });

  it('keeps the highlight map on the original text', () => {
    const plan = speakPlan('The system (ANS) acts.', PAUSE);
    expect(plan.charMap).not.toBeNull();
    expect(plan.text.length).toBe(plan.charMap!.length);
  });
});

describe('speakPlan: brackets, announce', () => {
  it('names a short acronym right after a phrase', () => {
    expect(spokenText('The autonomic nervous system (ANS) controls the gut.', ANNOUNCE)).toBe(
      'The autonomic nervous system, ANS in brackets, controls the gut.'
    );
  });

  it('keeps the acronym as one token, so the lexicon can still spell it out', () => {
    const plan = speakPlan('The autonomic nervous system (ANS) controls the gut.', ANNOUNCE);
    expect(plan.text).toContain('ANS in brackets');
  });

  it('announces a drug-metabolism acronym with digits', () => {
    expect(spokenText('Metabolised by cytochrome P450 (H2O) enzymes.', ANNOUNCE)).toBe(
      'Metabolised by cytochrome P450, H2O in brackets, enzymes.'
    );
  });

  it('announces a Greek-letter aside as an aside, not an acronym', () => {
    expect(spokenText('The effect (β-blocker) is weak.', ANNOUNCE)).toBe(
      'The effect, in brackets, β-blocker, is weak.'
    );
  });

  it('announces a short explanation', () => {
    expect(spokenText('Moby Dick (a novel) is long.', ANNOUNCE)).toBe(
      'Moby Dick, in brackets, a novel, is long.'
    );
  });

  it('announces an example', () => {
    expect(spokenText('Give (e.g. atropine) for bradycardia.', ANNOUNCE)).toBe(
      'Give, in brackets, for example atropine, for bradycardia.'
    );
  });

  it('announces a cross-reference', () => {
    expect(spokenText('See (Fig. 2) for the curve.', ANNOUNCE)).toBe(
      'See, in brackets, figure two, for the curve.'
    );
  });

  it('announces square brackets that are not citations', () => {
    expect(spokenText('It works [as above].', ANNOUNCE)).toBe(
      'It works, in brackets, as above.'
    );
  });

  it('announces a square-bracket acronym', () => {
    expect(spokenText('The system [ANS] acts.', ANNOUNCE)).toBe(
      'The system, ANS in brackets, acts.'
    );
  });

  it('announces doses in brackets too', () => {
    expect(spokenText('Give 5 mg/kg (bolus) slowly.', ANNOUNCE)).toBe(
      'Give five milligrams per kilogram, in brackets, bolus, slowly.'
    );
    expect(spokenText('A dose (5 mg/kg) is safe.', ANNOUNCE)).toBe(
      'A dose, in brackets, five milligrams per kilogram, is safe.'
    );
  });

  it('announces an aside at the start of a sentence', () => {
    expect(spokenText('(See Fig. 2) Capsaicin activates TRPV1.', ANNOUNCE)).toBe(
      'In brackets, See figure two, Capsaicin activates TRPV1.'
    );
  });

  it('announces an aside at the end of a sentence without a trailing comma', () => {
    expect(spokenText('It acts on TRPV1 [as above].', ANNOUNCE)).toBe(
      'It acts on TRPV1, in brackets, as above.'
    );
  });

  it('announces every bracket in a sentence with several', () => {
    expect(spokenText('A (b) and c (d) follow.', ANNOUNCE)).toBe(
      'A, in brackets, b, and c, in brackets, d, follow.'
    );
  });

  it('does not double the comma of a sentence that already has one', () => {
    expect(spokenText('Moby Dick, (a novel) is used.', ANNOUNCE)).toBe(
      'Moby Dick, in brackets, a novel, is used.'
    );
  });

  it('never leaves a double space around the announcement', () => {
    expect(spokenText('A (b) c', ANNOUNCE)).toBe('A, in brackets, b, c');
  });

  it('drops empty brackets instead of saying "close bracket" alone', () => {
    expect(spokenText('A () B', ANNOUNCE)).toBe('A B');
  });

  it('reads nested brackets as written', () => {
    const original = 'Dose (a (b) c) is high.';
    const plan = speakPlan(original, ANNOUNCE);
    expect(plan.text).toBe(original);
    expect(plan.charMap).toBeNull();
  });

  it('reads an unclosed bracket as written', () => {
    expect(spokenText('Dose (5 mg/kg', ANNOUNCE)).toBe('Dose (five milligrams per kilogram');
    expect(spokenText('Trial (phase 2 (dose)', ANNOUNCE)).toBe('Trial (phase two (dose)');
  });

  it('leaves a stray closing bracket as a character', () => {
    expect(spokenText('Give 5 mg/kg) daily.', ANNOUNCE)).toBe('Give five milligrams per kilogram) daily.');
  });

  it('maps the announced words back to the original sentence', () => {
    const original = 'Autonomic nervous system (ANS) raises heart rate.';
    const plan = speakPlan(original, ANNOUNCE);
    expect(plan.text).toBe('Autonomic nervous system, ANS in brackets, raises heart rate.');
    expectMapped(original, plan);
    expectWordsMapped(original, plan, ['ANS', 'raises', 'heart']);
    // The words added after the aside point at its closing bracket.
    expect(plan.charMap?.[plan.text.indexOf('in brackets')]).toBe(original.indexOf(')'));
  });

  it('maps the announced words of an aside', () => {
    const original = 'Moby Dick (a novel) is long.';
    const plan = speakPlan(original, ANNOUNCE);
    expectMapped(original, plan);
    expectWordsMapped(original, plan, ['a novel', 'is long']);
  });
});

describe('speakPlan: brackets, read and skip', () => {
  it('reads brackets as written while still normalising the digits', () => {
    const original = 'Give 2 mg (twice daily) with food.';
    const plan = speakPlan(original, { citations: false, brackets: 'read' });
    expect(plan.text).toBe('Give two milligrams (twice daily) with food.');
    expectMapped(original, plan);
  });

  it('drops parenthetical and square asides in skip mode', () => {
    expect(spokenText('Give 2 mg (twice daily) [as above] with food.', SKIP)).toBe(
      'Give two milligrams with food.'
    );
  });

  it('keeps citations untouched by skip mode when citations are off', () => {
    expect(spokenText('Metformin (Smith et al., 2019) is used.', { citations: false, brackets: 'skip' })).toBe(
      'Metformin (Smith et al., twenty nineteen) is used.'
    );
  });

  it('maps the kept words when asides are skipped', () => {
    const original = 'Warfarin (Coumadin) needs INR checks [3].';
    const plan = speakPlan(original, SKIP);
    expect(plan.text).toBe('Warfarin needs INR checks.');
    expectMapped(original, plan);
    expectWordsMapped(original, plan, ['Warfarin', 'needs', 'INR']);
  });

  it('falls back to the original when stripping would leave nothing', () => {
    expect(speakPlan('[12]', CITATIONS)).toEqual({ text: '[12]', charMap: null });
    expect(speakPlan('(a)', SKIP)).toEqual({ text: '(a)', charMap: null });
  });

  it('maps a word after a skipped aside to its real position', () => {
    const original = 'Give 2 mg (twice daily) with food.';
    const plan = speakPlan(original, SKIP);
    expect(plan.text).toBe('Give two milligrams with food.');
    expect(plan.charMap?.[plan.text.indexOf('with')]).toBe(original.indexOf('with'));
  });
});

describe('speakPlan: composition maps back through edits and normalisation', () => {
  const PAUSE: SpeakOptions = { citations: true, brackets: 'pause' };

  it('maps a late expansion after a removed citation to its local source', () => {
    const original = 'It cost €1.2bn [12].';
    const plan = speakPlan(original, PAUSE);
    expect(plan.text).toBe('It cost one point two billion euros.');
    expectMapped(original, plan);
    expectWordsMapped(original, plan, ['It cost']);
    const expansion = plan.text.indexOf('one point two billion euros');
    for (let i = expansion; i < plan.text.length - 1; i += 1) {
      if (/\s/.test(plan.text[i]!)) continue;
      const at = plan.charMap![i]!;
      expect(at, plan.text[i]).toBeGreaterThanOrEqual(original.indexOf('€'));
      expect(at, plan.text[i]).toBeLessThanOrEqual(original.indexOf('n'));
    }
    expect(plan.charMap?.[plan.text.lastIndexOf('.')]).toBe(original.lastIndexOf('.'));
  });

  it('maps words and expansions through an announced aside', () => {
    const original = 'Give 5 mg/kg (bolus) slowly.';
    const plan = speakPlan(original, ANNOUNCE);
    expectMapped(original, plan);
    expectWordsMapped(original, plan, ['bolus', 'slowly']);
    const expansion = plan.text.indexOf('five milligrams per kilogram');
    for (let i = expansion; i < expansion + 'five milligrams per kilogram'.length; i += 1) {
      if (/\s/.test(plan.text[i]!)) continue;
      const at = plan.charMap![i]!;
      expect(at, plan.text[i]).toBeGreaterThanOrEqual(original.indexOf('5'));
      expect(at, plan.text[i]).toBeLessThan(original.indexOf('('));
    }
  });

  it('maps an expansion after a skipped aside to its own digit', () => {
    const original = 'Give 2 mg (twice daily) with food.';
    const plan = speakPlan(original, SKIP);
    expect(plan.text).toBe('Give two milligrams with food.');
    expectMapped(original, plan);
    expectWordsMapped(original, plan, ['Give', 'with food']);
    const expansion = plan.text.indexOf('two milligrams');
    for (let i = expansion; i < expansion + 'two milligrams'.length; i += 1) {
      if (/\s/.test(plan.text[i]!)) continue;
      const at = plan.charMap![i]!;
      expect(at, plan.text[i]).toBeGreaterThanOrEqual(original.indexOf('2'));
      expect(at, plan.text[i]).toBeLessThan(original.indexOf('('));
    }
  });

  it('leaves already-normalised text alone (no second pass)', () => {
    const original = 'It cost one point two billion euros.';
    expect(speakPlan(original, NOTHING)).toEqual({ text: original, charMap: null });
  });

  it('normalises a sentence exactly once, even with edits', () => {
    const spy = vi.spyOn(normalize, 'normaliseForSpeech');
    try {
      speakPlan('It cost €1.2bn [12].', PAUSE);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockClear();
      speakPlan('A plain sentence.', NOTHING);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('speakPlan: normalisation', () => {
  const PAUSE: SpeakOptions = { citations: true, brackets: 'pause' };

  it('expands money and maps every spoken character back to the page', () => {
    const original = 'It cost €1.2bn.';
    const plan = speakPlan(original, PAUSE);
    expect(plan.text).toBe('It cost one point two billion euros.');
    expect(plan.charMap).toHaveLength(plan.text.length);
    expectMapped(original, plan);
  });

  it('removes a citation and still expands the number beside it', () => {
    const original = 'It cost €1.2bn [12].';
    const plan = speakPlan(original, PAUSE);
    expect(plan.text).toBe('It cost one point two billion euros.');
    expect(plan.text).not.toContain('[12]');
    expect(plan.charMap).toHaveLength(plan.text.length);
    expectMapped(original, plan);
  });

  it('keeps the pause shape for a plain sentence', () => {
    const original = 'The system (ANS) acts.';
    const plan = speakPlan(original, PAUSE);
    expect(plan.text).toBe('The system, ANS, acts.');
    expect(plan.charMap).toHaveLength(plan.text.length);
    expectWordsMapped(original, plan, ['ANS', 'acts']);
  });
});
