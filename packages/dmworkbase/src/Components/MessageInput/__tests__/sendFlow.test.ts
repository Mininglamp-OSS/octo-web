/**
 * Regression tests for the two send-side data-loss bugs (octo-web#227).
 *
 * Round 1 — mixed text+image send failure wiped the draft:
 *   MessageInput cleared the editor / deleted pasted-image File refs / revoked
 *   preview URLs synchronously, BEFORE the awaited async send (mixed RichText)
 *   could report failure. A failed image upload therefore destroyed the user's
 *   whole text+image compose with no message and nothing to retry.
 *
 * Round 2 — await-cleanup race wiped the NEXT draft (Jerry-Xin P1):
 *   Once the send was awaited, the editor stayed editable during the wait. If
 *   the user finished one message and started typing the next while upload/ack
 *   was still pending, the older send's success cleared the live (newer) editor
 *   and top-attachment list. The cleanup must be snapshot-aware: clear the
 *   editor only if it still holds exactly what was sent, and remove only the
 *   top attachments that were actually consumed.
 *
 * Round 3 — sent snapshot lingered and was RE-SENT (dedup, Jerry-Xin record):
 *   The round-2 guard left the already-sent blocks in the live doc alongside
 *   the new draft, so the next send re-sent them (a duplicate). The fix
 *   subtracts the sent snapshot from the live document (`removeSentSnapshot` /
 *   `removeSentEditorContent`), keeping only what the user typed during the
 *   window, and releases the consumed pasted-image File refs / preview URLs.
 *
 * The contract these tests lock in:
 *   - send resolves false  → editor preserved; no top attachment removed.
 *   - send throws          → same as false.
 *   - send resolves true / void → success; consumed top ids = all; editor
 *     cleared IFF unchanged.
 *   - send resolves a detail object → partial: editor cleared per
 *     editorConsumed, top attachments removed per consumedTopIds.
 *   - editor changed during await → editor NEVER cleared (round-2 fix), even on
 *     success; consumed top attachments are still removed by id.
 *   - cleanup never runs before the send settles (ordering guarantee).
 */

import { describe, it, expect, vi } from "vitest";
import {
  runSendWithCleanup,
  removeSentSnapshot,
  SendCleanup,
  EditorJSONNode,
} from "../sendFlow";

interface RecordingCleanup extends SendCleanup {
  calls: string[];
  removedIds: string[];
  editorUnchanged: boolean;
  sentContentRemoved: boolean;
}

function makeCleanup(opts?: {
  editorUnchanged?: boolean;
  sentContentRemoved?: boolean;
}): RecordingCleanup {
  const calls: string[] = [];
  const removedIds: string[] = [];
  const state = {
    calls,
    removedIds,
    editorUnchanged: opts?.editorUnchanged ?? true,
    sentContentRemoved: opts?.sentContentRemoved ?? true,
    isEditorUnchanged: vi.fn(() => state.editorUnchanged),
    deleteEditorAttachmentRefs: vi.fn(() => calls.push("deleteEditorAttachmentRefs")),
    revokeEditorPreviewUrls: vi.fn(() => calls.push("revokeEditorPreviewUrls")),
    clearEditor: vi.fn(() => calls.push("clearEditor")),
    removeSentEditorContent: vi.fn(() => {
      calls.push("removeSentEditorContent");
      return state.sentContentRemoved;
    }),
    removeTopAttachments: vi.fn((ids: string[]) => {
      calls.push("removeTopAttachments");
      removedIds.push(...ids);
    }),
    collapseExpanded: vi.fn(() => calls.push("collapseExpanded")),
  };
  return state as unknown as RecordingCleanup;
}

