/**
 * One shared formatter for byte sizes shown in Storage, Settings and TTS:
 * `0 B` for small sizes, `KB`/`MB`/`GB`/`TB` above, with at most one decimal
 * on values under 10. NaN and negatives are a bare `—`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
