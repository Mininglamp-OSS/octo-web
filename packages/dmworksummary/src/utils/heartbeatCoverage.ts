// Subset check used by every consumer of the `summary-batch-heartbeat` event:
// a heartbeat from another poller is "covering" only when every task id we
// currently care about is included in the broadcast's payload. Partial-overlap
// payloads MUST NOT suppress our own polling, or the uncovered ids would
// never get a status update.
//
// Empty `myActiveIds` is trivially covered (nothing to ask about), which
// matches the behavior on the dispatcher side: we don't even start a poll
// tick when our active set is empty.
export function containsAllTaskIds(
    payloadIds: number[] | undefined,
    myActiveIds: number[],
): boolean {
    if (myActiveIds.length === 0) return true
    if (!payloadIds || payloadIds.length === 0) return false
    const payload = new Set(payloadIds)
    for (const id of myActiveIds) {
        if (!payload.has(id)) return false
    }
    return true
}

// Freshness window for the summary-batch-heartbeat protocol. A peer
// broadcast is treated as covering only while `Date.now() - lastEventTime
// <= COVERING_HEARTBEAT_WINDOW_MS`. Beyond it, the broadcaster is treated
// as gone and the listener resumes self-polling.
//
// Shared between SummaryDetailPage (the original 15s grace window) and
// ChatSummaryHistory (#334), so all protocol participants tune the same
// window in one place.
export const COVERING_HEARTBEAT_WINDOW_MS = 15_000;
