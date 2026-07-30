export interface ShouldClearDraftAfterSendOptions {
    liveDraft?: string
    draftAtSend: string
    remoteDraft?: string
    remoteDraftAtSend?: string
    draftSavedAfterSend: boolean
    latestSavedDraft?: string
}

export function shouldClearDraftAfterSend({
    liveDraft,
    draftAtSend,
    remoteDraft,
    remoteDraftAtSend,
    draftSavedAfterSend,
    latestSavedDraft,
}: ShouldClearDraftAfterSendOptions): boolean {
    // MessageInput clears the editor only after onSend resolves, so the sent
    // snapshot can still be live here. Only a different value is a newer draft.
    if (liveDraft && liveDraft !== draftAtSend) return false
    if (
        draftSavedAfterSend &&
        latestSavedDraft &&
        latestSavedDraft !== draftAtSend
    ) return false
    if ((remoteDraft || "") !== (remoteDraftAtSend || "")) return false

    return true
}
