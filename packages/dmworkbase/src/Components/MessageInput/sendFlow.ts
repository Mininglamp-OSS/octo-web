/**
 * Send-flow orchestration helper (octo-web#227, Jerry-Xin P1).
 *
 * Background — the data-loss bug this fixes:
 *   `MessageInput.send()` used to call `props.onSend(...)` (typed `=> void`,
 *   never awaited) and then, in the *same synchronous frame*, unconditionally
 *   cleared the editor, deleted pasted-image `File` refs, revoked preview URLs
 *   and cleared the top-attachment area. For the mixed text+image RichText
 *   path, `onSend` is async and awaits an upload before it can fail — so the
 *   compose state was already destroyed before the failure was known. A single
 *   failed image upload therefore wiped the user's whole text+image draft with
 *   no message sent and nothing to retry from.
 *
 * The fix: make the contract awaitable and run compose cleanup ONLY after a
 * successful send. This helper centralizes that ordering so it can be unit
 * tested without mounting the full editor.
 *
 * `onSend` return-value contract (back-compatible):
 *   - `undefined` / `void` → treated as success (legacy callers that return
 *     nothing keep clearing the editor as before);
 *   - `true`               → success → clear compose state;
 *   - `false`              → failure / nothing sent → PRESERVE compose state
 *     (editor content, attachment refs, preview URLs) so the user can retry;
 *   - throws               → treated as failure → preserve compose state.
 */

/** Side-effecting cleanup steps, all run together only on a successful send. */
export interface SendCleanup {
  /** Delete in-memory pasted-image File refs keyed in the editor. */
  deleteAttachmentRefs: () => void;
  /** Revoke object URLs created for image previews (avoid memory leaks). */
  revokePreviewUrls: () => void;
  /** Clear the top attachment area state. */
  clearTopAttachments: () => void;
  /** Clear the editor document. */
  clearEditor: () => void;
  /** Optional: collapse the expanded composer after sending. */
  collapseExpanded?: () => void;
}

export type SendResult = void | boolean;

/**
 * Await `send()` and, only if it succeeded, perform compose-state cleanup.
 *
 * @returns `true` if the send succeeded and cleanup ran; `false` if the send
 *   reported failure (or threw) and the compose state was deliberately
 *   preserved for retry.
 */
export async function runSendWithCleanup(
  send: () => SendResult | Promise<SendResult>,
  cleanup: SendCleanup,
): Promise<boolean> {
  let succeeded = true;
  try {
    const result = await send();
    // Only an explicit `false` means "not sent"; void/undefined stays success.
    succeeded = result !== false;
  } catch (err) {
    // onSend should surface its own error toast; we just preserve the draft.
    console.error("[MessageInput] send failed, preserving draft", err);
    succeeded = false;
  }

  if (!succeeded) {
    // Failure → keep editor content, attachment refs and preview URLs intact.
    return false;
  }

  cleanup.deleteAttachmentRefs();
  cleanup.revokePreviewUrls();
  cleanup.clearTopAttachments();
  cleanup.clearEditor();
  cleanup.collapseExpanded?.();
  return true;
}
