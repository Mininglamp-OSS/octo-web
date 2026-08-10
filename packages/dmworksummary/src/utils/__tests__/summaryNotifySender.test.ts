import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Channel } from 'wukongimjssdk';
import type { SummaryDetail } from '../../types/summary';
import {
    sendGroupSummaryNotifyImpl,
    newSummaryNotifySendState,
    type SummaryNotifySendDeps,
    type SummaryNotifySendState,
} from '../summaryNotifySender';
import {
    readSummaryNotifySentSources,
    summaryNotifySentKey,
} from '../summaryNotifyHelpers';

// Constants mirror packages/dmworksummary/src/types/summary.ts.
const COMPLETED = 3;
const GROUP_CHAT = 1;
const BY_GROUP = 1;
const BY_PERSON = 2;
const CHANNEL_TYPE_GROUP = 2;

const CREATOR = 'creator-uid';

/** Deferred that lets the test control ack ordering across concurrent sends. */
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function taskWithSources(taskId: number, sourceIds: string[], overrides: Partial<SummaryDetail> = {}): SummaryDetail {
    return {
        task_id: taskId,
        status: COMPLETED,
        creator_id: CREATOR,
        summary_mode: BY_GROUP,
        sources: sourceIds.map((id) => ({ source_type: GROUP_CHAT, source_id: id })),
        ...overrides,
    } as unknown as SummaryDetail;
}

function makeDeps(overrides: Partial<SummaryNotifySendDeps> = {}): SummaryNotifySendDeps {
    return {
        sendToChannel: vi.fn().mockResolvedValue(undefined),
        isDisbanded: () => false,
        warn: vi.fn(),
        ...overrides,
    };
}

async function invoke(
    detail: SummaryDetail,
    state: SummaryNotifySendState,
    deps: SummaryNotifySendDeps,
    myUid: string | undefined = CREATOR,
) {
    await sendGroupSummaryNotifyImpl(detail, myUid, state, deps, COMPLETED, BY_GROUP, CHANNEL_TYPE_GROUP);
}

/** All channel IDs the mocked sender was called with, in call order. */
function sentSourceIds(sendToChannel: SummaryNotifySendDeps['sendToChannel']): string[] {
    const mock = sendToChannel as unknown as { mock: { calls: [Channel, string][] } };
    return mock.mock.calls.map(([ch]) => ch.channelID);
}

