import { describe, it, expect, beforeEach } from 'vitest';
import {
    shouldEmitGroupSummaryNotify,
    collectGroupSourceIds,
    readSummaryNotifySentSources,
    markSummaryNotifySent,
    summaryNotifySentKey,
    shouldEmitOnStatusTransition,
} from '../summaryNotifyHelpers';
import type { SummaryDetail } from '../../types/summary';

// Constants mirror packages/dmworksummary/src/types/summary.ts (TaskStatus /
// SourceType / SummaryMode) but kept literal here so the test does not drag
// the enum module or its imports into the pure-helper unit scope.
const COMPLETED = 3;
const PROCESSING = 2;
const FAILED = 4;
const CANCELLED = 5;
// SourceType canonical layout: GROUP_CHAT = 1, THREAD = 2, DIRECT_MESSAGE = 3
// (fix for round-7 nit — three reviewers spotted the earlier swap).
const GROUP = 1;
const THREAD = 2;
const DM = 3;
// SummaryMode: BY_GROUP = 1, BY_PERSON = 2.
const BY_GROUP = 1;
const BY_PERSON = 2;

function minimalDetail(overrides: Partial<Pick<SummaryDetail, 'status' | 'creator_id' | 'summary_mode'>> = {}) {
    return {
        status: COMPLETED,
        creator_id: 'creator-uid',
        summary_mode: BY_GROUP,
        ...overrides,
    } as unknown as Pick<SummaryDetail, 'status' | 'creator_id' | 'summary_mode'>;
}

describe('shouldEmitGroupSummaryNotify', () => {
    it('returns true when creator viewing own COMPLETED BY_GROUP task', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail(), 'creator-uid', COMPLETED, BY_GROUP)).toBe(true);
    });

    it('returns false when viewer is not the creator', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail(), 'other-uid', COMPLETED, BY_GROUP)).toBe(false);
    });

    it('returns false when task is not COMPLETED (PROCESSING)', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail({ status: PROCESSING as any }), 'creator-uid', COMPLETED, BY_GROUP)).toBe(false);
    });

    it('returns false when task is FAILED (never announce failure to group)', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail({ status: FAILED as any }), 'creator-uid', COMPLETED, BY_GROUP)).toBe(false);
    });

    it('returns false when task is CANCELLED', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail({ status: CANCELLED as any }), 'creator-uid', COMPLETED, BY_GROUP)).toBe(false);
    });

    it('returns false when logged-out (empty myUid)', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail(), '', COMPLETED, BY_GROUP)).toBe(false);
    });

    it('returns false when task has no creator_id (defensive)', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail({ creator_id: '' }), 'anyone', COMPLETED, BY_GROUP)).toBe(false);
    });

    // #1283 round-7 P1 (Jerry-Xin / lml2468 / yujiawei): BY_PERSON summaries
    // produce per-participant DM content, not a group summary — announcing
    // "总结了群聊内容" into every group source is a scope violation.
    it('returns false for BY_PERSON mode (positive BY_GROUP gate)', () => {
        expect(shouldEmitGroupSummaryNotify(minimalDetail({ summary_mode: BY_PERSON as any }), 'creator-uid', COMPLETED, BY_GROUP)).toBe(false);
    });

    // Positive check guards a hypothetical future mode value (e.g. 3) from
    // silently emitting a group announcement it was never designed for.
    it('returns false for an unknown future summary_mode value', () => {
        const futureMode = 99;
        expect(shouldEmitGroupSummaryNotify(minimalDetail({ summary_mode: futureMode as any }), 'creator-uid', COMPLETED, BY_GROUP)).toBe(false);
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

// #1283 round-8 P1-A (@Jerry-Xin + @yujiawei): first-completion-only
// persistence — the sent record must survive component unmount so that a
// regenerate is not silently gated on whether the creator refreshed the
// page. localStorage-backed helpers, deliberately narrow (one boolean per
// (task_id, source_id), no completion-run counters).
describe('localStorage sent-marker helpers (first-completion-only persistence)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('summaryNotifySentKey is stable across calls and namespaces task ids', () => {
        expect(summaryNotifySentKey(42)).toBe('summary-notify-sent:42');
        expect(summaryNotifySentKey('42')).toBe('summary-notify-sent:42');
        expect(summaryNotifySentKey(43)).toBe('summary-notify-sent:43');
    });

    it('readSummaryNotifySentSources returns an empty Set for a fresh task', () => {
        expect(readSummaryNotifySentSources(42).size).toBe(0);
    });

    it('markSummaryNotifySent persists a group id and readSummaryNotifySentSources reads it back', () => {
        markSummaryNotifySent(42, 'group-a');
        const sent = readSummaryNotifySentSources(42);
        expect(sent.has('group-a')).toBe(true);
        expect(sent.size).toBe(1);
    });

    it('accumulates multiple group ids for the same task', () => {
        markSummaryNotifySent(42, 'group-a');
        markSummaryNotifySent(42, 'group-b');
        markSummaryNotifySent(42, 'group-c');
        const sent = readSummaryNotifySentSources(42);
        expect(sent.has('group-a')).toBe(true);
        expect(sent.has('group-b')).toBe(true);
        expect(sent.has('group-c')).toBe(true);
        expect(sent.size).toBe(3);
    });

    it('is idempotent: marking the same (task, source) twice does not duplicate', () => {
        markSummaryNotifySent(42, 'group-a');
        markSummaryNotifySent(42, 'group-a');
        const sent = readSummaryNotifySentSources(42);
        expect(sent.size).toBe(1);
    });

    it('isolates records by task id', () => {
        markSummaryNotifySent(42, 'group-a');
        markSummaryNotifySent(43, 'group-b');
        expect(readSummaryNotifySentSources(42).has('group-a')).toBe(true);
        expect(readSummaryNotifySentSources(42).has('group-b')).toBe(false);
        expect(readSummaryNotifySentSources(43).has('group-b')).toBe(true);
        expect(readSummaryNotifySentSources(43).has('group-a')).toBe(false);
    });

    it('empty sourceId is a defensive no-op (never persists)', () => {
        markSummaryNotifySent(42, '');
        expect(readSummaryNotifySentSources(42).size).toBe(0);
    });

    it('gracefully degrades to empty Set on malformed storage', () => {
        localStorage.setItem(summaryNotifySentKey(42), 'not-json');
        expect(readSummaryNotifySentSources(42).size).toBe(0);
    });

    it('gracefully degrades to empty Set on a non-array JSON payload', () => {
        localStorage.setItem(summaryNotifySentKey(42), '{"not":"an array"}');
        expect(readSummaryNotifySentSources(42).size).toBe(0);
    });

    it('filters out non-string / empty entries defensively', () => {
        // Mimic a malformed payload from an older code version.
        localStorage.setItem(summaryNotifySentKey(42), JSON.stringify(['group-a', '', 42, null, 'group-b']));
        const sent = readSummaryNotifySentSources(42);
        expect(sent.has('group-a')).toBe(true);
        expect(sent.has('group-b')).toBe(true);
        expect(sent.size).toBe(2);
    });

    // Regression for the round-8 P1-A defect. `alreadySent.has(source)` gated
    // by these helpers is what makes the tip fire once across:
    //   1. Regenerate on the same page instance,
    //   2. Reload between first-completion and regenerate,
    //   3. A second tab observing the same task.
    it('survives simulated regenerate on the same instance (round-8 P1-A)', async () => {
        // First completion writes the marker.
        markSummaryNotifySent(42, 'group-a');
        // Regenerate on the same instance reads it and sees "already sent".
        expect(readSummaryNotifySentSources(42).has('group-a')).toBe(true);
    });
});

