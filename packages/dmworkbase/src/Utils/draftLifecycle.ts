export type DraftPersistenceSource = "live" | "pending" | "empty"

export interface ResolveDraftAfterSendOptions {
    liveDraft?: string
    remoteDraft?: string
    remoteDraftAtSend?: string
    draftSavedAfterSend: boolean
    latestSavedDraft?: string
    latestSavedDraftSource?: DraftPersistenceSource
    sentDraft: string
    pendingDrafts: string[]
}

/**
 * Decide whether a successful send owns the persisted draft and, if it does,
 * what should remain after that send settles.
 *
 * `pendingDrafts` is ordered by send consumption. The currently executing send
 * is first; later queued sends remain behind it. A persisted pending draft is
 * therefore reduced from `A\nB` to `B` when A succeeds, then cleared when B
 * succeeds. A live draft is never owned by the send, even when its text happens
 * to be identical.
 */
export function resolveDraftAfterSend({
    liveDraft,
    remoteDraft,
    remoteDraftAtSend,
    draftSavedAfterSend,
    latestSavedDraft,
    latestSavedDraftSource,
    sentDraft,
    pendingDrafts,
}: ResolveDraftAfterSendOptions): string | undefined {
    if (liveDraft) return undefined

    const [currentPending = "", ...remainingPending] = pendingDrafts
    if (currentPending !== sentDraft) return undefined

    const pendingDraft = pendingDrafts.filter((draft) => draft.trim() !== "").join("\n")
    const remainingDraft = remainingPending
        .filter((draft) => draft.trim() !== "")
        .join("\n")

    if (draftSavedAfterSend) {
        const ownsPersistedPendingDraft =
            latestSavedDraftSource === "pending" &&
            (latestSavedDraft || "") === pendingDraft &&
            (remoteDraft || "") === pendingDraft
        return ownsPersistedPendingDraft ? remainingDraft : undefined
    }

    if ((remoteDraft || "") !== (remoteDraftAtSend || "")) return undefined

    return ""
}

export interface ResolveDraftToPersistOptions {
    /** What the composer currently holds. */
    liveDraft: string
    /** Plain text of composes handed to a send that has not settled yet. */
    pendingSendText: string
}

export interface ResolvedDraftPersistence {
    draft: string
    source: DraftPersistenceSource
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
 *   - while a send is in flight and the composer is empty, persist its text as a
 *     provisional draft so a pre-enqueue failure can survive editor teardown;
 *   - otherwise persist the (possibly empty) live value as before.
 */
export function resolveDraftToPersist({
    liveDraft,
    pendingSendText,
}: ResolveDraftToPersistOptions): ResolvedDraftPersistence {
    if (liveDraft.trim() !== "") return { draft: liveDraft, source: "live" }
    if (pendingSendText.trim() !== "") {
        return { draft: pendingSendText, source: "pending" }
    }
    return { draft: liveDraft, source: "empty" }
}
