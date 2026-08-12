import type { PendingSendDraft } from "../features/chat-composer/domain";

export type DraftPersistenceSource = "live" | "pending" | "empty";

export interface ResolveDraftAfterSendOptions {
  attemptId: string;
  liveDraft?: string;
  remoteDraft?: string;
  remoteDraftAtSend?: string;
  draftSavedAfterSend: boolean;
  latestSavedDraft?: string;
  latestSavedDraftSource?: DraftPersistenceSource;
  latestSavedPendingAttemptIds?: string[];
  pendingDrafts: PendingSendDraft[];
}

function joinDrafts(drafts: PendingSendDraft[]): string {
  return drafts
    .map(({ draftText }) => draftText)
    .filter((draft) => draft.trim() !== "")
    .join("\n");
}

function sameIds(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((attemptId, index) => attemptId === right[index])
  );
}

/**
 * Resolve persisted draft cleanup for one settled compose attempt.
 *
 * Attempt IDs own provisional draft entries. Text comparisons are used only as
 * optimistic concurrency checks against remote state and never identify which
 * compose attempt is settling.
 */
export function resolveDraftAfterSend({
  attemptId,
  liveDraft,
  remoteDraft,
  remoteDraftAtSend,
  draftSavedAfterSend,
  latestSavedDraft,
  latestSavedDraftSource,
  latestSavedPendingAttemptIds = [],
  pendingDrafts,
}: ResolveDraftAfterSendOptions): string | undefined {
  if (liveDraft) return undefined;
  if (pendingDrafts[0]?.attemptId !== attemptId) return undefined;

  if (draftSavedAfterSend) {
    if (latestSavedDraftSource !== "pending") return undefined;
    if (!latestSavedPendingAttemptIds.includes(attemptId)) return undefined;

    const ownedDrafts = latestSavedPendingAttemptIds.map((ownedAttemptId) =>
      pendingDrafts.find(({ attemptId: pendingId }) => pendingId === ownedAttemptId),
    );
    if (ownedDrafts.some((draft) => !draft)) return undefined;

    const savedDrafts = ownedDrafts as PendingSendDraft[];
    if (
      !sameIds(
        savedDrafts.map(({ attemptId: savedAttemptId }) => savedAttemptId),
        latestSavedPendingAttemptIds,
      ) ||
      (latestSavedDraft || "") !== joinDrafts(savedDrafts) ||
      (remoteDraft || "") !== (latestSavedDraft || "")
    ) {
      return undefined;
    }

    return joinDrafts(
      savedDrafts.filter(({ attemptId: savedAttemptId }) => savedAttemptId !== attemptId),
    );
  }

  if ((remoteDraft || "") !== (remoteDraftAtSend || "")) return undefined;
  return "";
}

export interface ResolveDraftToPersistOptions {
  /** What the composer currently holds. */
  liveDraft: string;
  /** Captured composes that have not produced all local bubbles yet. */
  pendingDrafts: PendingSendDraft[];
}

export interface ResolvedDraftPersistence {
  draft: string;
  source: DraftPersistenceSource;
  pendingAttemptIds: string[];
}

/** Resolve the draft payload and its attempt-based ownership metadata. */
export function resolveDraftToPersist({
  liveDraft,
  pendingDrafts,
}: ResolveDraftToPersistOptions): ResolvedDraftPersistence {
  if (liveDraft.trim() !== "") {
    return { draft: liveDraft, source: "live", pendingAttemptIds: [] };
  }

  const ownedPendingDrafts = pendingDrafts.filter(
    ({ draftText }) => draftText.trim() !== "",
  );
  const pendingDraft = joinDrafts(ownedPendingDrafts);
  if (pendingDraft !== "") {
    return {
      draft: pendingDraft,
      source: "pending",
      pendingAttemptIds: ownedPendingDrafts.map(({ attemptId }) => attemptId),
    };
  }

  return { draft: liveDraft, source: "empty", pendingAttemptIds: [] };
}
