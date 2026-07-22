import { describe, it, expect } from 'vitest';
import { formatGroupLabel, RANGE_THRESHOLD, buildDisplayIndexMap } from '../citationFormat';

// Product spec for group badge label (see CitationBadge.tsx):
//   len=1  -> handled by CitationBadge (single [N]), not tested here
//   len=2  -> comma joined:  [37,38]
//   len=3  -> comma joined:  [37,38,39]      (threshold)
//   len>3  -> range:         [30-35]         (first-last)
describe('formatGroupLabel', () => {
    it('joins 2 indices with a comma', () => {
        expect(formatGroupLabel([37, 38])).toBe('37,38');
    });

    it('joins exactly RANGE_THRESHOLD (3) indices with commas', () => {
        expect(formatGroupLabel([37, 38, 39])).toBe('37,38,39');
    });

    it('collapses more than RANGE_THRESHOLD indices to first-last range', () => {
        expect(formatGroupLabel([30, 31, 32, 33, 34, 35])).toBe('30-35');
    });

    it('falls back to comma list when a >3 display list is non-contiguous', () => {
        // After reading-order renumbering a group's display indices can be
        // gapped; range form would imply members that aren't there (#1003 P2).
        expect(formatGroupLabel([2, 5, 9, 14])).toBe('2,5,9,14');
    });

    it('falls back to comma list when a >3 display list is not ascending', () => {
        // e.g. same-channel group whose later members were numbered earlier —
        // range would render backwards ("4-3") which is nonsense (#1003 P2).
        expect(formatGroupLabel([4, 1, 2, 3])).toBe('4,1,2,3');
    });

    it('RANGE_THRESHOLD is the documented value (guards against silent regressions)', () => {
        expect(RANGE_THRESHOLD).toBe(3);
    });
});

// P1: reading-order display renumbering. Input is the visible text-node values
// in document order (as remarkCitation collects via visit(tree,'text',…)), so
// `[n]` inside code is excluded by construction. Users should never see raw
// pool positions like [37]; the first citation encountered is [1] and each new
// raw index picks up the next display number. Repeated references reuse it.
describe('buildDisplayIndexMap', () => {
    it('assigns 1 to the first citation encountered', () => {
        const m = buildDisplayIndexMap(['foo [37] bar']);
        expect(m.get(37)).toBe(1);
    });

    it('assigns increasing display numbers in reading order', () => {
        const m = buildDisplayIndexMap(['a [37] b [12] c [99] d']);
        expect(m.get(37)).toBe(1);
        expect(m.get(12)).toBe(2);
        expect(m.get(99)).toBe(3);
    });

    it('reuses the same display number when a raw index is referenced twice', () => {
        const m = buildDisplayIndexMap(['a [37] b [12] c [37] d']);
        expect(m.get(37)).toBe(1);
        expect(m.get(12)).toBe(2);
        // second [37] must NOT get a new display number
        expect(m.size).toBe(2);
    });

    it('preserves order across multiple text segments', () => {
        // Segments arrive in document order (one per visited text node).
        const segments = [
            'Intro references [5].',
            'point [2]',
            'another [8]',
            'Wrap up [5] again.',
        ];
        const m = buildDisplayIndexMap(segments);
        expect(m.get(5)).toBe(1);
        expect(m.get(2)).toBe(2);
        expect(m.get(8)).toBe(3);
        expect(m.size).toBe(3);
    });

    it('does not count [n] inside code — code text is never a text segment (#1003 P1)', () => {
        // remarkCitation visits only `text` nodes, so `code [37]` never reaches
        // here; the first REAL citation must therefore display as [1], not [2].
        const m = buildDisplayIndexMap(['Real citation [42] here.']);
        expect(m.get(42)).toBe(1);
        expect(m.has(37)).toBe(false);
        expect(m.size).toBe(1);
    });

    it('does not consume markdown link brackets [text](url)', () => {
        const m = buildDisplayIndexMap(['see [37](/link) then [42] again']);
        expect(m.get(37)).toBeUndefined();
        expect(m.get(42)).toBe(1);
    });

    it('does not consume team-citation [Pn] tokens', () => {
        const m = buildDisplayIndexMap(['see [P3] and [7]']);
        expect(m.get(7)).toBe(1);
        expect(m.size).toBe(1);
    });

    it('returns an empty map for text with no citations', () => {
        expect(buildDisplayIndexMap(['nothing here']).size).toBe(0);
    });
});
