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
    // Range form is only meaningful when the display indices are contiguous and
    // strictly ascending. After reading-order renumbering a group's display
    // indices can be reordered/gapped (e.g. [4,1,2,3] -> "4-3" backwards, or
    // [1,3,4,5] -> "1-5" implying a [2] that isn't in the group), so fall back
    // to the explicit comma list in those cases (#1003 review P2).
    const contiguousAscending = indices.every(
        (v, i) => i === 0 || v === indices[i - 1] + 1,
    );
    return contiguousAscending
        ? `${indices[0]}-${indices[indices.length - 1]}`
        : indices.join(',');
}

/**
 * Build a stable mapping from raw citation index (backend pool position, e.g.
 * 37) to display index (reading-order rank starting at 1). The same raw index
 * appearing multiple times reuses the same display value.
 *
 * Input is the list of visible markdown text-node values in document order (as
 * produced by a `unist-util-visit(tree, 'text', …)` pass). Deriving numbering
 * from text nodes — rather than a pre-scan of the raw source — means `[n]`
 * tokens inside fenced / inline code are naturally excluded, so the numbering
 * matches exactly what remarkCitation renders as a badge. (#1003 review P1: a
 * raw-string pre-scan over-counted `[digit]` inside code and shifted the first
 * rendered badge to [2]/[3] instead of [1].)
 *
 * The `[n](url)` markdown-link form and `[Pn]` team-citation form are both
 * excluded, matching remarkCitation's regex.
 */
export function buildDisplayIndexMap(textSegments: string[]): Map<number, number> {
    const map = new Map<number, number>();
    let next = 1;
    for (const seg of textSegments) {
        // Match [n] but NOT [n](url) — same rule as remarkCitation. [Pn] tokens
        // start with a letter so \d+ never touches them. Fresh regex per segment
        // to avoid /g lastIndex carryover.
        const regex = /\[(\d+)\](?!\()/g;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(seg)) !== null) {
            const raw = parseInt(m[1], 10);
            if (!map.has(raw)) map.set(raw, next++);
        }
    }
    return map;
}
