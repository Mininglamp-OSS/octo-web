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
 * `onSend` always returns a complete `ChatSendOutcome`. Boolean and void
 * results are intentionally rejected at this internal boundary: every caller
 * must declare consumed attachments, unsent editor blocks and target restore
 * behavior explicitly. A thrown error still restores the whole compose.
 *
 * NOTE for `onSend` implementors: "consumed" means *the message was enqueued and
 * is visible in the message list* — not "the server acked it". A message that is
 * enqueued and later fails renders a failure marker with resend, so its outcome
 * must keep `editorConsumed` true.
 */
import {
  createChatSendOutcome,
  rejectChatComposerSend,
  type ChatComposerSendResult,
  type ChatSendOutcome,
  type SendDraftSnapshot,
  type SendProgressSnapshot,
  type SendTargetSnapshot,
  type UnsentEditorBlock,
} from "../domain";

export type {
  ChatSendOutcome,
  SendDraftSnapshot,
  SendProgressSnapshot,
  SendTargetSnapshot,
  UnsentEditorBlock,
} from "../domain";

/**
 * Publish a composer context only after its imperative send callback is wired.
 * React runs effects in declaration order; keeping these two operations atomic
 * prevents a consumer from synchronously calling context.send() in the gap.
 */
export function announceContextAfterSendReady<
  T extends () => Promise<ChatComposerSendResult>,
>(
  sendRef: { current: T | null },
  send: T,
  announce: () => void,
): void {
  sendRef.current = send;
  announce();
}

/** A context send invoked before its callback is wired is explicitly rejected. */
export async function invokeReadySend(
  send: (() => Promise<ChatComposerSendResult>) | null,
): Promise<ChatComposerSendResult> {
  return send ? send() : rejectChatComposerSend("editor-not-ready");
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
 * Run send settlement inside the serialized task boundary. The settlement hook
 * must finish before the queue starts the next task, otherwise the next send can
 * observe stale pending-attempt state.
 */
export function enqueueSettledSend<T>(
  queue: SendQueue,
  task: () => Promise<T>,
  settle: () => void,
): Promise<T> {
  return queue.enqueue(async () => {
    try {
      return await task();
    } finally {
      settle();
    }
  });
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
  /** Put back only the captured reply/edit target after a partial send failure. */
  restoreSendTarget: () => void;
  /** Dispose resources owned by editor compose parts that stayed consumed. */
  disposeEditorParts: (ids: string[]) => void;
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
  /** Ids of every atomic editor compose part handed to this send attempt. */
  editorPartIds: string[];
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
 * @param ids Everything this attempt consumed; used to compute what must be
 *   restored from the explicit send outcome.
 * @returns `true` if the editor compose was consumed; `false` if it was
 *   restored for retry.
 */
export interface ConsumedComposeSettlement {
  outcome: ChatSendOutcome;
  editorConsumed: boolean;
  restoreErrors: Array<{ error: unknown; step: string }>;
}

export async function settleConsumedCompose(
  send: () => ChatSendOutcome | Promise<ChatSendOutcome>,
  ids: ConsumedComposeIds,
  compose: ConsumedCompose,
): Promise<ConsumedComposeSettlement> {
  let decision: ChatSendOutcome;
  try {
    decision = await send();
  } catch (err) {
    // onSend should surface its own error toast; we just restore the draft.
    console.error("[MessageInput] send failed, restoring draft", err);
    decision = createChatSendOutcome();
  }

  const restoreErrors: ConsumedComposeSettlement["restoreErrors"] = [];
  const step = (label: string, run: () => void) => {
    try {
      run();
    } catch (err) {
      console.error(`[MessageInput] compose ${label} failed`, err);
      restoreErrors.push({ error: err, step: label });
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
    return { outcome: decision, editorConsumed: false, restoreErrors };
  }

  // The editor compose went out, but individual blocks may have failed before
  // enqueue (a rejected pasted image, or a text block whose send threw after an
  // earlier block had already been sent). Keep those alive and put just them back
  // — everything else stays consumed so nothing is sent twice.
  const unsentEditorPartIds = new Set(
    decision.unsentEditorBlocks
      .filter((block) => block.type !== "text")
      .map((block) => (block as { id: string }).id),
  );
  const disposableEditorIds = ids.editorPartIds.filter(
    (id) => !unsentEditorPartIds.has(id),
  );
  if (disposableEditorIds.length > 0) {
    step("disposeEditorParts", () =>
      compose.disposeEditorParts(disposableEditorIds),
    );
  }
  if (decision.unsentEditorBlocks.length > 0) {
    if (decision.restoreSendTarget) {
      step("restoreSendTarget", () => compose.restoreSendTarget());
    }
    step("restoreEditorBlocks", () =>
      compose.restoreEditorBlocks(decision.unsentEditorBlocks),
    );
  } else if (decision.restoreSendTarget) {
    step("restoreSendTarget", () => compose.restoreSendTarget());
  }

  return { outcome: decision, editorConsumed: true, restoreErrors };
}