describe("runSendWithCleanup — round 1: mixed send failure preserves draft", () => {
  it("does NOT clear editor / refs / urls and removes no top attachment when send resolves false", async () => {
    const cleanup = makeCleanup();
    const send = vi.fn().mockResolvedValue(false);

    const ok = await runSendWithCleanup(send, ["t1", "t2"], cleanup);

    expect(ok).toBe(false);
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
    expect(cleanup.deleteEditorAttachmentRefs).not.toHaveBeenCalled();
    expect(cleanup.revokeEditorPreviewUrls).not.toHaveBeenCalled();
    expect(cleanup.removeTopAttachments).not.toHaveBeenCalled();
    expect(cleanup.collapseExpanded).not.toHaveBeenCalled();
    expect(cleanup.calls).toEqual([]);
  });

  it("preserves draft when send throws (image prepare/upload error)", async () => {
    const cleanup = makeCleanup();
    const send = vi.fn().mockRejectedValue(new Error("upload failed"));

    const ok = await runSendWithCleanup(send, ["t1"], cleanup);

    expect(ok).toBe(false);
    expect(cleanup.calls).toEqual([]);
  });

  it("clears compose state and removes all top attachments when send resolves true", async () => {
    const cleanup = makeCleanup();
    const send = vi.fn().mockResolvedValue(true);

    const ok = await runSendWithCleanup(send, ["t1", "t2"], cleanup);

    expect(ok).toBe(true);
    expect(cleanup.removeTopAttachments).toHaveBeenCalledTimes(1);
    expect(cleanup.removedIds).toEqual(["t1", "t2"]);
    expect(cleanup.deleteEditorAttachmentRefs).toHaveBeenCalledTimes(1);
    expect(cleanup.revokeEditorPreviewUrls).toHaveBeenCalledTimes(1);
    expect(cleanup.clearEditor).toHaveBeenCalledTimes(1);
    expect(cleanup.collapseExpanded).toHaveBeenCalledTimes(1);
  });

  it("treats void/undefined return as success (back-compat with legacy onSend)", async () => {
    const cleanup = makeCleanup();
    const send = vi.fn().mockResolvedValue(undefined);

    const ok = await runSendWithCleanup(send, ["t1"], cleanup);

    expect(ok).toBe(true);
    expect(cleanup.clearEditor).toHaveBeenCalledTimes(1);
    expect(cleanup.removedIds).toEqual(["t1"]);
  });

  it("treats a synchronous void return as success", async () => {
    const cleanup = makeCleanup();
    const send = vi.fn(() => {
      /* legacy void onSend */
    });

    const ok = await runSendWithCleanup(send, [], cleanup);

    expect(ok).toBe(true);
    expect(cleanup.clearEditor).toHaveBeenCalledTimes(1);
  });

  it("never runs cleanup before the async send settles (ordering guarantee)", async () => {
    const cleanup = makeCleanup();
    let resolveSend!: (v: boolean) => void;
    const send = vi.fn(
      () =>
        new Promise<boolean>((res) => {
          resolveSend = res;
        }),
    );

    const p = runSendWithCleanup(send, ["t1"], cleanup);

    await Promise.resolve();
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
    expect(cleanup.deleteEditorAttachmentRefs).not.toHaveBeenCalled();
    expect(cleanup.removeTopAttachments).not.toHaveBeenCalled();

    resolveSend(true);
    await p;

    expect(cleanup.clearEditor).toHaveBeenCalledTimes(1);
    expect(cleanup.removeTopAttachments).toHaveBeenCalledTimes(1);
  });
});

describe("runSendWithCleanup — round 2: snapshot-aware cleanup preserves the NEXT draft", () => {
  it("does NOT clear the whole editor when the user started a new draft during the await, even on success", async () => {
    // editor changed during the await → isEditorUnchanged() returns false.
    const cleanup = makeCleanup({ editorUnchanged: false });
    const send = vi.fn().mockResolvedValue(true);

    const ok = await runSendWithCleanup(send, [], cleanup);

    // Send still reported success...
    expect(ok).toBe(true);
    // ...and the whole-editor clear (which would wipe the newer draft) is never
    // used; only the targeted dedup removal runs.
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
    expect(cleanup.removeSentEditorContent).toHaveBeenCalledTimes(1);
    expect(cleanup.collapseExpanded).not.toHaveBeenCalled();
  });

  it("still removes consumed top attachments by id even when the editor changed mid-flight", async () => {
    const cleanup = makeCleanup({ editorUnchanged: false });
    const send = vi.fn().mockResolvedValue(true);

    await runSendWithCleanup(send, ["t1", "t2"], cleanup);

    // Consumed top attachments are id-scoped, so removing them never touches a
    // newly queued attachment — safe regardless of editor changes.
    expect(cleanup.removeTopAttachments).toHaveBeenCalledTimes(1);
    expect(cleanup.removedIds).toEqual(["t1", "t2"]);
    // Whole-editor clear is never used in the changed-editor path.
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
  });

  it("clears the editor on success when it still holds exactly what was sent", async () => {
    const cleanup = makeCleanup({ editorUnchanged: true });
    const send = vi.fn().mockResolvedValue(true);

    await runSendWithCleanup(send, [], cleanup);

    expect(cleanup.clearEditor).toHaveBeenCalledTimes(1);
    // Targeted dedup is only for the changed-editor path.
    expect(cleanup.removeSentEditorContent).not.toHaveBeenCalled();
  });

  it("pure-text send: a new draft typed during ack wait is not wiped by the old send", async () => {
    // Pure text now also awaits sendTextAndWaitAck; simulate ack landing after
    // the user started a new line.
    const cleanup = makeCleanup({ editorUnchanged: false });
    let resolveSend!: (v: boolean) => void;
    const send = vi.fn(
      () => new Promise<boolean>((res) => (resolveSend = res)),
    );

    const p = runSendWithCleanup(send, [], cleanup);
    // user types the next message while ack is pending → editor now differs.
    resolveSend(true);
    const ok = await p;

    expect(ok).toBe(true);
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
  });
});

