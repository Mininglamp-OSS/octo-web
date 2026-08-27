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
 *   >3 citations  -> segmented collapse: every RUN of consecutive indices is
 *                    folded to `first-last`, runs are then comma joined.
 *
 * Segmented collapse (the bibliography / page-range convention) replaces the
 * former all-or-nothing rule, which only folded a >3 group when EVERY index
 * was contiguous and otherwise listed all of them. A partially-gapped group
 * like [27,31,32,33,34,35] therefore rendered in full and dominated the line,
 * while [21,22,23,24,25] collapsed to `21-25` — visibly inconsistent for the
 * same kind of citation cluster.
 *
 * Only runs of length >= 3 are folded: a 2-long run (`5,6`) is left listed,
 * because `5-6` is the same width as `5,6` yet reads as an open-ended range.
 *
 * This DOES change existing labels — every >3 group that mixes a gap with a
 * run of >= 3 now renders shorter. Only fully-contiguous and run-free groups
 * are guaranteed unchanged:
 *   [30,31,32,33,34,35]    -> 30-35     (unchanged: one run)
 *   [2,5,9,14]             -> 2,5,9,14  (unchanged: no run)
 *   [27,31,32,33,34,35]    -> 27,31-35  (was 27,31,32,33,34,35)
 *   [1,6,7,8]              -> 1,6-8     (was 1,6,7,8)
 *   [5,5,5,5,6]            -> 5,6       (was 5-6; dedup happens after the
 *                                        threshold check, so a duplicate-heavy
 *                                        group reaches the run logic)
 *
 * Unlike a first-last collapse over a gapped set, this never claims the gap
 * was cited: `27,31-35` says exactly which messages back the sentence.
 */
export function formatGroupLabel(indices: number[]): string {
    if (indices.length <= RANGE_THRESHOLD) {
        return indices.join(',');
    }
    const sorted = [...new Set(indices)].sort((a, b) => a - b);
    if (sorted.length === 1) return `${sorted[0]}`;

    const parts: string[] = [];
    let runStart = 0;
    for (let i = 1; i <= sorted.length; i++) {
        // Close the current run when the sequence breaks or input is exhausted.
        if (i === sorted.length || sorted[i] !== sorted[i - 1] + 1) {
            const runLength = i - runStart;
            if (runLength >= 3) {
                parts.push(`${sorted[runStart]}-${sorted[i - 1]}`);
            } else {
                for (let j = runStart; j < i; j++) parts.push(`${sorted[j]}`);
            }
            runStart = i;
        }
    }
    return parts.join(',');
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
