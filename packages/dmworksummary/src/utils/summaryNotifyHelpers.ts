import type { SummaryDetail } from '../types/summary';

/**
 * Pure helpers for the client-side "group summary notify" tip send —
 * mirrors the screenshot-tip pattern (octo-ios WKConversationView
 * .userDidTakeScreenshot: `sendMessage(WKScreenshotContent.new)`).
 *
 * The actual send is wired in `utils/summaryNotifySender.ts` (integration
 * tested there) and orchestrated from `pages/SummaryDetailPage.tsx`. This
 * file holds:
 *
 *   1. Two pure decision gates — `shouldEmitGroupSummaryNotify` and
 *      `collectGroupSourceIds` — that the sender consults. Kept side-effect
 *      free so a unit test can drive them without pulling the singleton
 *      dependency graph in.
 *
 *   2. Three localStorage helpers — `readSummaryNotifySentSources`,
 *      `markSummaryNotifySent`, `summaryNotifySentKey` — that persist
 *      the first-completion-only dedup marker across reload / navigation /
 *      concurrent tabs. See the "First-completion-only persistence" section
 *      below for the full contract.
 *
 * # Trigger contract — the mode gate was removed in favour of source-driven emission
 *
 * The tip fires when a summary is **initiated from a group chat** — a
 * property of the task's `sources`, not of `summary_mode`. Whether the
 * result is partitioned per participant (BY_PERSON) or delivered as a
 * single team-level artifact (BY_GROUP) is orthogonal: both flavours, when
 * initiated from a group chat, should announce "{creator} 总结了群聊内容"
 * into that group.
 *
 * Rationale — the round-7 BY_GROUP gate that this note replaces was a
 * scope-violation defense premised on the assumption that BY_GROUP tasks
 * exist as a distinct product surface. That assumption does not hold in
 * the current deployment: the backend defines only `ModeByPerson = 2` in
 * `internal/model/model.go` (no `ModeByGroup` constant), and all three
 * task-creation entrypoints — `handler/task.go`, `handler/bot_summary_create.go`,
 * `handler/agent_summary.go` — hard-code `SummaryMode: model.ModeByPerson`.
 * Under that shape the gate `if (summary_mode !== BY_GROUP) return false`
 * suppresses every real-world tip end-to-end. Owner clarification (2026-08-11)
 * confirmed the intended trigger is "was this summary initiated from a
 * group chat?", so mode is not the right axis.
 *
 * The "don't announce into unrelated chats" invariant that the mode gate
 * was reaching for is preserved by the source filter in
 * `collectGroupSourceIds` — a task with no group entries in `sources`
 * yields an empty recipient list and the sender's per-source loop is a
 * no-op. This is a stronger property than the mode gate ever provided
 * (the mode gate would still have suppressed a BY_PERSON task that WAS
 * initiated from a group chat, which is exactly the user-visible bug that
 * motivated this change).
 *
 * Reviewer context:
 *
 *   - PR #1234 round-6 (@yujiawei) asked to retire an earlier persistent
 *     dedup design that stored a whole `runs` array with generation
 *     counters for exactly-once semantics. The design below is narrower
 *     (one boolean per group per task) and shipped in round-9 to close
 *     the "regenerate posts a tip depending on whether the creator
 *     refreshed" defect from round-8.
 *
 *   - PR #1283 round-7 P1 (@Jerry-Xin / @lml2468 / @yujiawei, three-way
 *     convergence) added the BY_GROUP mode gate on the concern that
 *     BY_PERSON summaries would fan out a group-level announcement they
 *     never produced. The concern is real for the shape reviewers had in
 *     mind — a BY_PERSON summary NOT initiated from a group chat — but
 *     under the current backend that shape does not exist end-to-end,
 *     and the shape that DOES exist (BY_PERSON with group sources,
 *     because the creator opened the chat and pressed the summarise
 *     button) is exactly the shape the tip should announce for. See the
 *     source-driven invariant above for how the "don't announce into
 *     unrelated chats" half of their concern is preserved.
 *
 *   - Multi-tab / cross-device dedup is best-effort, not exactly-once:
 *     localStorage is same-origin-same-profile shared, so two tabs on
 *     the same machine dedupe correctly; two devices do not, and the
 *     shipped design accepts that (parity with the screenshot tip). A
 *     server-side exactly-once sender is the parked architecture question.
 */