describe("runSendWithCleanup — round 3: dedup removes the already-sent snapshot from the live editor", () => {
  it("on success with a changed editor, subtracts the sent snapshot so it is not re-sent", async () => {
    const cleanup = makeCleanup({ editorUnchanged: false, sentContentRemoved: true });
    const send = vi.fn().mockResolvedValue(true);

    const ok = await runSendWithCleanup(send, [], cleanup);

    expect(ok).toBe(true);
    // The targeted dedup removal runs (instead of a blanket clear)...
    expect(cleanup.removeSentEditorContent).toHaveBeenCalledTimes(1);
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
    // ...and because it cleanly removed the sent content, the consumed
    // pasted-image File refs / preview URLs are released (no re-send, no leak).
    expect(cleanup.deleteEditorAttachmentRefs).toHaveBeenCalledTimes(1);
    expect(cleanup.revokeEditorPreviewUrls).toHaveBeenCalledTimes(1);
  });

  it("does NOT release editor refs when the sent content could not be cleanly separated", async () => {
    // User edited inside the sent region → removeSentEditorContent returns false.
    const cleanup = makeCleanup({ editorUnchanged: false, sentContentRemoved: false });
    const send = vi.fn().mockResolvedValue(true);

    const ok = await runSendWithCleanup(send, [], cleanup);

    expect(ok).toBe(true);
    expect(cleanup.removeSentEditorContent).toHaveBeenCalledTimes(1);
    // Live draft preserved untouched; refs NOT released (rare fallback).
    expect(cleanup.deleteEditorAttachmentRefs).not.toHaveBeenCalled();
    expect(cleanup.revokeEditorPreviewUrls).not.toHaveBeenCalled();
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
  });

  it("dedup does not run on send failure (editor preserved entirely for retry)", async () => {
    const cleanup = makeCleanup({ editorUnchanged: false });
    const send = vi.fn().mockResolvedValue(false);

    const ok = await runSendWithCleanup(send, [], cleanup);

    expect(ok).toBe(false);
    expect(cleanup.removeSentEditorContent).not.toHaveBeenCalled();
    expect(cleanup.calls).toEqual([]);
  });
});

