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
  /**
   * The parts of the editor compose that were NOT sent even though other parts
   * were — e.g. one of two pasted images rejected by the upload pre-check, or a
   * text block whose send threw before enqueue after an earlier block had already
   * gone out. Listed in document order; only these are restored into the editor,
   * and the `File` refs / preview URLs of the listed attachments are kept alive so
   * the user can retry exactly what did not make it (#1280 review).
   */
  unsentEditorBlocks?: UnsentEditorBlock[];
}

/**
 * A piece of the editor compose that did not make it out. Attachments are
 * addressed by node id; text carries its send-format string (with `@[uid:label]`
 * markers) because text blocks have no stable id.
 */
export type UnsentEditorBlock =
  | { type: "attachment"; id: string }
  | { type: "text"; text: string };

export type SendResult = void | boolean | SendResultDetail;

/**
 * Per-send target (reply / edit) captured synchronously with the compose.
 *
 * #1280: `Conversation.onSend` used to read `vm.currentReplyMessage` /
 * `vm.currentHandlerType` when it ran. With sends queued, that read happens
 * *after* the user may have picked a different reply target — or switched to
 * "edit message" — so a queued send could reply to the wrong message or
 * overwrite an unrelated one. The target is therefore taken (and its banner
 * cleared) at key-press time, travels with the compose, and is put back by
 * `restore()` when the send is not enqueued so a retry still edits/replies.
 */
export interface SendTargetSnapshot {
  restore: () => void;
}

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
      // `tail` is always a promise that cannot reject (see below), so a single
      // fulfilment handler is enough — and states that invariant honestly.
      const result = tail.then(run);
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
   * Put the whole consumed editor compose back (nothing was sent).
   * Implementations must re-insert it *before* any draft the user typed during
   * the await, and must keep the pasted-image node ids so their `File` refs
   * still resolve.
   */
  restoreEditor: () => void;
  /**
   * Put back only these parts of the compose, in document order (the rest *was*
   * sent). Used for `unsentEditorBlocks`.
   */
  restoreEditorBlocks: (blocks: UnsentEditorBlock[]) => void;
  /** Drop in-memory `File` refs + revoke preview URLs of these pasted images. */
  disposeEditorAttachments: (ids: string[]) => void;
  /** Revoke preview URLs of top attachments that stay consumed. */
  disposeTopAttachments: (ids: string[]) => void;
  /** Put back the top attachments that were not actually sent. */
  restoreTopAttachments: (ids: string[]) => void;
  /**
   * Called when one restore/dispose step throws. Every step is isolated so a
   * failure in one can never skip the others (#1280 review: an editor restore
   * throwing used to swallow the attachment restore as well). Implementations
   * should surface this to the user — content that is in neither the composer
   * nor the message list must not disappear silently.
   */
  onRestoreError?: (err: unknown, step: string) => void;
}

