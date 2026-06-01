export interface ShouldClearDraftAfterSendOptions {
    sentDraftSnapshot: string
    liveDraft?: string
    remoteDraft?: string
    draftSavedAfterSend: boolean
    latestSavedDraft?: string
}

export function shouldClearDraftAfterSend({
    sentDraftSnapshot,
    liveDraft,
    remoteDraft,
    draftSavedAfterSend,
    latestSavedDraft,
}: ShouldClearDraftAfterSendOptions): boolean {
    if (liveDraft) return false
    if (draftSavedAfterSend && latestSavedDraft) return false

    const currentRemoteDraft = remoteDraft || ""
    return currentRemoteDraft === "" || currentRemoteDraft === sentDraftSnapshot
}
