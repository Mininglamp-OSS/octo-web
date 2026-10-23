export const SUMMARY_SEARCH_MAX_CHARACTERS = 100;

/** Code-point budgets that keep the first hit inside a two-line clamp in the
 * narrow list panel: 140 at the 12px description size, 48 at the 14px title
 * size. Both budgets retain at most 8 leading code points, so the hit itself is
 * always rendered near the start of the visible text. */
export const SUMMARY_SEARCH_DESC_WINDOW = 140;
export const SUMMARY_SEARCH_TITLE_WINDOW = 48;

/** Hover content shows far more context than the clamped rows, but stays bounded
 * so a pathological topic cannot build an unbounded node tree on hover. */
export const SUMMARY_SEARCH_TOOLTIP_WINDOW = 400;

export function summarySearchTooLong(value: string): boolean {
    return Array.from(value).length > SUMMARY_SEARCH_MAX_CHARACTERS;
}

export const codePointLength = (text: string) => Array.from(text).length;

/** How many code points String.trim() drops from the front of `text`. */
export function leadingTrimCodePoints(text: string): number {
    return codePointLength(text.slice(0, text.length - text.trimStart().length));
}

/** Re-bases server ranges onto a string derived from `raw`: the ranges are
 * code-point offsets into the raw field and `offset` is how many leading code
 * points the derivation sliced away. Fragments outside the string are dropped
 * and the surviving edges clamped, so no highlight can point past the text. */
export function shiftRanges(ranges: [number, number][], offset: number, length: number): [number, number][] {
    return ranges
        .map(([start, end]) => [start - offset, end - offset] as [number, number])
        .filter(([start, end]) => end > 0 && start < length)
        .map(([start, end]) => [Math.max(0, start), Math.min(length, end)] as [number, number]);
}

/** Coalesces overlapping and adjacent ranges so the scan below can advance a
 * single pointer instead of probing every range for every code point. The input
 * is already sorted by start. */
function mergeRanges(ranges: [number, number][]): [number, number][] {
    const merged: [number, number][] = [];
    for (const [start, end] of ranges) {
        const last = merged[merged.length - 1];
        if (last && start <= last[1]) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
    }
    return merged;
}

/** Unlike chat's marked HTML snippets, F6 ranges map width/case-fold expansions
 * back to original Unicode code points. JS casing cannot reproduce that contract;
 * missing ranges degrade to plain text rather than inventing different matches. */
export function summarySearchSegments(text: string, ranges: [number, number][] | null = [], limit?: number) {
    const chars = Array.from(text);
    const valid = mergeRanges((ranges ?? []).filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end)
        && start >= 0 && end > start && end <= chars.length).sort((a, b) => a[0] - b[0]));
    // Window only when there is a hit to keep visible: without one, plain text
    // keeps its full value (the CSS clamp already handles overflow) and no
    // leading/trailing ellipsis is invented.
    const first = valid[0];
    const windowSize = limit ?? 0;
    // Keep the first hit visible after the topic label in a narrow two-line card.
    const start = first && windowSize > 0
        ? Math.max(0, first[0] - Math.min(8, Math.floor(windowSize / 3))) : 0;
    const end = first && windowSize > 0
        ? Math.min(chars.length, Math.max(start + windowSize, first[1])) : chars.length;
    const parts: { text: string; matched: boolean }[] = [];
    if (start > 0) parts.push({ text: '…', matched: false });
    // Ranges are disjoint and ascending after merging, so the cursor only moves
    // forward: the loop is O(window + ranges) rather than O(window × ranges).
    let cursor = 0;
    for (let i = start; i < end; i++) {
        while (cursor < valid.length && valid[cursor][1] <= i) cursor++;
        const matched = cursor < valid.length && valid[cursor][0] <= i;
        const previous = parts[parts.length - 1];
        if (previous && previous.matched === matched) previous.text += chars[i];
        else parts.push({ text: chars[i], matched });
    }
    if (end < chars.length) parts.push({ text: '…', matched: false });
    return parts;
}