/** Everything this send attempt consumed, used to expand loose send results. */
export interface ConsumedComposeIds {
  /** Ids of every top attachment handed to this send attempt. */
  topIds: string[];
  /** Ids of every pasted (in-editor) attachment handed to this send attempt. */
  editorAttachmentIds: string[];
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
  /**
   * Insert the snapshot blocks before the live content, after `blockOffset`
   * leading blocks. The offset is how many leading blocks already belong to
   * earlier restores, so consecutive failed sends keep their original order
   * instead of stacking up reversed (#1280 review).
   */
  insertContentAtBlock: (blockOffset: number, blocks: unknown[]) => void;
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
 *   what #227 round 2 protected, now without leaving sent content behind), and
 *   AFTER content restored by earlier failed sends so their order survives;
 * - a position error never loses content: fall back to appending.
 *
 * @returns how many blocks were inserted, so the caller can advance the offset
 *   for a following restore.
 */
export function restoreComposeSnapshot(
  snapshot: { type?: string; content?: unknown[] } | undefined,
  target: ComposeRestoreTarget,
  blockOffset = 0,
): number {
  const blocks = snapshot?.content;
  if (!blocks || blocks.length === 0) return 0;
  if (target.isEmpty()) {
    target.setContent(snapshot);
    target.focusEnd();
    return blocks.length;
  }
  try {
    target.insertContentAtBlock(blockOffset, blocks);
  } catch (err) {
    console.error(
      "[MessageInput] restoring the draft in place failed, appending instead",
      err,
    );
    target.appendContent(blocks);
  }
  return blocks.length;
}

interface SendDecision {
  editorConsumed: boolean;
  consumedTopIds: string[];
  unsentEditorBlocks: UnsentEditorBlock[];
}

/** Normalize the loose `SendResult` union into an explicit decision. */
function normalizeResult(
  result: SendResult,
  ids: ConsumedComposeIds,
): SendDecision {
  if (result === false) {
    return { editorConsumed: false, consumedTopIds: [], unsentEditorBlocks: [] };
  }
  if (result === true || result == null) {
    // void / undefined / true → full success.
    return {
      editorConsumed: true,
      consumedTopIds: ids.topIds,
      unsentEditorBlocks: [],
    };
  }
  // Detailed partial result. When the editor compose was not consumed the whole
  // snapshot is restored, so a per-block list would be redundant.
  return {
    editorConsumed: result.editorConsumed,
    consumedTopIds:
      result.consumedTopIds ?? (result.editorConsumed ? ids.topIds : []),
    unsentEditorBlocks: result.editorConsumed
      ? result.unsentEditorBlocks ?? []
      : [],
  };
}

/**
 * Await `send()` for a compose the caller already consumed, then either dispose
 * the consumed resources or restore what was not sent.
 *
 * Ordering and isolation matter here (#1280 review):
 *   - top attachments are settled BEFORE the editor, so an editor restore that
 *     throws (e.g. the editor was destroyed by a channel switch) can never skip
 *     putting the unsent files back;
 *   - every step runs in its own try/catch and reports through
 *     `compose.onRestoreError`, so one failure never cascades into losing the
 *     rest of the compose, and the caller can surface it to the user.
 *
 * @param ids Everything this attempt consumed; used to expand `true`/`void`
 *   into "all consumed" and to compute what must be restored.
 * @returns `true` if the editor compose was consumed; `false` if it was
 *   restored for retry.
 */
export async function runSendWithConsumedCompose(
  send: () => SendResult | Promise<SendResult>,
  ids: ConsumedComposeIds,
  compose: ConsumedCompose,
): Promise<boolean> {
  let decision: SendDecision;
  try {
    decision = normalizeResult(await send(), ids);
  } catch (err) {
    // onSend should surface its own error toast; we just restore the draft.
    console.error("[MessageInput] send failed, restoring draft", err);
    decision = { editorConsumed: false, consumedTopIds: [], unsentEditorBlocks: [] };
  }

  const step = (label: string, run: () => void) => {
    try {
      run();
    } catch (err) {
      console.error(`[MessageInput] compose ${label} failed`, err);
      compose.onRestoreError?.(err, label);
    }
  };

  // ── Top attachments first: never skippable by an editor-side failure ──
  const consumedTop = new Set(decision.consumedTopIds);
  const restoredTopIds = ids.topIds.filter((id) => !consumedTop.has(id));
  if (decision.consumedTopIds.length > 0) {
    step("disposeTopAttachments", () =>
      compose.disposeTopAttachments(decision.consumedTopIds),
    );
  }
  if (restoredTopIds.length > 0) {
    step("restoreTopAttachments", () =>
      compose.restoreTopAttachments(restoredTopIds),
    );
  }

  if (!decision.editorConsumed) {
    // Nothing was sent (or the mixed compose failed before enqueue) → give the
    // content back. Refs/URLs are intentionally NOT disposed here so the
    // restored pasted images still resolve to their `File` objects.
    step("restoreEditor", () => compose.restoreEditor());
    return false;
  }

  // The editor compose went out, but individual blocks may have failed before
  // enqueue (a rejected pasted image, or a text block whose send threw after an
  // earlier block had already been sent). Keep those alive and put just them back
  // — everything else stays consumed so nothing is sent twice.
  const unsentAttachmentIds = new Set(
    decision.unsentEditorBlocks
      .filter((block) => block.type === "attachment")
      .map((block) => (block as { id: string }).id),
  );
  const disposableEditorIds = ids.editorAttachmentIds.filter(
    (id) => !unsentAttachmentIds.has(id),
  );
  if (disposableEditorIds.length > 0) {
    step("disposeEditorAttachments", () =>
      compose.disposeEditorAttachments(disposableEditorIds),
    );
  }
  if (decision.unsentEditorBlocks.length > 0) {
    step("restoreEditorBlocks", () =>
      compose.restoreEditorBlocks(decision.unsentEditorBlocks),
    );
  }

  return true;
}