// #1283 round-11 P1 (@mochashanyao on `ed87de25`): both trigger paths drop
// the observed → COMPLETED edge when a `this.taskId !== requestTaskId` guard
// returns after the await. The fix captures prevStatus BEFORE the await and
// consults this predicate on the captured snapshot; if the fix is to be
// safe, the predicate itself must never fire on the first-load "already
// COMPLETED" case (prevStatus === undefined) and must not double-fire when
// the status did not change.
describe('shouldEmitOnStatusTransition (round-11 P1 · @mochashanyao)', () => {
    const PROCESSING = 2;
    const COMPLETED = 3;
    const FAILED = 4;

    it('does NOT fire on first load (no previous status observed)', () => {
        expect(shouldEmitOnStatusTransition(undefined, COMPLETED, COMPLETED)).toBe(false);
    });

    it('fires on PROCESSING → COMPLETED', () => {
        expect(shouldEmitOnStatusTransition(PROCESSING, COMPLETED, COMPLETED)).toBe(true);
    });

    it('does NOT fire on COMPLETED → COMPLETED (no transition)', () => {
        expect(shouldEmitOnStatusTransition(COMPLETED, COMPLETED, COMPLETED)).toBe(false);
    });

    it('does NOT fire on PROCESSING → FAILED (not COMPLETED)', () => {
        expect(shouldEmitOnStatusTransition(PROCESSING, FAILED, COMPLETED)).toBe(false);
    });

    it('does NOT fire on PROCESSING → PROCESSING (defensive)', () => {
        expect(shouldEmitOnStatusTransition(PROCESSING, PROCESSING, COMPLETED)).toBe(false);
    });
});
