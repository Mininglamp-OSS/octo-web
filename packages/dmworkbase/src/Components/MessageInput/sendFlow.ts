/**
 * Send-flow orchestration helper (octo-web#227 → octo-web#1280).
 *
 * ## History — three rounds of send-side bugs
 *
 * 1. (#227 round 1) `MessageInput.send()` called `props.onSend(...)` (typed
 *    `=> void`, never awaited) and then, in the *same synchronous frame*,
 *    unconditionally cleared the editor, deleted pasted-image `File` refs,
 *    revoked preview URLs and cleared the top-attachment area. For the mixed
 *    text+image path `onSend` is async and only fails after an upload, so the
 *    compose state was destroyed before the failure was known — one failed
 *    upload wiped the whole draft with nothing to retry.
 *    Fix: make the contract awaitable and clean up only after the send settles.
 *
 * 2. (#227 round 2) Awaiting the send left the editor editable during the wait.
 *    `Conversation.onSend` can take seconds (upload + ack). If the user started
 *    the next message while the first was pending, the older send's success
 *    cleared the *current* (newer) editor — wiping the new draft.
 *    Fix at the time: snapshot-aware cleanup — clear the editor only when it
 *    still held exactly what was sent, otherwise leave everything alone.
 *
 * 3. (#1280 — this round) The round-2 fix was all-or-nothing, and its own
 *    "known residual edge case" became the top user complaint: when the user
 *    keeps typing / pasting while a send is in flight (the normal "send several
 *    images in a row" flow), the *already sent* content is left in the composer
 *    forever. The message is visible in the history, so the composer looks
 *    broken ("nothing was sent"), and pressing send again re-sends it.
 *    Two other defects piled onto the same symptom:
 *      • `MessageInput` had a re-entrancy guard that silently dropped any send
 *        issued while another was pending — the 2nd/3rd Enter did nothing;
 *      • `Conversation` reported an ack timeout as *failure*, so a slow network
 *        pushed already-delivered content back into the composer.
 *
 * ## Current model: consume-first, restore-on-failure
 *
 * The composer is consumed **synchronously** when the send starts (editor
 * cleared, consumed top attachments removed) and the compose payload is
 * captured. Nothing about the composer is decided after the await, so the whole
 * "did the document change while we waited?" race disappears:
 *
 *   - success → nothing to clean in the UI; only in-memory `File` refs and
 *     preview object URLs of the consumed compose are disposed;
 *   - failure → the captured compose is restored (editor content re-inserted
 *     *before* whatever the user typed meanwhile, top attachments re-added), so
 *     the round-1 "failed upload wiped the draft" protection is preserved and
 *     the round-2 "newer draft wiped" protection holds by construction.
 *
 * Sends are serialized through {@link createSendQueue} instead of being dropped:
 * each send captures its payload immediately and runs after the previous one, so
 * message ordering (which `Conversation` guarantees by awaiting ack) is kept
 * while rapid consecutive sends all go out.
 *
 * `onSend` return-value contract (unchanged, back-compatible):
 *   - `undefined` / `void` → success: compose consumed;
 *   - `true`               → success: same as void;
 *   - `false`              → failure / nothing sent: RESTORE everything so the
 *     user can retry;
 *   - `{ editorConsumed, consumedTopIds }` → partial result: "the editor compose
 *     failed and must be restored, but these top attachments were already sent —
 *     keep them consumed so a retry does not duplicate them";
 *   - throws               → treated as failure → restore everything.
 *
 * NOTE for `onSend` implementors: "consumed" means *the message was enqueued and
 * is visible in the message list* — not "the server acked it". A message that is
 * enqueued and later fails renders a failure marker with resend, so it must NOT
 * be reported as `false`; reporting `false` would push already-visible content
 * back into the composer (defect 3c above).
 */

/** Partial send outcome — see contract above. */
export interface SendResultDetail {
  /** Whether the editor compose (text + pasted images / ordered blocks) was
   *  sent. `true` → the consumed editor content stays consumed; `false` → it is
   *  restored into the live editor. */
  editorConsumed: boolean;
  /** Ids of top attachments that were actually sent. Only these stay consumed;
   *  the rest are restored. Omit to derive from `editorConsumed`. */
  consumedTopIds?: string[];
}

export type SendResult = void | boolean | SendResultDetail;

/**
 * Publish a composer context only after its imperative send callback is wired.
 * React runs effects in declaration order; keeping these two operations atomic
 * prevents a consumer from synchronously calling context.send() in the gap.
 */
export function announceContextAfterSendReady<T extends () => Promise<boolean>>(
  sendRef: { current: T | null },
  send: T,
  announce: () => void,
): void {
  sendRef.current = send;
  announce();
}

/** A context send invoked before its callback is wired is explicitly rejected. */
export async function invokeReadySend(
  send: (() => Promise<boolean>) | null,
): Promise<boolean> {
  return send ? send() : false;
}

