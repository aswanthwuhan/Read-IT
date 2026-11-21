/**
 * `Math.min`/`Math.max` over an array. Spreading a very large array into
 * `Math.min(...values)` throws `RangeError: Maximum call stack size exceeded`
 * (roughly 100k arguments), which a crafted PDF with many tiny glyphs on one
 * line can reach. These loop instead and have no argument limit.
 */
export function minOf(values: readonly number[]): number {
  let result = Infinity;
  for (const value of values) if (value < result) result = value;
  return result;
}

export function maxOf(values: readonly number[]): number {
  let result = -Infinity;
  for (const value of values) if (value > result) result = value;
  return result;
}
