import { Channel } from "wukongimjssdk";
import type { SummaryDetail } from '../types/summary';
import {
    shouldEmitGroupSummaryNotify,
    collectGroupSourceIds,
    readSummaryNotifySentSources,
    markSummaryNotifySent,
} from './summaryNotifyHelpers';

/**
 * Collaborators injected into `sendGroupSummaryNotify`. Extracted as a plain
 * object rather than a class so tests can drive it with pure stubs — the class
 * method that previously lived in SummaryDetailPage.sendGroupSummaryNotify
 * accumulated three consecutive rounds of "the invariant is asserted in prose
 * but no test executes the method" review findings; injecting the two side
 * effects (SDK send, disband check) lets integration tests assert those
 * invariants directly.
 *
 * IM_SEND is called ONLY for a channel this function has decided to post to
 * (after all gates: creator, status, BY_GROUP, persistent-marker, in-flight,
 * disbanded). Its throw is caught locally, so per-group failure isolation
 * does not depend on the caller. Successful returns cause a persistent
 * markSummaryNotifySent — a failed storage write is tolerated (fail-open,
 * see notes below) and the same-instance memory set below closes that gap.
 *
 * IS_DISBANDED is a per-source predicate consulted after in-flight but
 * before send, matching the invariant every other group send path in the
 * codebase already respects (isConversationDisbanded ← isChannelDisbanded).
 * Fail-open on cache miss is deliberate — a cached-but-nameless channel
 * is not silently muted (round-8 P2 @yujiawei).
 */
export interface SummaryNotifySendDeps {
    /** Called once per group source we decide to notify. Throws are caught. */
    sendToChannel: (channel: Channel, fromUID: string) => Promise<void>;
    /** Skip disbanded groups. Fail-open on cache miss (see doc block). */
    isDisbanded: (channel: Channel) => boolean;
    /**
     * Optional log sink for failures. Defaults to console.warn; tests can
     * capture it as a jest.fn() / vi.fn() to assert observability without
     * polluting the test output.
     */
    warn?: (message: string, ctx: { channelId: string; error: unknown }) => void;
}

/**
 * Per-page-instance state that persists across triggers on the same
 * SummaryDetailPage. `inFlight` coalesces the two overlapping trigger paths
 * (status-event handler + fallback poll); `sentThisInstance` is the memory
 * belt-and-braces added in round-10 to close the reviewer-reproduced
 * "successful send + failed localStorage write → next trigger re-sends" hole
 * and the "read-once snapshot → concurrent fan-out re-sends the second
 * group" hole. Both were called out by @yujiawei on `5cff6246`.
 *
 * Both fields are Sets keyed by `${task_id}:${sourceId}` — round-11 change
 * (4-reviewer consensus @Jerry-Xin @mochashanyao @yujiawei @lml2468 on
 * `f748026d`). SummaryDetailPage can serve multiple task_ids on the same
 * instance (componentDidUpdate task-switch branch reloads detail without
 * remounting the component). With sourceId-only keys, task A's send to group
 * G silently blocked task B's send to the same G. Compound keying keeps the
 * dedup guarantee INTRA-task while allowing cross-task fan-outs to the same
 * group to proceed independently. The persistent localStorage layer is
 * already scoped per task (`summary-notify-sent:<taskId>`), so the three
 * dedup layers now agree on scope.
 *
 * Two triggers on the same (task, source) fan-out share state; a task change
 * on the same page instance starts every source fresh (though the persistent
 * layer still applies its own once-per-task gate).
 */
export interface SummaryNotifySendState {
    /** Sends currently in flight, keyed by `${task_id}:${sourceId}`. */
    inFlight: Set<string>;
    /** Sends that resolved successfully in THIS page instance, keyed by `${task_id}:${sourceId}`. */
    sentThisInstance: Set<string>;
}

/**
 * Build a fresh state object. Callers own the lifecycle — SummaryDetailPage
 * keeps one instance across the page's mount, and clears it if it wants to.
 */
export function newSummaryNotifySendState(): SummaryNotifySendState {
    return {
        inFlight: new Set(),
        sentThisInstance: new Set(),
    };
}

