export const SUMMARY_SEARCH_MAX_CHARACTERS = 100;

/** Code-point budgets that keep the first hit inside a two-line clamp in the
 * narrow list panel: 140 at the 12px description size, 48 at the 14px title
 * size. Both budgets retain at most 8 leading code points, so the hit itself is
 * always rendered near the start of the visible text. */
export const SUMMARY_SEARCH_DESC_WINDOW = 140;
export const SUMMARY_SEARCH_TITLE_WINDOW = 48;

export function summarySearchTooLong(value: string): boolean {
    return Array.from(value).length > SUMMARY_SEARCH_MAX_CHARACTERS;
}

/** Unlike chat's marked HTML snippets, F6 ranges map width/case-fold expansions
 * back to original Unicode code points. JS casing cannot reproduce that contract;
 * missing ranges degrade to plain text rather than inventing different matches. */
export function summarySearchSegments(text: string, ranges: [number, number][] | null = [], limit?: number) {
    const chars = Array.from(text);
    const valid = (ranges ?? []).filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end)
        && start >= 0 && end > start && end <= chars.length).sort((a, b) => a[0] - b[0]);
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
    for (let i = start; i < end; i++) {
        const matched = valid.some(([a, b]) => a <= i && i < b);
        const previous = parts[parts.length - 1];
        if (previous && previous.matched === matched) previous.text += chars[i];
        else parts.push({ text: chars[i], matched });
    }
    if (end < chars.length) parts.push({ text: '…', matched: false });
    return parts;
}
