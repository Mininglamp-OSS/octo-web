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
 *    Fix: cleanup is snapshot-aware. The editor is only cleared wholesale if it
 *    still holds exactly the content that was sent (`isEditorUnchanged`). Top
 *    attachments are removed by the specific ids that were consumed, never with
 *    a blanket reset, so items queued during the wait survive.
 *
 * 3. (round 3 — dedup) When the editor changed mid-flight we used to leave the
 *    live doc untouched, so the already-sent snapshot blocks stayed alongside
 *    the new draft and were *re-sent* on the next send (a duplicate message —
 *    NOT "harmlessly cleared"). Fix: on success with a changed editor we now
 *    subtract the sent snapshot from the live document and keep only what the
 *    user typed during the window (`removeSentEditorContent`, backed by the
 *    pure `removeSentSnapshot` helper below). This mirrors the by-id
 *    `removeTopAttachments` approach: the sent attachment nodes are dropped by
 *    id and the consumed File refs / preview URLs are released, so neither the
 *    images nor the text are re-sent and there is no blob leak. The new draft
 *    (including any attachment pasted during the window) is preserved.
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
   * Round-3 dedup: the editor changed mid-flight but the send succeeded, so the
   * live doc holds [already-sent snapshot] + [new draft]. Subtract the sent
   * snapshot from the live document, leaving only what the user typed during
   * the in-flight window, so the sent blocks are NOT re-sent on the next send.
   * Returns `true` if the sent content was removed (the caller may then release
   * the consumed File refs / preview URLs); `false` if the sent content could
   * not be cleanly separated from the new draft (user edited inside the sent
   * region) and the live doc was left intact to avoid wiping the draft.
   */
  removeSentEditorContent: () => boolean;
  /**
   * Remove the given top attachments (by id) and revoke their preview URLs.
   * Id-scoped so attachments queued during the await are preserved.
   */
  removeTopAttachments: (ids: string[]) => void;
  /** Optional: collapse the expanded composer (only when the editor is cleared). */
  collapseExpanded?: () => void;
}

/** Minimal shape of a TipTap/ProseMirror JSON node (doc, block, or inline). */
export interface EditorJSONNode {
  type: string;
  text?: string;
  content?: EditorJSONNode[];
  [key: string]: unknown;
}

/** Structural equality for JSON nodes (order-sensitive, like the snapshot). */
function nodesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isEmptyInline(content: EditorJSONNode[]): boolean {
  return content.every(
    (n) => n.type === "text" && (n.text ?? "") === "",
  );
}

/**
 * Strip the leading inline run of `sent` from the matching `live` block.
 *
 * Handles the realistic "typed more right after pressing send" flow where the
 * user appended text/inline nodes to the *last sent block* without starting a
 * new paragraph. Returns the block holding only the appended suffix, or `null`
 * if the two blocks cannot be cleanly separated, i.e.:
 *   - different node types;
 *   - either side is a leaf/atom node (no inline children) — a same-type leaf
 *     with different attrs/marks must NOT be silently dropped;
 *   - `live` does not begin with the full `sent` inline run (the user edited
 *     inside the sent content rather than appending after it).
 */
function stripInlinePrefix(
  sent: EditorJSONNode,
  live: EditorJSONNode,
): EditorJSONNode | null {
  if (sent.type !== live.type) return null;
  // Leaf/atom blocks (no inline children) are not separable by prefix; they are
  // only ever removable via full structural equality, which the caller already
  // checked (and which failed, since we are here). Bail rather than risk wiping
  // a same-type-but-different live node.
  if (!Array.isArray(sent.content) || !Array.isArray(live.content)) return null;
  // The block wrapper (attrs / marks — everything except `content`) must match,
  // or we would silently rewrite a block whose own attributes the user changed.
  if (!nodesEqual({ ...sent, content: [] }, { ...live, content: [] })) {
    return null;
  }
  const si = sent.content;
  const li = live.content;
  if (li.length < si.length) return null;

  for (let i = 0; i < si.length; i++) {
    if (nodesEqual(si[i], li[i])) continue;

    // Only the last sent inline node may match partially, and only when both
    // are text nodes with identical marks/attrs and live text starts with sent.
    const isLastSent = i === si.length - 1;
    const sNode = si[i];
    const lNode = li[i];
    if (
      isLastSent &&
      sNode.type === "text" &&
      lNode.type === "text" &&
      typeof sNode.text === "string" &&
      typeof lNode.text === "string" &&
      lNode.text.startsWith(sNode.text) &&
      nodesEqual({ ...sNode, text: "" }, { ...lNode, text: "" })
    ) {
      const suffixText = lNode.text.slice(sNode.text.length);
      const remaining: EditorJSONNode[] = [
        ...(suffixText ? [{ ...lNode, text: suffixText }] : []),
        ...li.slice(i + 1),
      ];
      return { ...live, content: remaining };
    }
    return null;
  }

  return { ...live, content: li.slice(si.length) };
}

