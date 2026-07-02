/**
 * Send-flow orchestration helper (octo-web#227, Jerry-Xin P1).
 *
 * Background — two data-loss bugs this guards against:
 *
 * 1. (round 1) `MessageInput.send()` used to call `props.onSend(...)` (typed
 *    `=> void`, never awaited) and then, in the *same synchronous frame*,
 *    unconditionally cleared the editor, deleted pasted-image `File` refs,
 *    revoked preview URLs and cleared the top-attachment area. For the mixed
 *    text+image RichText path `onSend` is async and only fails after an upload,
 *    so the compose state was destroyed before the failure was known — one
 *    failed upload wiped the whole draft with nothing to retry.
 *    Fix: make the contract awaitable and clean up ONLY after a successful send.
 *
 * 2. (round 2 — this file's reason for being snapshot-aware) Once the send was
 *    awaited, the editor stayed editable during the wait. `Conversation.onSend`
 *    can take seconds (image upload + message ack). If the user finished one
 *    message and started typing the next while the first was still pending, the
 *    successful completion of the *older* send cleared the *current* (newer)
 *    editor document and top-attachment list — wiping the new draft. Pure text
 *    is affected too, because the callback now awaits `sendTextAndWaitAck`.
 *    Fix: cleanup is snapshot-aware. The editor is only cleared if it still
 *    holds exactly the content that was sent (`isEditorUnchanged`); otherwise
 *    the user's newer draft is left untouched. Top attachments are removed by
 *    the specific ids that were consumed, never with a blanket reset, so items
 *    queued during the wait survive.
 *    Residual follow-up (octo-web#458, now fixed): when the editor changed
 *    mid-flight we used to leave the live doc untouched, so the already-sent
 *    snapshot blocks stayed alongside the new draft. The fix: a
 *    `removeSentContent` callback surgically removes the submitted snapshot
 *    range while preserving the new draft — opt-in via `SendCleanup`, backward
 *    compatible with callers that don't provide it.
 *
 * `onSend` return-value contract (back-compatible):
 *   - `undefined` / `void` → success: editor consumed, all consumed top
 *     attachments cleared (legacy void-returning callers keep working);
 *   - `true`               → success: same as void;
 *   - `false`              → failure / nothing sent: PRESERVE everything so the
 *     user can retry;
 *   - `{ editorConsumed, consumedTopIds }` → partial result. Lets a caller say
 *     "the editor compose failed and must be preserved, but these top
 *     attachments were already sent — drop just those so a retry does not
 *     duplicate them" (octo-web#227 non-blocking note by Jerry-Xin);
 *   - throws               → treated as failure → preserve everything.
 */

/** Partial send outcome — see contract above. */
export interface SendResultDetail {
  /** Whether the editor compose (text + pasted images / ordered blocks) was
   *  sent. `true` → the editor may be cleared; `false` → preserve it. */
  editorConsumed: boolean;
  /** Ids of top attachments that were actually sent. Only these are removed
   *  from the top-attachment area. Omit to derive from `editorConsumed`. */
  consumedTopIds?: string[];
}

export type SendResult = void | boolean | SendResultDetail;

/** Snapshot-aware cleanup steps, run after the send settles. */
export interface SendCleanup {
  /**
   * True iff the editor still holds exactly the document that was sent, i.e. the
   * user has NOT started a new draft during the await. Editor-scoped cleanup is
   * skipped when this returns false so a newer draft is never wiped by an older
   * send.
   */
  isEditorUnchanged: () => boolean;
  /** Delete in-memory pasted-image File refs consumed by this send. */
  deleteEditorAttachmentRefs: () => void;
  /** Revoke object URLs for the editor's pasted-image previews. */
  revokeEditorPreviewUrls: () => void;
  /** Clear the editor document. */
  clearEditor: () => void;
  /**
   * Remove the given top attachments (by id) and revoke their preview URLs.
   * Id-scoped so attachments queued during the await are preserved.
   */
  removeTopAttachments: (ids: string[]) => void;
  /** Optional: collapse the expanded composer (only when the editor is cleared). */
  collapseExpanded?: () => void;