/**
 * Group-tip fan-out. Extracted from SummaryDetailPage so it can be exercised
 * under a plain vitest harness with an injectable sender. All the invariants
 * the round-8 / round-9 doc blocks used to state in prose are now asserted by
 * `summaryNotifySender.test.ts`.
 *
 * Contract (in order):
 *   1. Emit-gate — shouldEmitGroupSummaryNotify + collectGroupSourceIds; the
 *      creator / non-empty myUid / status / BY_GROUP checks live in the
 *      helpers so a caller that forgets to guard cannot leak.
 *   2. Per-source dedup — check FRESH localStorage read AND the in-memory
 *      `sentThisInstance` AND the `inFlight` set. A stale snapshot is a
 *      correctness bug (yujiawei reproduced it on `5cff6246`), so we re-read
 *      right before each send rather than snapshotting once per fan-out.
 *   3. Disband skip — via injected predicate.
 *   4. In-flight claim → send → mark success → clear in-flight.
 *   5. Failure logs via `warn` and clears in-flight so a later trigger can
 *      retry. NO persistent marker on failure.
 *
 * The `sentThisInstance` memory set is written UNCONDITIONALLY on success —
 * so even if `markSummaryNotifySent` silently drops the write (private mode,
 * quota, storage exception), the current page instance still remembers.
 * `inFlight` is cleared unconditionally in `finally` because either
 * `sentThisInstance` or the caller's next-trigger `readSummaryNotifySentSources`
 * will now hold the dedup guarantee — persistence has taken over.
 */
export async function sendGroupSummaryNotifyImpl(
    detail: SummaryDetail,
    myUid: string | undefined,
    state: SummaryNotifySendState,
    deps: SummaryNotifySendDeps,
    completedStatus: number,
    byGroupMode: number,
    channelTypeGroup: number,
): Promise<void> {
    if (!shouldEmitGroupSummaryNotify(detail, myUid, completedStatus, byGroupMode)) return;
    if (!myUid) return; // narrow for TS after helper predicate

    const groupSourceIds = collectGroupSourceIds(detail.sources);
    if (groupSourceIds.length === 0) return;

    const warn = deps.warn ?? ((msg, ctx) => { try { console.warn(msg, ctx); } catch { /* ignore */ } });

    for (const sourceId of groupSourceIds) {
        // Round-10 (@yujiawei on `5cff6246`): re-read localStorage per source
        // rather than snapshot once per fan-out. Two concurrent fan-outs
        // reading the same stale snapshot were the reproduced double-send.
        const alreadySentPersisted = readSummaryNotifySentSources(detail.task_id);

        if (alreadySentPersisted.has(sourceId)) continue;
        // Round-11 (4-reviewer consensus on `f748026d`): key by
        // `${task_id}:${sourceId}` so task A's send to group G does not
        // silently suppress task B's send to the same G on a page instance
        // reused via componentDidUpdate task switch.
        const memoryKey = `${detail.task_id}:${sourceId}`;
        // Belt-and-braces: in-memory set survives storage-write failure
        // (SHAPE-4) but stays intra-task via the task-scoped key.
        if (state.sentThisInstance.has(memoryKey)) continue;
        if (state.inFlight.has(memoryKey)) continue;

        const ch = new Channel(sourceId, channelTypeGroup);
        // isConversationDisbanded is a cache lookup by (channelID, channelType);
        // an unhydrated `Channel` value is a valid key. Fail-open on true cache
        // miss (Utils/groupDisband:38-46) — matches every other group send path.
        if (deps.isDisbanded(ch)) continue;

        state.inFlight.add(memoryKey);
        try {
            await deps.sendToChannel(ch, myUid);
            // Write to persistent storage first, so a fast follow-up trigger
            // reading the storage sees the record. Then also into the
            // in-instance memory set — the belt-and-braces guarantees dedup
            // even if the storage write silently dropped.
            markSummaryNotifySent(detail.task_id, sourceId);
            state.sentThisInstance.add(memoryKey);
        } catch (error) {
            warn("[summaryNotify] send failed", { channelId: sourceId, error });
            // No markSummaryNotifySent on failure — recovery relies on either
            // a later observed → COMPLETED edge on this task (rare in
            // production: both triggers advance lastKnownStatus BEFORE the
            // fan-out, so only manual regenerate re-fires) OR a page reload
            // that re-reads localStorage (finds this source unmarked) OR the
            // creator navigating back to the same task from a card. Best-
            // effort tip; a transient IM 5xx can still lose the tip for
            // that single completion window and only console.warn records
            // it. Accepted trade-off — the alternative is retrying inside
            // this method against a client we do not control the ordering of.
        } finally {
            state.inFlight.delete(memoryKey);
        }
    }
}