// Source-type constants mirror `packages/dmworksummary/src/types/summary.ts`
// (SourceType.GROUP_CHAT = 1). Duplicated here as a literal so the helpers stay
// side-effect-free — a bare number import from the enum module would drag the
// module graph and its side-effects into every unit test importing this helper.
const GROUP_CHAT_SOURCE_TYPE = 1 as const;

/**
 * Should the caller emit a "{creator} 总结了群聊内容" tip for `detail`?
 *
 * Only returns true when:
 *   - the current viewer's uid matches the task's creator_id (only creators
 *     announce their own summary — mirrors the screenshot-tip attribution
 *     invariant that the actor is always the authenticated sender);
 *   - the task is in a settled COMPLETED state (FAILED / CANCELLED / mid-flight
 *     never announce);
 *   - myUid is non-empty (logged-out fallback would render as "someone…" and
 *     defeat the point of the tip);
 *   - creator_id is non-empty (defensive: a task with no creator cannot have
 *     an authenticated announcement path).
 *
 * `summary_mode` is intentionally NOT consulted — see the module doc block
 * ("Trigger contract — the mode gate was removed in favour of source-driven
 * emission") for the product rationale. In one line: whether the tip fires
 * is a function of "was this summary initiated from a group chat?" (a
 * property of `sources`), not of "how is the result partitioned per
 * participant?" (which is what `summary_mode` records). `collectGroupSourceIds`
 * enforces the source-driven half of the contract by returning `[]` when
 * `sources` has no group entries, at which point the sender fans out to
 * nobody and the invariant "we only announce into groups this summary was
 * actually about" is preserved without a mode gate.
 */
export function shouldEmitGroupSummaryNotify(
    detail: Pick<SummaryDetail, 'status' | 'creator_id'>,
    myUid: string | undefined,
    completedStatus: number,
): boolean {
    if (!myUid) return false;
    if (!detail.creator_id) return false;
    if (detail.creator_id !== myUid) return false;
    if (detail.status !== completedStatus) return false;
    return true;
}

/**
 * Extract the unique GROUP_CHAT source_ids from a task's sources list.
 *
 *   - Filters out DM / thread source_types (only groups get the tip).
 *   - Filters out empty source_id strings (defensive against malformed rows).
 *   - Deduplicates identical source_ids so the same group is never notified
 *     twice within a single fan-out (defensive against upstream duplication
 *     in `sources`).
 *
 * Returned order preserves the first-seen order from `sources` — stable for
 * tests and log inspection.
 */
export function collectGroupSourceIds(sources: SummaryDetail['sources'] | undefined): string[] {
    if (!sources || sources.length === 0) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const src of sources) {
        if (src.source_type !== GROUP_CHAT_SOURCE_TYPE) continue;
        if (!src.source_id) continue;
        if (seen.has(src.source_id)) continue;
        seen.add(src.source_id);
        out.push(src.source_id);
    }
    return out;
}

// ---------------------------------------------------------------------------
// First-completion-only persistence — #1283 round-8 P1-A (Jerry-Xin + yujiawei)
// ---------------------------------------------------------------------------
//
// Product decision (this PR): a summary-notify tip fires ONCE PER TASK, not
// once per completion transition. Regenerate is an internal quality tuning
// step by the creator and must not spam the group. Screenshot-tip parity is
// intentionally rejected here — the two features have different UX contracts:
// screenshot is a discrete action that repeats, "summarize the chat" is a
// single event about one task.
//
// Without persistent state the in-page instance's Set can guarantee this only
// until unmount. A reload / navigation between the first completion and the
// regenerate re-observes the → COMPLETED edge with an empty Set and posts a
// second tip. yujiawei's round-8 P1-A pinned this precisely: whether N
// regenerations produced N tips or 1 was a function of the creator's
// navigation history, which is the defect.
//
// The persistence layer is deliberately narrow — one localStorage key per
// (task_id, source_id) recording "tip sent to this group for this task,
// ever". No Web Locks, no completion-run version, no cross-completion
// bookkeeping. This is smaller in surface than the localStorage design
// yujiawei asked to retire in round-6 (which stored a whole runs array with
// generation counters for exactly-once semantics); this version records a
// single boolean per group, which is what the "once per task" contract
// actually needs.

