export interface ShouldClearDraftAfterSendOptions {
    liveDraft?: string
    remoteDraft?: string
    remoteDraftAtSend?: string
    draftSavedAfterSend: boolean
    latestSavedDraft?: string
}

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
