/**
 * Label formatting rules for citation badges. Pure functions with no React /
 * DOM deps so they can be unit-tested in isolation without pulling the
 * component tree (which drags in tiptap, semi-ui, and other UI-only imports
 * that break vitest resolution).
 *
 * See CitationBadge.tsx for how these are consumed by the JSX layer.
 */

/** Threshold below which the group badge lists all indices explicitly. */
export const RANGE_THRESHOLD = 3;

/**
 * Group-label formatting rule (per product spec):
 *   1  citation  -> single [N] badge (handled by remarkCitation, not here)
 *   2-3 citations -> comma joined:  [37,38,39]
 *   >3 citations  -> range:         [30-35]
 */
export function formatGroupLabel(indices: number[]): string {
    if (indices.length <= RANGE_THRESHOLD) {
        return indices.join(',');
    }
    return `${indices[0]}-${indices[indices.length - 1]}`;
}

/**
 * Build a stable mapping from raw citation index (backend pool position, e.g.
 * 37) to display index (reading-order rank starting at 1). The same raw index
 * appearing multiple times reuses the same display value.
 *
 * Pre-scans the raw markdown source in reading order once (before the remark
 * plugin runs) because the tree visitor sees text nodes out of document order.
 * The `[n](url)` markdown-link form and `[Pn]` team-citation form are both
 * excluded so display numbering matches what the badge layer will actually
 * render.
 */
export function buildDisplayIndexMap(source: string): Map<number, number> {
    const map = new Map<number, number>();
    let next = 1;
    // Match [n] but NOT [n](url) — same rule as remarkCitation's regex so this
    // scan aligns exactly with what will later render as a badge. [Pn] tokens
    // start with a letter so \d+ never touches them.
    const regex = /\[(\d+)\](?!\()/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(source)) !== null) {
        const raw = parseInt(m[1], 10);
        if (!map.has(raw)) map.set(raw, next++);
    }
    return map;
}