/** Storage key for the sent-set of one task. See summaryNotifyHelpers header. */
export function summaryNotifySentKey(taskId: number | string): string {
    return `summary-notify-sent:${taskId}`;
}

/**
 * Read the set of source_ids that have already received a tip for this task.
 *
 * Failure modes (private-mode / quota / malformed JSON / non-array payload)
 * degrade to "no known sends" — the same-instance in-flight Set will still
 * coalesce concurrent triggers, and worst case is one duplicate rather than a
 * permanent silent hole. That fail-open bias is intentional: a tip that
 * silently never fires is a worse product failure than a rare duplicate.
 */
export function readSummaryNotifySentSources(taskId: number | string): Set<string> {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(summaryNotifySentKey(taskId)) : null;
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.filter((x): x is string => typeof x === 'string' && x.length > 0));
    } catch {
        return new Set();
    }
}

/**
 * Record that `sourceId` has now received a tip for `taskId`.
 *
 * Reads the current set and re-writes with the union of `{sourceId}` and the
 * read result. This narrows — but does not fully close — the lost-update
 * window against another tab that writes to the same key: `getItem` +
 * `setItem` is not atomic, so a concurrent tab that computes the union
 * against a slightly earlier snapshot can clobber. The consequence in the
 * worst case is one duplicate tip on a future page load; still inside the
 * "best-effort, not exactly-once" trade-off this design accepts.
 * `SummaryNotifySendState.sentThisInstance` (in `summaryNotifySender.ts`) is
 * the belt-and-braces for the same-instance case, so within one page instance
 * the property holds even if this write silently drops.
 *
 * Called after `sendToChannel` (i.e. `chatManager.send`) resolves. The SDK's
 * `send()` resolves once the packet is enqueued in-process — it does NOT
 * await the server SendackPacket, and the socket write can be dropped
 * silently if the WebSocket is not OPEN (wukongimjssdk@1.3.5). So this
 * marker records "we attempted to deliver, and the local SDK accepted the
 * enqueue", NOT "the server has acknowledged the send". Under the one-time
 * contract, a completion that fires while the socket is mid-reconnect can
 * therefore end up marked-sent without the group ever receiving the tip.
 * This is the accepted best-effort posture and matches the screenshot-tip
 * precedent; do not restate it as an ack-gated guarantee.
 */
export function markSummaryNotifySent(taskId: number | string, sourceId: string): void {
    if (!sourceId) return;
    if (typeof localStorage === 'undefined') return;
    try {
        // Re-read to merge concurrent tab writes rather than clobber them.
        const set = readSummaryNotifySentSources(taskId);
        if (set.has(sourceId)) return;
        set.add(sourceId);
        localStorage.setItem(summaryNotifySentKey(taskId), JSON.stringify([...set]));
    } catch {
        // localStorage unavailable (private-mode / quota) — accept a possible
        // duplicate on a future load rather than fail the current send.
    }
}

/**
 * Should this observation of `newStatus` count as a transition edge that
 * fires the group summary notify?
 *
 * The rule is exactly what both trigger sites in SummaryDetailPage encode
 * today, extracted so a test can drive it and so the "late-return after a
 * task switch mid-await" fix can reuse it against a captured snapshot
 * rather than the live `this.state.lastKnownStatus` (which by then reflects
 * the new task and would silently drop the old task's completion edge).
 *
 * Fires when:
 *   - a previous status has been observed (`prevStatus !== undefined`) — the
 *     first load of an already-COMPLETED task must NOT re-fire the tip,
 *   - the status actually changed (`prevStatus !== newStatus`),
 *   - the destination is `COMPLETED` (`FAILED` / `CANCELLED` transitions do
 *     not warrant a group tip — those are private to the creator).
 *
 * #1283 round-11 P1 (@mochashanyao): both trigger paths currently drop the
 * observed edge when `this.taskId !== requestTaskId` returns before the
 * transition decision runs. The fix captures the value BEFORE the await and
 * calls this predicate on the captured pair, so the tip fires for the
 * originally-observed task even when the user has clicked away.
 */
export function shouldEmitOnStatusTransition(
    prevStatus: number | undefined,
    newStatus: number,
    completedStatus: number,
): boolean {
    if (prevStatus === undefined) return false;
    if (prevStatus === newStatus) return false;
    return newStatus === completedStatus;
}
