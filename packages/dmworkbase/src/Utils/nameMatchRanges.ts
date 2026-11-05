import type { NameMatchRange } from "../Service/NameSearchTypes";

/** Union codepoint intervals without expanding each range into characters.
 * Copies/clips input for direct mapper callers; the wire parser rejects invalid
 * ranges before reaching this helper. Adjacent intervals form one highlight.
 */
export function mergeNameMatchRanges(
  ranges: readonly NameMatchRange[],
  length: number
): NameMatchRange[] {
  const sorted = ranges
    .filter(
      (range) => Number.isInteger(range.start) && Number.isInteger(range.end)
    )
    .map((range) => ({
      start: Math.max(0, range.start),
      end: Math.min(length, range.end),
    }))
    .filter((range) => range.start < range.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: NameMatchRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  return merged;
}
