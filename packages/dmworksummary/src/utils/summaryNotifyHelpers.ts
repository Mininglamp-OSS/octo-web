import type { SummaryDetail } from '../types/summary';

/**
 * Pure helpers for the client-side "group summary notify" tip send —
 * mirrors the screenshot-tip pattern (octo-ios WKConversationView
 * .userDidTakeScreenshot: `sendMessage(WKScreenshotContent.new)`).
 *
 * The actual send is done in-class in SummaryDetailPage.sendGroupSummaryNotify
 * so it can reference this.summaryNotifyInFlight, WKApp / WKSDK singletons,
 * and the `Channel` / `SummaryNotifyContent` types without dragging every
 * dependency into a pure-helper unit test. The two functions here are the
 * decisions that are easy to test AND easy to get wrong; the class method
 * exists to combine them with the singleton-heavy IM call.
 *
 * Reviewer context: PR #1234 round-6 (@yujiawei) recommended retiring the
 * persistent localStorage / Web-Lock dedup and accepting rare duplicates on
 * multi-tab as a best-effort trade-off (parity with screenshot-tip). These
 * helpers reflect that decision: no persistent state, no cross-tab locking,
 * only the two decisions that must always hold:
 *
 *   1. shouldEmitGroupSummaryNotify — a viewer that is not the creator, or a
 *      task that is not COMPLETED, must never trigger a send even if the
 *      caller forgets to guard;
 *
 *   2. collectGroupSourceIds — DM / thread sources must never be treated as a
 *      group channel (would fail server-side and leak intent to the wrong
 *      channel type), and duplicate source_ids in the sources array must
 *      collapse to one send.
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
 *   - the task is BY_GROUP mode (positive check — a future third mode will
 *     default to *not* announcing, which is the safer default for a passive
 *     public tip. BY_PERSON summaries are per-participant and never produce
 *     the group-level "group summary" this tip announces, so announcing one
 *     into the group would be a scope violation. #1283 round-7 P1 raised
 *     independently by @Jerry-Xin / @lml2468 / @yujiawei.);
 *   - myUid is non-empty (logged-out fallback would render as "someone…" and
 *     defeat the point of the tip);
 *   - creator_id is non-empty (defensive: a task with no creator cannot have
 *     an authenticated announcement path).
 */
export function shouldEmitGroupSummaryNotify(
    detail: Pick<SummaryDetail, 'status' | 'creator_id' | 'summary_mode'>,
    myUid: string,
    completedStatus: number,
    byGroupMode: number,
): boolean {
    if (!myUid) return false;
    if (!detail.creator_id) return false;
    if (detail.creator_id !== myUid) return false;
    if (detail.status !== completedStatus) return false;
    // Positive BY_GROUP gate — a future third mode defaults to no announcement.
    if (detail.summary_mode !== byGroupMode) return false;
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