/**
 * Serial task queue for sends.
 *
 * Rapid consecutive sends used to be dropped by a re-entrancy guard (#1280):
 * while one send awaited upload+ack, every following Enter returned `false`
 * without feedback. Since the compose is now captured synchronously, a pending
 * send no longer has to block the next one — it only has to run *before* it, so
 * the messages keep their order.
 *
 * Failures never break the chain: a rejected task still lets the queue continue.
 */
export interface SendQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  /** Number of tasks queued or running. Exposed for a "sending" UI state/tests. */
  readonly pending: number;
}

export function createSendQueue(): SendQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      pending += 1;
      const run = () => task();
      // Run after the previous task settles, regardless of its outcome.
      const result = tail.then(run, run);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result.finally(() => {
        pending -= 1;
      });
    },
    get pending() {
      return pending;
    },
  };
}

/**
 * Restore / dispose hooks for a compose that was already consumed synchronously
 * by the caller before the send started.
 */
export interface ConsumedCompose {
  /**
   * Put the consumed editor compose back (failure path). Implementations must
   * re-insert it *before* any draft the user typed during the await, and must
   * keep the pasted-image node ids so their `File` refs still resolve.
   */
  restoreEditor: () => void;
  /** Drop in-memory pasted-image `File` refs + revoke their preview URLs. */
  disposeEditorAttachments: () => void;
  /** Revoke preview URLs of top attachments that stay consumed. */
  disposeTopAttachments: (ids: string[]) => void;
  /** Put back the top attachments that were not actually sent (failure path). */
  restoreTopAttachments: (ids: string[]) => void;
}

/**
 * Editor operations needed to put a consumed compose back after a failed send.
 * Structural so the restore policy can be unit-tested without a real editor.
 */
export interface ComposeRestoreTarget {
  /** Whether the live document is currently empty. */
  isEmpty: () => boolean;
  /** Replace the whole document with the snapshot (empty-document case). */
  setContent: (snapshot: unknown) => void;
  /** Put the caret at the end of the document. */
  focusEnd: () => void;
  /** Insert the snapshot blocks BEFORE the live content. */
  insertContentAtStart: (blocks: unknown[]) => void;
  /** Fallback: append the snapshot blocks at the end. */
  appendContent: (blocks: unknown[]) => void;
}

/**
 * Restore policy for a failed send (#1280 consume-first model).
 *
 * - empty document (nothing typed during the await) → the snapshot is restored
 *   as-is and the caret goes to the end, i.e. "your failed message is still
 *   there";
 * - non-empty document (the user already started the next message) → the failed
 *   content is inserted BEFORE the new draft, so nothing is overwritten (this is
 *   what #227 round 2 protected, now without leaving sent content behind);
 * - a position error never loses content: fall back to appending.
 */
export function restoreComposeSnapshot(
  snapshot: { content?: unknown[] } | undefined,
  target: ComposeRestoreTarget,
): void {
  const blocks = snapshot?.content;
  if (!blocks || blocks.length === 0) return;
  if (target.isEmpty()) {
    target.setContent(snapshot);
    target.focusEnd();
    return;
  }
  try {
    target.insertContentAtStart(blocks);
  } catch (err) {
    console.error(
      "[MessageInput] restoring the draft at the document start failed, appending instead",
      err,
    );
    target.appendContent(blocks);
  }
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
 * Await `send()` for a compose the caller already consumed, then either dispose
 * the consumed resources (success) or restore the compose (failure).
 *
 * @param allTopIds Ids of every top attachment handed to this send attempt;
 *   used to expand a `true`/`void` result into "all consumed" and to compute
 *   which ones must be restored on a partial result.
 * @returns `true` if the editor compose was consumed; `false` if it was
 *   restored for retry.
 */
export async function runSendWithConsumedCompose(
  send: () => SendResult | Promise<SendResult>,
  allTopIds: string[],
  compose: ConsumedCompose,
): Promise<boolean> {
  let decision: { editorConsumed: boolean; consumedTopIds: string[] };
  try {
    decision = normalizeResult(await send(), allTopIds);
  } catch (err) {
    // onSend should surface its own error toast; we just restore the draft.
    console.error("[MessageInput] send failed, restoring draft", err);
    decision = { editorConsumed: false, consumedTopIds: [] };
  }

  if (decision.editorConsumed) {
    compose.disposeEditorAttachments();
  } else {
    // Nothing was sent (or the mixed compose failed before enqueue) → give the
    // content back. Refs/URLs are intentionally NOT disposed here so the
    // restored pasted images still resolve to their `File` objects.
    compose.restoreEditor();
  }

  const consumed = new Set(decision.consumedTopIds);
  const restoredTopIds = allTopIds.filter((id) => !consumed.has(id));
  if (decision.consumedTopIds.length > 0) {
    compose.disposeTopAttachments(decision.consumedTopIds);
  }
  if (restoredTopIds.length > 0) {
    compose.restoreTopAttachments(restoredTopIds);
  }

  return decision.editorConsumed;
}
