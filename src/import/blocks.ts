import type { Block, Chapter } from '../core/types';
import { makeSentences } from './segment';

/** Intermediate shape every extractor produces before chapter/sentence assembly. */
export interface BlockSeed {
  kind: Block['kind'];
  text: string;
  /** Only for `h` blocks: 1 (chapter title) … 6. */
  level?: number;
}

export function normaliseText(value: string): string {
  return value
    // A soft hyphen is a break opportunity, never a spoken character.
    .replace(/\u00ad/g, '')
    // Print hyphenates long words across lines ("exam-\nple"). The newline is the
    // break marker, so rejoin the halves instead of leaving "exam- ple" behind.
    // Only a lowercase continuation is joined: "Anglo-\nSaxon" keeps its hyphen.
    .replace(/(\p{L})-[ \t]*\r?\n[ \t]*(?=\p{Ll})/gu, '$1')
    .replace(/(\p{L})-[ \t]*\r?\n[ \t]*/gu, '$1-')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build one chapter from seeds; returns null when no seed has readable text. */
export function chapterFromSeeds(title: string, chapterIdx: number, seeds: BlockSeed[]): Chapter | null {
  const blocks: Block[] = [];

  for (const seed of seeds) {
    const text = normaliseText(seed.text);
    if (!text) continue;

    // A block with no speakable sentences would render as a gap in the reader.
    const blockIdx = blocks.length;
    const sentences = makeSentences(text, chapterIdx, blockIdx);
    if (!sentences.length) continue;

    blocks.push({ id: `b-${chapterIdx}-${blockIdx}`, kind: seed.kind, sentences });
  }

  if (!blocks.length) return null;

  return {
    id: `ch-${chapterIdx}`,
    title: normaliseText(title) || `Chapter ${chapterIdx + 1}`,
    blocks,
  };
}

/**
 * Split a flat seed stream into chapters. A heading at or above `chapterLevel`
 * starts a new chapter and becomes its title (so it is not repeated as a block).
 */
export function buildChapters(seeds: BlockSeed[], docTitle: string, chapterLevel = 2): Chapter[] {
  const chapters: Chapter[] = [];
  let title = docTitle;
  let current: BlockSeed[] = [];
  // Increment even when a flush yields no chapter, so a skipped empty chapter
  // cannot make the next one reuse its id.
  let nextId = 0;

  const flush = () => {
    const chapter = chapterFromSeeds(title, nextId++, current);
    if (chapter) chapters.push(chapter);
    current = [];
  };

  for (const seed of seeds) {
    if (seed.kind === 'h' && (seed.level ?? 3) <= chapterLevel) {
      flush();
      title = seed.text;
      continue;
    }
    current.push(seed);
  }
  flush();

  return chapters;
}
