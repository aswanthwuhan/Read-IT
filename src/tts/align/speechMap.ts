/**
 * Character alignment between a sentence and the text the voice is given.
 *
 * `mapNormalised` answers, for every character of the normalised text, which
 * character of the original sentence produced it. Normalisation expands "5" to
 * "five", "1/2" to "one half" and "€1.2bn" to "one point two billion euros",
 * deletes footnote markers, and trims whitespace, so the two strings rarely
 * have the same length. Word highlighting and selection offsets still need a
 * position in the text the reader can see.
 *
 * The alignment is a Wagner–Fischer edit-distance table. Two unrelated
 * characters are never paired: a mismatch costs a deletion plus an insertion
 * (2), while an exact match is free, so an expansion stays inside one gap.
 * Backtracking records the matched pairs; every unmatched run of normalised
 * characters is then anchored to the first original character it replaced.
 *
 * That anchoring is why an inserted expansion maps to the current original
 * index: the words stand in for the run of source characters that were deleted
 * at that point, and the first of those is the digit (or unit, or abbreviation)
 * the listener would have seen. A run with no deleted source character behind
 * it — a pure insertion — points at the last matched original character, or at
 * the next one when the run starts the sentence. The resulting map is
 * non-decreasing and every entry lies inside the original string, so a caller
 * can walk it forwards while a word is spoken.
 *
 * Edit distance alone has ties: "It cost €1.2bn." → "It cost one point two
 * billion euros." can match the original "t" of "cost" to the "t" of "two"
 * just as cheaply as to its own "t", which would anchor the whole expansion to
 * an unrelated letter. Among equally cheap alignments we therefore prefer the
 * one with the fewest runs of match/delete/insert: unchanged words stay one
 * contiguous run and an expansion stays one local gap.
 *
 * Worst case: the table is (n+1) × (m+1) for an n-character sentence and its
 * m-character expansion. Normalisation can roughly quadruple a sentence, so a
 * 400-character sentence gives around m ≤ 1600 — about 640k cells, a few MB and
 * a few milliseconds in practice (~13 ms here for m = 800; roughly 40 ms at
 * m = 1600). It runs once per sentence while the chapter is planned, never on
 * the playback clock, so it cannot stall word highlighting.
 */
export function mapNormalised(original: string, normalised: string): number[] {
  const n = original.length;
  const m = normalised.length;
  if (m === 0) return [];
  // An empty original still needs a valid target for every spoken character.
  const lastOriginal = Math.max(0, n - 1);

  // cost[i * width + j] is the edit distance between original[0..i) and
  // normalised[0..j). runs and state are the tie-break: among equally cheap
  // alignments, the one with fewer match/delete/insert runs is chosen, so a
  // repeated letter cannot pull an expansion away from its own source.
  // Sentences are short, so the full table is cheap (see the note above).
  const width = m + 1;
  const size = (n + 1) * width;
  const cost = new Int32Array(size);
  const runs = new Int32Array(size);
  const state = new Uint8Array(size); // 0 = match, 1 = delete, 2 = insert.
  const from = new Uint8Array(size); // Predecessor direction, for backtracking.
  for (let i = 1; i <= n; i += 1) {
    cost[i * width] = i;
    runs[i * width] = 1;
    state[i * width] = 1;
    from[i * width] = 1;
  }
  for (let j = 1; j <= m; j += 1) {
    cost[j] = j;
    runs[j] = 1;
    state[j] = 2;
    from[j] = 2;
  }

  // A mismatch costs a deletion plus an insertion, so the table prefers
  // matching real characters. `runs` only matters when two alignments tie.
  const better = (c: number, r: number, bestC: number, bestR: number) =>
    c < bestC || (c === bestC && r < bestR);

  for (let i = 1; i <= n; i += 1) {
    const row = i * width;
    const previousRow = row - width;
    const originalChar = original.charCodeAt(i - 1);
    for (let j = 1; j <= m; j += 1) {
      const at = row + j;
      const same = originalChar === normalised.charCodeAt(j - 1);
      // Only exact characters share a diagonal: pairing unrelated characters
      // must cost a deletion plus an insertion. The original backtracking had
      // the same rule, and dropping substitutions keeps expansions from being
      // absorbed into a bogus "match" run.
      const diag = previousRow + j - 1;
      let bestC = same ? cost[diag]! : Number.POSITIVE_INFINITY;
      let bestR = same ? runs[diag]! + (state[diag] === 0 ? 0 : 1) : 0;
      let bestFrom = 0;
      let bestState = 0;

      const removeAt = previousRow + j;
      const removeC = cost[removeAt]! + 1;
      const removeR = runs[removeAt]! + (state[removeAt] === 1 ? 0 : 1);
      if (better(removeC, removeR, bestC, bestR)) {
        bestC = removeC;
        bestR = removeR;
        bestFrom = 1;
        bestState = 1;
      }
      const insertAt = row + j - 1;
      const insertC = cost[insertAt]! + 1;
      const insertR = runs[insertAt]! + (state[insertAt] === 2 ? 0 : 1);
      if (better(insertC, insertR, bestC, bestR)) {
        bestC = insertC;
        bestR = insertR;
        bestFrom = 2;
        bestState = 2;
      }
      cost[at] = bestC;
      runs[at] = bestR;
      from[at] = bestFrom;
      state[at] = bestState;
    }
  }

  // Backtrack from the bottom-right corner, recording exact matches. Anything
  // not matched is either a deletion from the original or an insertion into
  // the normalised text. The stored predecessor makes the path deterministic.
  const matchedAt = new Int32Array(m).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const dir = from[i * width + j]!;
    if (dir === 0) {
      if (original.charCodeAt(i - 1) === normalised.charCodeAt(j - 1)) {
        matchedAt[j - 1] = i - 1;
      }
      i -= 1;
      j -= 1;
    } else if (dir === 1) {
      i -= 1; // Deleted source character: skipped in the output.
    } else {
      j -= 1; // Inserted output character: anchored below.
    }
  }

  const map = new Array<number>(m);
  let at = 0;
  let previousOriginal = -1;
  while (at < m) {
    const match = matchedAt[at]!;
    if (match >= 0) {
      map[at] = match;
      previousOriginal = match;
      at += 1;
      continue;
    }

    let end = at;
    while (end < m && matchedAt[end]! < 0) end += 1;
    const nextOriginal = end < m ? matchedAt[end]! : n;

    // The first source character consumed by this inserted run. When nothing
    // was consumed (a pure insertion), stay on the nearest real character.
    const anchor =
      previousOriginal + 1 < nextOriginal
        ? previousOriginal + 1
        : previousOriginal >= 0
          ? previousOriginal
          : nextOriginal < n
            ? nextOriginal
            : 0;
    const clamped = Math.min(Math.max(anchor, 0), lastOriginal);
    for (; at < end; at += 1) map[at] = clamped;
  }

  return map;
}
