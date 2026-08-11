export interface ShouldClearDraftAfterSendOptions {
    liveDraft?: string
    draftAtSend: string
    remoteDraft?: string
    remoteDraftAtSend?: string
    draftSavedAfterSend: boolean
    latestSavedDraft?: string
}

/**
 * Decide whether the remote draft may be cleared after a send.
 *
 * Since octo-web#1280 the composer is consumed synchronously when the send
 * starts, so `draftAtSend` (read inside `onSend`) is the empty string for an
 * immediate send and, for a queued one, whatever the user has typed since. The
 * comparison below therefore reads as "has the composer moved on since this send
 * was handed over?" — if it has, the newer draft is authoritative and must not be
 * cleared; the sent content is no longer a draft in either case.
 */
export function shouldClearDraftAfterSend({
    liveDraft,
    draftAtSend,
    remoteDraft,
    remoteDraftAtSend,
    draftSavedAfterSend,
    latestSavedDraft,
}: ShouldClearDraftAfterSendOptions): boolean {
    // Only a value that differs from what was handed to this send counts as a
    // newer draft (see the note above about consume-first).
    if (liveDraft && liveDraft !== draftAtSend) return false
    if (
        draftSavedAfterSend &&
        latestSavedDraft &&
        latestSavedDraft !== draftAtSend
    ) return false
    if ((remoteDraft || "") !== (remoteDraftAtSend || "")) return false

    return true
}

export interface ResolveDraftToPersistOptions {
    /** What the composer currently holds. */
    liveDraft: string
    /** Plain text of composes handed to a send that has not settled yet. */
    pendingSendText: string
    /** The draft currently stored for this conversation. */
    existingDraft: string
}

/**
 * Decide what to persist as the conversation draft (octo-web#1280).
 *
 * The composer is emptied the moment a send starts, so a draft save that happens
 * during an in-flight send (leaving the conversation is the common trigger) used
 * to write an EMPTY draft over content that had not been enqueued yet — the
 * composer, the draft and the message list were then all empty at once.
 *
 * Rules:
 *   - the live composer content always wins (the user's newest intent);
 *   - while a send is in flight and the composer is empty, keep the stored draft
 *     as-is instead of clearing it — the in-flight content is not a draft (it is
 *     about to become a message, and its bubble owns retry from then on), but it
 *     must not destroy an older draft either;
 *   - otherwise persist the (possibly empty) live value as before.
 */
export function resolveDraftToPersist({
    liveDraft,
    pendingSendText,
    existingDraft,
}: ResolveDraftToPersistOptions): string {
    if (liveDraft.trim() !== "") return liveDraft
    if (pendingSendText.trim() !== "") return existingDraft
    return liveDraft
}