describe("removeSentSnapshot — pure snapshot subtraction (round 3 core)", () => {
  const doc = (...content: EditorJSONNode[]): EditorJSONNode => ({
    type: "doc",
    content,
  });
  const para = (...inline: EditorJSONNode[]): EditorJSONNode => ({
    type: "paragraph",
    content: inline,
  });
  const text = (t: string): EditorJSONNode => ({ type: "text", text: t });
  const img = (id: string): EditorJSONNode => ({
    type: "attachment",
    attrs: { id },
  });

  it("drops a clean leading block prefix, keeping new paragraphs typed during the wait", () => {
    const sent = doc(para(text("hello")));
    const live = doc(para(text("hello")), para(text("the next message")));

    const remaining = removeSentSnapshot(sent, live);

    expect(remaining).toEqual(doc(para(text("the next message"))));
  });

  it("returns an empty content array when nothing new survives (whole-editor clear case)", () => {
    const sent = doc(para(text("hello")));
    const live = doc(para(text("hello")));

    const remaining = removeSentSnapshot(sent, live);

    expect(remaining).not.toBeNull();
    expect(remaining!.content).toEqual([]);
  });

  it("strips the sent inline prefix when the user appended text to the last sent block", () => {
    const sent = doc(para(text("hello")));
    const live = doc(para(text("hello world")));

    const remaining = removeSentSnapshot(sent, live);

    expect(remaining).toEqual(doc(para(text(" world"))));
  });

  it("drops a sent image block but keeps the new draft (no image re-send)", () => {
    const sent = doc(para(text("look"), img("a1")));
    const live = doc(para(text("look"), img("a1")), para(text("new line")));

    const remaining = removeSentSnapshot(sent, live);

    expect(remaining).toEqual(doc(para(text("new line"))));
  });

  it("returns null when the user edited inside the sent region (not safely separable)", () => {
    const sent = doc(para(text("hello")));
    // user changed the sent text itself — cannot cleanly separate.
    const live = doc(para(text("hXllo there")));

    const remaining = removeSentSnapshot(sent, live);

    expect(remaining).toBeNull();
  });

  it("preserves a new attachment pasted into the boundary block during the window", () => {
    const sent = doc(para(text("hi")));
    const live = doc(para(text("hi"), img("new1")));

    const remaining = removeSentSnapshot(sent, live);

    expect(remaining).toEqual(doc(para(img("new1"))));
  });

  it("returns null when an EARLIER sent block diverged (later sent blocks must not linger and re-send)", () => {
    // Two sent blocks; user edited the FIRST one. If we stripped at block 0 we'd
    // leave sent block 1 ("world") in the editor → it would be re-sent.
    const sent = doc(para(text("hello")), para(text("world")));
    const live = doc(para(text("hello!!!")), para(text("world")), para(text("new")));

    const remaining = removeSentSnapshot(sent, live);

    expect(remaining).toBeNull();
  });

  it("subtracts cleanly when only the LAST sent block was appended to", () => {
    const sent = doc(para(text("hello")), para(text("world")));
    const live = doc(para(text("hello")), para(text("world and more")));

    const remaining = removeSentSnapshot(sent, live);

    expect(remaining).toEqual(doc(para(text(" and more"))));
  });

  it("does NOT wipe a same-type leaf block whose attrs differ (e.g. a different boundary image)", () => {
    // Boundary block is an atom/leaf-like node with no inline children; the live
    // one has different attrs. Must not be silently dropped.
    const sentImg = (id: string): EditorJSONNode => ({
      type: "image",
      attrs: { src: id },
    });
    const sent = doc(sentImg("old"));
    const live = doc(sentImg("brand-new"));

    const remaining = removeSentSnapshot(sent, live);

    expect(remaining).toBeNull();
  });

  it("does NOT rewrite a boundary block whose own attrs the user changed", () => {
    // Same type + same leading inline run, but the block-level attrs differ
    // (e.g. paragraph turned into a different alignment). Must bail.
    const sentBlock: EditorJSONNode = {
      type: "paragraph",
      attrs: { align: "left" },
      content: [text("hello")],
    };
    const liveBlock: EditorJSONNode = {
      type: "paragraph",
      attrs: { align: "center" },
      content: [text("hello world")],
    };
    const sent = doc(sentBlock);
    const live = doc(liveBlock);

    const remaining = removeSentSnapshot(sent, live);

    expect(remaining).toBeNull();
  });
});

describe("runSendWithCleanup — partial result (top attachments sent, editor failed)", () => {
  it("preserves the editor but drops only the consumed top attachments (no retry duplication)", async () => {
    const cleanup = makeCleanup({ editorUnchanged: true });
    // Top attachments t1,t2 were sent first; the mixed editor send then failed.
    const send = vi
      .fn()
      .mockResolvedValue({ editorConsumed: false, consumedTopIds: ["t1", "t2"] });

    const ok = await runSendWithCleanup(send, ["t1", "t2"], cleanup);

    // editorConsumed=false → return false so MessageInput keeps the editor.
    expect(ok).toBe(false);
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
    expect(cleanup.deleteEditorAttachmentRefs).not.toHaveBeenCalled();
    // But the already-sent top attachments are removed so retry won't resend.
    expect(cleanup.removeTopAttachments).toHaveBeenCalledTimes(1);
    expect(cleanup.removedIds).toEqual(["t1", "t2"]);
  });

  it("detail with editorConsumed=true clears editor and removes the listed top ids", async () => {
    const cleanup = makeCleanup({ editorUnchanged: true });
    const send = vi
      .fn()
      .mockResolvedValue({ editorConsumed: true, consumedTopIds: ["t1"] });

    const ok = await runSendWithCleanup(send, ["t1", "t2"], cleanup);

    expect(ok).toBe(true);
    expect(cleanup.clearEditor).toHaveBeenCalledTimes(1);
    // Only the explicitly-consumed id is removed, not the whole allTopIds list.
    expect(cleanup.removedIds).toEqual(["t1"]);
  });

  it("detail editorConsumed=true with no consumedTopIds falls back to all top ids", async () => {
    const cleanup = makeCleanup({ editorUnchanged: true });
    const send = vi.fn().mockResolvedValue({ editorConsumed: true });

    await runSendWithCleanup(send, ["t1", "t2"], cleanup);

    expect(cleanup.removedIds).toEqual(["t1", "t2"]);
  });
});