/**
 * Pure snapshot subtraction (round-3 dedup core).
 *
 * Given the document that was `sent` and the current `live` document, return a
 * new document holding only the content the user added *after* the sent
 * snapshot, so the sent blocks are never re-sent. Mirrors the by-id
 * `removeTopAttachments` idea at the editor-document level:
 *
 *  - sent content is a clean leading run of top-level blocks → drop those
 *    blocks, keep the rest (new paragraphs typed during the wait survive);
 *  - the user appended inline content to the *last* sent block → strip the sent
 *    inline prefix from that block, keep the appended suffix + later blocks;
 *  - the user edited *inside* the sent region (an earlier sent block diverged,
 *    or the boundary block is not a clean append) so it cannot be cleanly
 *    separated → return `null` (caller preserves the live doc rather than risk
 *    wiping the new draft, or — worse — leaving a later sent block to re-send).
 *
 * The returned doc may have an empty `content` array (everything sent, nothing
 * new) — the caller should treat that as "clear the editor".
 *
 * Known limits (content-equality is structural, not transaction-based — these
 * are bounded residuals, NOT the duplicate-on-every-retype bug this fixes):
 *  - If an *earlier* sent block was edited but a *later* sent block still
 *    matches verbatim, we return `null` and preserve the whole live doc to
 *    avoid wiping the new draft. That later block can still be re-sent on the
 *    next send. Preferring "no wipe" over "no duplicate" here is the team's
 *    accepted severity call; fully closing it needs ProseMirror step/version
 *    tracking (a dedicated follow-up).
 *  - If the user select-all-replaces the draft with brand-new text that happens
 *    to *begin with the exact sent string*, we treat the shared run as the sent
 *    prefix and strip it. This requires the new draft to coincidentally share
 *    the old prefix within the 1–5s in-flight window — rare, and the dropped
 *    text is the same characters the user just sent.
 */
export function removeSentSnapshot(
  sent: EditorJSONNode,
  live: EditorJSONNode,
): EditorJSONNode | null {
  const sb = Array.isArray(sent.content) ? sent.content : [];
  const lb = Array.isArray(live.content) ? live.content : [];

  // Longest common prefix of top-level blocks.
  let k = 0;
  while (k < sb.length && k < lb.length && nodesEqual(sb[k], lb[k])) k++;

  // All sent blocks matched as a clean block prefix → drop them.
  if (k === sb.length) {
    return { ...live, content: lb.slice(k) };
  }

  // Otherwise some sent block diverged at index k. We can only recover the
  // "appended to the end of the sent content" case: that requires the diverged
  // block to be the LAST sent block (k === sb.length - 1). If an EARLIER sent
  // block diverged, later sent blocks (sb[k+1..]) would remain in the live doc
  // and be re-sent — so we must bail and preserve the live doc untouched.
  if (k === sb.length - 1 && k < lb.length) {
    const stripped = stripInlinePrefix(sb[k], lb[k]);
    if (stripped !== null) {
      const strippedInline = Array.isArray(stripped.content)
        ? stripped.content
        : [];
      const head =
        strippedInline.length === 0 || isEmptyInline(strippedInline)
          ? []
          : [stripped];
      return { ...live, content: [...head, ...lb.slice(k + 1)] };
    }
  }

  // Sent content is interleaved/edited inside the live doc — not safely
  // separable. Preserve everything (caller keeps the live doc untouched).
  return null;
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
    // NOT clear the whole editor — that would wipe the newly typed draft (the
    // round-2 data-loss bug).
    //
    // Round-3 dedup: but we also must not leave the already-sent snapshot blocks
    // in the live doc, or the *next* send would re-send them (a duplicate — the
    // bug the corrected comment above describes). Subtract the sent snapshot
    // from the live document, keeping only what the user typed during the
    // window. `removeSentEditorContent` returns true when it cleanly removed the
    // sent content; only then do we release the consumed pasted-image File refs
    // and preview URLs (so neither images nor text are re-sent, and there is no
    // blob leak). If it returns false (the user edited inside the sent region so
    // it cannot be separated), we preserve the live doc untouched — the old
    // accepted tradeoff, now confined to that rare case.
    const removed = cleanup.removeSentEditorContent();
    if (removed) {
      cleanup.deleteEditorAttachmentRefs();
      cleanup.revokeEditorPreviewUrls();
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
