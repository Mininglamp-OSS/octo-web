import { describe, it, expect } from 'vitest';
import { shouldEmitGroupSummaryNotify, collectGroupSourceIds } from '../summaryNotifyHelpers';
import type { SummaryDetail } from '../../types/summary';

// Constants mirror packages/dmworksummary/src/types/summary.ts (TaskStatus /
// SourceType) but kept literal here so the test does not drag the enum module
// or its imports into the pure-helper unit scope.
const COMPLETED = 3;
const PROCESSING = 2;
const FAILED = 4;
const CANCELLED = 5;
const GROUP = 1;
const DM = 2;
const THREAD = 3;

function minimalDetail(overrides: Partial<Pick<SummaryDetail, 'status' | 'creator_id'>> = {}) {
    return {
        status: COMPLETED,
        creator_id: 'creator-uid',
        ...overrides,
    } as unknown as Pick<SummaryDetail, 'status' | 'creator_id'>;
}

describe('shouldEmitGroupSummaryNotify', () => {
    it('returns true when creator viewing own COMPLETED task', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail(), 'creator-uid', COMPLETED)).toBe(true);
    });

    it('returns false when viewer is not the creator', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail(), 'other-uid', COMPLETED)).toBe(false);
    });

    it('returns false when task is not COMPLETED (PROCESSING)', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail({ status: PROCESSING }), 'creator-uid', COMPLETED)).toBe(false);
    });

    it('returns false when task is FAILED (never announce failure to group)', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail({ status: FAILED }), 'creator-uid', COMPLETED)).toBe(false);
    });

    it('returns false when task is CANCELLED', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail({ status: CANCELLED }), 'creator-uid', COMPLETED)).toBe(false);
    });

    it('returns false when logged-out (empty myUid)', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail(), '', COMPLETED)).toBe(false);
    });

    it('returns false when task has no creator_id (defensive)', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail({ creator_id: '' }), 'anyone', COMPLETED)).toBe(false);
    });
});

describe('collectGroupSourceIds', () => {
    it('returns [] for undefined sources', () => {
        expect(collectGroupSourceIds(undefined)).toEqual([]);
    });

    it('returns [] for empty sources array', () => {
        expect(collectGroupSourceIds([])).toEqual([]);
    });

    it('returns group source ids preserving first-seen order', () => {
        const sources = [
            { source_type: GROUP, source_id: 'group-a' },
            { source_type: GROUP, source_id: 'group-b' },
            { source_type: GROUP, source_id: 'group-c' },
        ] as unknown as SummaryDetail['sources'];
        expect(collectGroupSourceIds(sources)).toEqual(['group-a', 'group-b', 'group-c']);
    });

    it('filters out DM sources', () => {
        const sources = [
            { source_type: GROUP, source_id: 'group-a' },
            { source_type: DM, source_id: 'dm-x' },
        ] as unknown as SummaryDetail['sources'];
        expect(collectGroupSourceIds(sources)).toEqual(['group-a']);
    });

    it('filters out THREAD sources', () => {
        const sources = [
            { source_type: GROUP, source_id: 'group-a' },
            { source_type: THREAD, source_id: 'thread-x' },
        ] as unknown as SummaryDetail['sources'];
        expect(collectGroupSourceIds(sources)).toEqual(['group-a']);
    });

    it('filters out empty source_ids (defensive)', () => {
        const sources = [
            { source_type: GROUP, source_id: '' },
            { source_type: GROUP, source_id: 'group-a' },
        ] as unknown as SummaryDetail['sources'];
        expect(collectGroupSourceIds(sources)).toEqual(['group-a']);
    });

    it('deduplicates identical source_ids within one fan-out', () => {
        const sources = [
            { source_type: GROUP, source_id: 'group-a' },
            { source_type: GROUP, source_id: 'group-a' }, // duplicate
            { source_type: GROUP, source_id: 'group-b' },
        ] as unknown as SummaryDetail['sources'];
        expect(collectGroupSourceIds(sources)).toEqual(['group-a', 'group-b']);
    });

    it('returns [] when only DM / thread sources are present', () => {
        const sources = [
            { source_type: DM, source_id: 'dm-x' },
            { source_type: THREAD, source_id: 'thread-y' },
        ] as unknown as SummaryDetail['sources'];
        expect(collectGroupSourceIds(sources)).toEqual([]);
    });

    it('handles a mixed source list (groups + dms + threads + duplicates + empties)', () => {
        const sources = [
            { source_type: GROUP, source_id: 'group-a' },
            { source_type: DM, source_id: 'dm-x' },
            { source_type: GROUP, source_id: 'group-b' },
            { source_type: THREAD, source_id: 'thread-y' },
            { source_type: GROUP, source_id: 'group-a' }, // dup
            { source_type: GROUP, source_id: '' },         // empty
            { source_type: GROUP, source_id: 'group-c' },
        ] as unknown as SummaryDetail['sources'];
        expect(collectGroupSourceIds(sources)).toEqual(['group-a', 'group-b', 'group-c']);
    });
});
