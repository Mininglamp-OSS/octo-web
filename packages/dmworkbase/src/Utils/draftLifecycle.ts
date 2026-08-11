export interface ShouldClearDraftAfterSendOptions {
    liveDraft?: string
    remoteDraft?: string
    remoteDraftAtSend?: string
    draftSavedAfterSend: boolean
    latestSavedDraft?: string
}

/**
 * Decide whether the remote draft may be cleared after a send.
 *
 * Since octo-web#1280 the composer is consumed synchronously. Any non-empty live
 * draft after that point is newer input, even if it happens to equal the sent
 * text. The generation and remote snapshot must be captured at consume time so a
 * queued send cannot mistake a draft saved while it waited for its own snapshot.
 */
export function shouldClearDraftAfterSend({
    liveDraft,
    remoteDraft,
    remoteDraftAtSend,
    draftSavedAfterSend,
    latestSavedDraft,
}: ShouldClearDraftAfterSendOptions): boolean {
    if (liveDraft) return false
    if (draftSavedAfterSend && latestSavedDraft) return false
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