  // ── octo-web#458: partial editor cleanup when draft changed mid-flight ──
  //
  // When the editor content changed during the send await, the old behavior
  // left the entire live doc untouched — including the already-sent content.
  // The fix: remove only the submitted snapshot range from the editor while
  // preserving the newly typed draft. Both fields are optional for backward
  // compatibility; when absent the old "leave as-is" behavior applies.

  /** Number of content-size units (ProseMirror `content.size`) in the snapshot
   *  document that was passed to `onSend`. Used to compute the deletion range
   *  when removing the sent portion from the live doc. */
  snapshotContentSize?: number;
  /** Remove the already-sent snapshot range from the live editor document,
   *  preserving any content the user typed after the snapshot. */
  removeSentContent?: () => void;
}

/** Normalize the loose `SendResult` union into an explicit decision. */
function normalizeResult(
  result: SendResult,
  allTopIds: string[],
): { editorConsumed: boolean; consumedTopIds: string[] } {
  if (result === false) {
    return { editorConsumed: false, consumedTopIds: [] };
  }
  if (result === true || result == null) {
    // void / undefined / true → full success.
    return { editorConsumed: true, consumedTopIds: allTopIds };
  }
  // Detailed partial result.
  return {
    editorConsumed: result.editorConsumed,
    consumedTopIds:
      result.consumedTopIds ?? (result.editorConsumed ? allTopIds : []),
  };
}

/**
 * Await `send()` and apply snapshot-aware compose cleanup.
 *
 * - Consumed top attachments are removed by id (safe even if the user queued
 *   more during the wait).
 * - The editor is cleared only if its compose was consumed AND it still holds
 *   exactly what was sent; if the user typed a new draft meanwhile it is left
 *   intact.
 *
 * @param allTopIds Ids of every top attachment handed to this send attempt;
 *   used to expand a `true`/`void` result into "all consumed".
 * @returns `true` if the editor compose was consumed (and cleanup considered
 *   clearing it); `false` if the editor compose was preserved for retry.
 */
export async function runSendWithCleanup(
  send: () => SendResult | Promise<SendResult>,
  allTopIds: string[],
  cleanup: SendCleanup,
): Promise<boolean> {
  let decision: { editorConsumed: boolean; consumedTopIds: string[] };
  try {
    decision = normalizeResult(await send(), allTopIds);
  } catch (err) {
    // onSend should surface its own error toast; we just preserve the draft.
    console.error("[MessageInput] send failed, preserving draft", err);
    decision = { editorConsumed: false, consumedTopIds: [] };
  }

  // Top attachments: drop only the ones actually sent. Always safe — id-scoped,
  // so anything queued during the await stays. This runs even when the editor
  // compose failed, so a retry of the editor does not re-send these files
  // (octo-web#227 non-blocking note).
  if (decision.consumedTopIds.length > 0) {
    cleanup.removeTopAttachments(decision.consumedTopIds);
  }

  if (!decision.editorConsumed) {
    // Editor compose not sent → keep its content, refs and preview URLs.
    return false;
  }

  if (!cleanup.isEditorUnchanged()) {
    // The user started a new draft while the older send was in flight. We must
    // NOT clear the editor — doing so would wipe the newly typed draft (the
    // round-2 data-loss bug).
    //
    // octo-web#458 fix: when the caller provided `removeSentContent`, surgically
    // remove only the already-sent snapshot range from the editor, preserving
    // the new draft. This eliminates the "sent text lingers in the input box"
    // residual without re-introducing the round-2 data loss.
    //
    // When `removeSentContent` is not provided (older callers), fall back to
    // the original "leave as-is" behavior.
    if (cleanup.removeSentContent) {
      cleanup.removeSentContent();
      cleanup.deleteEditorAttachmentRefs();
      cleanup.revokeEditorPreviewUrls();
      cleanup.collapseExpanded?.();
    }
    return true;
  }

  // Editor still holds exactly what was sent → safe to clear it.
  cleanup.deleteEditorAttachmentRefs();
  cleanup.revokeEditorPreviewUrls();
  cleanup.clearEditor();
  cleanup.collapseExpanded?.();
  return true;
}
