import { describe, expect, it } from 'vitest';
import { TextSplitterStream } from './splitter';

/** Drain a closed stream through the async iterator into a plain array. */
const collect = async (splitter: TextSplitterStream): Promise<string[]> => {
  const sentences: string[] = [];
  for await (const sentence of splitter) sentences.push(sentence);
  return sentences;
};

describe('TextSplitterStream async iterator', () => {
  it('yields every terminated sentence and then terminates after close()', async () => {
    const splitter = new TextSplitterStream();
    splitter.push('First sentence. Second sentence.');
    splitter.close();

    expect(await collect(splitter)).toEqual(['First sentence.', 'Second sentence.']);
  });

  it('still yields an unterminated final fragment when close() flushes it', async () => {
    const splitter = new TextSplitterStream();
    splitter.push('No terminator');
    splitter.close();

    expect(await collect(splitter)).toEqual(['No terminator']);
  });
});
