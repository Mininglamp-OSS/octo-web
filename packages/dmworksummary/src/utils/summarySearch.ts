export const SUMMARY_SEARCH_MAX_CHARACTERS = 100;

export function summarySearchTooLong(value: string): boolean {
    return Array.from(value).length > SUMMARY_SEARCH_MAX_CHARACTERS;
}

/** Use server ranges, never recompute matches with JS casing or UTF-16 offsets. */
export function summarySearchSegments(text: string, ranges: [number, number][] = [], limit?: number) {
    const chars = Array.from(text);
    const valid = ranges.filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end)
        && start >= 0 && end > start && end <= chars.length).sort((a, b) => a[0] - b[0]);
    const start = limit ? Math.max(0, (valid[0]?.[0] ?? 0) - Math.floor(limit / 3)) : 0;
    const end = limit ? Math.min(chars.length, Math.max(start + limit, valid[0]?.[1] ?? 0)) : chars.length;
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