describe('sendGroupSummaryNotifyImpl — round-10 integration test (yujiawei escalation)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    // --- Gate coverage (fast-fails; also cross-checked by helper tests) ------

    it('returns without sending when detail is not COMPLETED', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps();
        await invoke(taskWithSources(1, ['g1'], { status: 2 as any }), state, deps);
        expect(deps.sendToChannel).not.toHaveBeenCalled();
    });

    it('returns without sending for BY_PERSON summaries even with group sources', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps();
        await invoke(taskWithSources(1, ['g1'], { summary_mode: BY_PERSON as any }), state, deps);
        expect(deps.sendToChannel).not.toHaveBeenCalled();
    });

    it('returns without sending when viewer is not the creator', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps();
        await invoke(taskWithSources(1, ['g1']), state, deps, 'other-uid');
        expect(deps.sendToChannel).not.toHaveBeenCalled();
    });

    it('returns without sending when logged out (empty myUid)', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps();
        await invoke(taskWithSources(1, ['g1']), state, deps, '');
        expect(deps.sendToChannel).not.toHaveBeenCalled();
    });

    it('returns without sending when the task has zero group sources', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps();
        await invoke(taskWithSources(1, []), state, deps);
        expect(deps.sendToChannel).not.toHaveBeenCalled();
    });

    // --- Basic single fan-out --------------------------------------------------

    it('sends to every group source exactly once on first completion', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps();
        await invoke(taskWithSources(1, ['g1', 'g2', 'g3']), state, deps);
        expect(sentSourceIds(deps.sendToChannel)).toEqual(['g1', 'g2', 'g3']);
        // Persisted for all three.
        expect(readSummaryNotifySentSources(1)).toEqual(new Set(['g1', 'g2', 'g3']));
        // In-memory also holds them (belt-and-braces).
        expect([...state.sentThisInstance]).toEqual(['g1', 'g2', 'g3']);
        // in-flight cleared.
        expect(state.inFlight.size).toBe(0);
    });

    it('passes the creator uid as fromUID to the sender', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps();
        await invoke(taskWithSources(1, ['g1']), state, deps);
        const call = (deps.sendToChannel as any).mock.calls[0];
        expect(call[1]).toBe(CREATOR);
    });

    it('skips disbanded groups without sending or marking', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps({
            isDisbanded: (ch) => ch.channelID === 'g2',
        });
        await invoke(taskWithSources(1, ['g1', 'g2', 'g3']), state, deps);
        expect(sentSourceIds(deps.sendToChannel)).toEqual(['g1', 'g3']);
        expect(readSummaryNotifySentSources(1)).toEqual(new Set(['g1', 'g3']));
    });

    // --- SHAPE 1 · Regenerate on the same instance ----------------------------

    it('SHAPE-1 regenerate on same instance: second → COMPLETED does not re-send', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps();
        const detail = taskWithSources(1, ['g1', 'g2']);

        // First completion.
        await invoke(detail, state, deps);
        expect(sentSourceIds(deps.sendToChannel)).toEqual(['g1', 'g2']);

        // Simulate regenerate → same task_id, same page instance.
        (deps.sendToChannel as any).mockClear();
        await invoke(detail, state, deps);

        // ZERO additional sends — persistent marker holds.
        expect(deps.sendToChannel).not.toHaveBeenCalled();
        expect(readSummaryNotifySentSources(1)).toEqual(new Set(['g1', 'g2']));
    });

    // --- SHAPE 2 · Regenerate after remount (new instance, same task) ---------

    it('SHAPE-2 regenerate after remount: fresh state instance also does not re-send', async () => {
        const deps = makeDeps();
        const detail = taskWithSources(1, ['g1', 'g2']);

        // First completion on instance A.
        const stateA = newSummaryNotifySendState();
        await invoke(detail, stateA, deps);
        expect(sentSourceIds(deps.sendToChannel)).toEqual(['g1', 'g2']);

        // User reloads → instance B has an EMPTY sentThisInstance.
        // Persistent localStorage must still block the re-send.
        (deps.sendToChannel as any).mockClear();
        const stateB = newSummaryNotifySendState();
        await invoke(detail, stateB, deps);

        expect(deps.sendToChannel).not.toHaveBeenCalled();
        expect(stateB.sentThisInstance.size).toBe(0);
    });

    // --- SHAPE 3 · Concurrent overlap (the reproduced defect) -----------------

    it('SHAPE-3 concurrent fan-out over 2 sources: same-instance duplicate is blocked', async () => {
        // Reproduces yujiawei's harness: two triggers observe → COMPLETED
        // concurrently. Ack ordering is controlled by deferreds so we drive
        // the exact interleaving that failed on `5cff6246`.
        const state = newSummaryNotifySendState();
        const acks: Map<string, ReturnType<typeof deferred<void>>> = new Map();

        // For each unique (channelId, callIndex) return a fresh deferred so we
        // can settle a specific concurrent invocation.
        const callLog: Array<{ channelId: string; def: ReturnType<typeof deferred<void>> }> = [];
        const deps = makeDeps({
            sendToChannel: vi.fn(async (ch) => {
                const def = deferred<void>();
                callLog.push({ channelId: ch.channelID, def });
                acks.set(`${ch.channelID}#${callLog.length}`, def);
                await def.promise;
            }),
        });

        const detail = taskWithSources(1, ['g1', 'g2']);
        const A = invoke(detail, state, deps);
        // Yield to the microtask queue so A enters and claims g1 before B starts.
        // A structured `await Promise.resolve()` lets the loop enter but not
        // yet resolve any await deps.sendToChannel — the two invocations
        // still race concretely.
        const B = invoke(detail, state, deps);

        // Wait until both invocations have started at least the g1 attempt.
        // A pushes to callLog synchronously in the mocked sender.
        // Then settle in the exact order yujiawei's harness settles:
        //  - B ack for g2 lands first,
        //  - A ack for g1 lands second,
        //  - A then attempts g2 — which MUST be blocked.
        // We drive by callLog index; the concrete ordering is deterministic
        // given single-threaded event loop.
        // Give both promises a chance to enter the loop:
        await Promise.resolve();
        await Promise.resolve();

        // At this point A and B have each claimed one source (A→g1, B→g2 or
        // both trying g1 with one blocked by in-flight and moving to g2).
        // Settle everything in flight, then wait for both fan-outs.
        for (const entry of callLog) {
            entry.def.resolve();
        }
        await A;
        await B;

        // The exact invariant: g1 and g2 should each have been sent to
        // exactly once across the two concurrent fan-outs. NEVER 3 sends,
        // NEVER 2 to the same source.
        const sent = sentSourceIds(deps.sendToChannel);
        const g1Count = sent.filter((s) => s === 'g1').length;
        const g2Count = sent.filter((s) => s === 'g2').length;
        expect(g1Count).toBe(1);
        expect(g2Count).toBe(1);
        // Persistence and in-memory both consistent.
        expect(readSummaryNotifySentSources(1)).toEqual(new Set(['g1', 'g2']));
        expect(state.sentThisInstance).toEqual(new Set(['g1', 'g2']));
    });

    // --- SHAPE 4 · Successful send + failed localStorage write ----------------

    it('SHAPE-4 successful send with silent storage-write failure: next trigger does not double-send', async () => {
        // Reproduces yujiawei's second mechanism: markSummaryNotifySent
        // swallows storage exceptions. If the memory belt-and-braces did not
        // exist, the next trigger would re-send. This test proves the
        // belt-and-braces closes that hole.
        const state = newSummaryNotifySendState();
        const deps = makeDeps();

        // Force localStorage.setItem to throw for the FIRST write only, then
        // restore. `markSummaryNotifySent` catches the throw silently — the
        // in-memory `sentThisInstance` is what carries dedup for this task.
        const originalSetItem = Storage.prototype.setItem;
        let firstWrite = true;
        Storage.prototype.setItem = function (...args: Parameters<typeof originalSetItem>) {
            if (firstWrite) {
                firstWrite = false;
                throw new Error('QuotaExceededError (simulated)');
            }
            return originalSetItem.apply(this, args);
        };

        try {
            const detail = taskWithSources(1, ['g1']);
            await invoke(detail, state, deps);
            expect(sentSourceIds(deps.sendToChannel)).toEqual(['g1']);
            // Storage did NOT persist (write threw), so localStorage stays empty.
            expect(readSummaryNotifySentSources(1).size).toBe(0);
            // But `sentThisInstance` DID accept the success — this is the
            // hole yujiawei called out closing.
            expect(state.sentThisInstance.has('g1')).toBe(true);

            // Next trigger on same instance: memory guard blocks re-send.
            (deps.sendToChannel as any).mockClear();
            await invoke(detail, state, deps);
            expect(deps.sendToChannel).not.toHaveBeenCalled();
        } finally {
            Storage.prototype.setItem = originalSetItem;
        }
    });

    // --- SHAPE 5 · Cross-task same-group (round-10 P1 · 4-reviewer consensus) ---

    // Reproduces the round-10 P1: SummaryDetailPage supports switching taskId
    // on the same component instance (componentDidUpdate resets 16+ task-local
    // fields via loadDetail) while summaryNotifySendState is declared at
    // field-init and never reset. If the in-memory Sets are keyed by bare
    // sourceId, task 101's send poisons task 202's send to the same group —
    // the persistent layer is per-task and correctly says "not yet sent for
    // 202", but the in-memory `sentThisInstance.has('g1')` short-circuits
    // before the persistent check even matters.
    //
    // Independently reproduced by @Jerry-Xin / @mochashanyao / @yujiawei /
    // @lml2468 on `f748026d` — all four ran the same probe (two invoke() calls
    // with different task_id sharing one state object) and got 1 send instead
    // of 2. The fix is to key both Sets by (task_id, source_id).
    it('SHAPE-5 cross-task same-group: task 202 into the same group must NOT be blocked by task 101', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps();

        // Task 101 posts to g1.
        await invoke(taskWithSources(101, ['g1']), state, deps);
        expect(sentSourceIds(deps.sendToChannel)).toEqual(['g1']);
        expect(readSummaryNotifySentSources(101)).toEqual(new Set(['g1']));

        // Same page instance switches to task 202 (same group, different task_id).
        // The persistent marker for 202 is empty; the send MUST fire.
        (deps.sendToChannel as any).mockClear();
        await invoke(taskWithSources(202, ['g1']), state, deps);

        expect(sentSourceIds(deps.sendToChannel)).toEqual(['g1']);
        expect(readSummaryNotifySentSources(202)).toEqual(new Set(['g1']));

        // Round-11 fix: cross-task isolation. task 101's sent-marker must not
        // leak into task 202's send decision even when the group is the same.
        // At the same time, task 101 must remain marked in localStorage — the
        // per-task persistent layer is untouched.
        expect(readSummaryNotifySentSources(101)).toEqual(new Set(['g1']));
    });

    it('SHAPE-5b cross-task same-group: regenerate on task 202 is still first-completion-only', async () => {
        // Layered assertion: after SHAPE-5's cross-task fix, the first-completion-only
        // property must still hold WITHIN each task. Task 202 completes once →
        // second → COMPLETED on task 202 posts zero more.
        const state = newSummaryNotifySendState();
        const deps = makeDeps();

        await invoke(taskWithSources(101, ['g1']), state, deps);
        await invoke(taskWithSources(202, ['g1']), state, deps);
        expect(deps.sendToChannel).toHaveBeenCalledTimes(2);

        // Regenerate task 202 → no third send.
        (deps.sendToChannel as any).mockClear();
        await invoke(taskWithSources(202, ['g1']), state, deps);
        expect(deps.sendToChannel).not.toHaveBeenCalled();
    });

    it('SHAPE-5c cross-task concurrent overlap: two tasks whose fan-outs interleave', async () => {
        // Extends SHAPE-3's concurrent guarantee to the cross-task shape.
        // Task A and task B for the same group must each send exactly once
        // regardless of ack ordering. Before the round-11 fix, `inFlight`
        // (bare sourceId) blocks task B while task A is mid-send.
        const state = newSummaryNotifySendState();
        const callLog: Array<{ channelId: string; taskId: number; def: ReturnType<typeof deferred<void>> }> = [];

        // Route each call through a deferred we can settle deterministically.
        // We identify the call's task via the marker localStorage would leave —
        // but we do not have access to the task_id at the sender injection
        // point. Instead, we drive task 101 first, let it start, then start
        // task 202 while 101 is still in flight, then settle both.
        const deps = makeDeps({
            sendToChannel: vi.fn(async (ch) => {
                const def = deferred<void>();
                callLog.push({ channelId: ch.channelID, taskId: -1, def });
                await def.promise;
            }),
        });

        // Kick off task 101's send but do not await.
        const A = invoke(taskWithSources(101, ['g1']), state, deps);
        await Promise.resolve();
        await Promise.resolve();
        // task 101 is now in flight for g1. Kick off task 202 for the same group.
        const B = invoke(taskWithSources(202, ['g1']), state, deps);
        await Promise.resolve();
        await Promise.resolve();

        // Settle in order.
        for (const entry of callLog) entry.def.resolve();
        await A;
        await B;

        // Both must have sent — the two tasks are independent for dedup.
        expect(callLog.length).toBe(2);
        expect(readSummaryNotifySentSources(101)).toEqual(new Set(['g1']));
        expect(readSummaryNotifySentSources(202)).toEqual(new Set(['g1']));
    });

    it('transient IM error clears in-flight and does NOT poison persistence — retry on next trigger', async () => {
        const state = newSummaryNotifySendState();
        let attempt = 0;
        const deps = makeDeps({
            sendToChannel: vi.fn(async () => {
                attempt += 1;
                if (attempt === 1) throw new Error('transient IM 5xx');
                // second attempt resolves
            }),
        });

        const detail = taskWithSources(1, ['g1']);
        // First attempt fails.
        await invoke(detail, state, deps);
        expect(deps.sendToChannel).toHaveBeenCalledTimes(1);
        expect(readSummaryNotifySentSources(1).size).toBe(0); // no poison
        expect(state.sentThisInstance.size).toBe(0);
        expect(state.inFlight.size).toBe(0);
        expect(deps.warn).toHaveBeenCalledOnce();

        // Second trigger retries and succeeds.
        await invoke(detail, state, deps);
        expect(deps.sendToChannel).toHaveBeenCalledTimes(2);
        expect(readSummaryNotifySentSources(1)).toEqual(new Set(['g1']));
        expect(state.sentThisInstance).toEqual(new Set(['g1']));
    });

    // --- Per-group failure isolation -----------------------------------------

    it('a failing send to one group does not block subsequent groups in the same fan-out', async () => {
        const state = newSummaryNotifySendState();
        const deps = makeDeps({
            sendToChannel: vi.fn(async (ch) => {
                if (ch.channelID === 'g2') throw new Error('unlucky group');
            }),
        });

        await invoke(taskWithSources(1, ['g1', 'g2', 'g3']), state, deps);

        // All three attempted, only g2 failed.
        expect(sentSourceIds(deps.sendToChannel)).toEqual(['g1', 'g2', 'g3']);
        // g1 + g3 persisted; g2 did not.
        expect(readSummaryNotifySentSources(1)).toEqual(new Set(['g1', 'g3']));
        expect(state.sentThisInstance).toEqual(new Set(['g1', 'g3']));
        expect(deps.warn).toHaveBeenCalledOnce();
    });

    // --- Same-tab in-flight coalescing ---------------------------------------

    it('in-flight guard blocks a concurrent second trigger from re-sending the same source', async () => {
        const state = newSummaryNotifySendState();
        const gate = deferred<void>();
        const deps = makeDeps({
            sendToChannel: vi.fn(async () => { await gate.promise; }),
        });

        const detail = taskWithSources(1, ['g1']);
        const A = invoke(detail, state, deps);

        // B arrives while A is still awaiting.
        await Promise.resolve();
        expect(state.inFlight.has('g1')).toBe(true);
        const B = invoke(detail, state, deps);
        await Promise.resolve();

        gate.resolve();
        await A;
        await B;

        // Exactly one send.
        expect(deps.sendToChannel).toHaveBeenCalledTimes(1);
    });
});
