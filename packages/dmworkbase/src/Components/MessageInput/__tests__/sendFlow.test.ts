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
  announceContextAfterSendReady,
  invokeReadySend,
  runSendWithCleanup,
  SendCleanup,
} from "../sendFlow";

describe("announceContextAfterSendReady", () => {
  it("wires the send handler before announcing context readiness", async () => {
    const sendRef: { current: (() => Promise<boolean>) | null } = { current: null };
    const send = vi.fn().mockResolvedValue(true);
    let firstContextSend: Promise<boolean> | undefined;

    announceContextAfterSendReady(sendRef, send, () => {
      // Models Conversation consuming a no-attachment initialCompose immediately
      // inside MessageInput's first onContext callback.
      firstContextSend = invokeReadySend(sendRef.current);
    });

    await expect(firstContextSend).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("invokeReadySend", () => {
  it("returns false instead of legacy void when the send callback is not ready", async () => {
    await expect(invokeReadySend(null)).resolves.toBe(false);
  });

  it("forwards the real result once the send callback is ready", async () => {
    await expect(invokeReadySend(async () => true)).resolves.toBe(true);
  });
});

interface RecordingCleanup extends SendCleanup {
  calls: string[];
  removedIds: string[];
  editorUnchanged: boolean;
}

function makeCleanup(opts?: { editorUnchanged?: boolean }): RecordingCleanup {
  const calls: string[] = [];
  const removedIds: string[] = [];
  const state = {
    calls,
    removedIds,
    editorUnchanged: opts?.editorUnchanged ?? true,
    isEditorUnchanged: vi.fn(() => state.editorUnchanged),
    deleteEditorAttachmentRefs: vi.fn(() => calls.push("deleteEditorAttachmentRefs")),
    revokeEditorPreviewUrls: vi.fn(() => calls.push("revokeEditorPreviewUrls")),
    clearEditor: vi.fn(() => calls.push("clearEditor")),
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
  it("does NOT clear the editor when the user started a new draft during the await, even on success", async () => {
    // editor changed during the await → isEditorUnchanged() returns false.
    const cleanup = makeCleanup({ editorUnchanged: false });
    const send = vi.fn().mockResolvedValue(true);

    const ok = await runSendWithCleanup(send, [], cleanup);

    // Send still reported success...
    expect(ok).toBe(true);
    // ...but the live (newer) editor draft must survive untouched.
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
    expect(cleanup.deleteEditorAttachmentRefs).not.toHaveBeenCalled();
    expect(cleanup.revokeEditorPreviewUrls).not.toHaveBeenCalled();
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
    // Editor itself preserved.
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
  });

  it("clears the editor on success when it still holds exactly what was sent", async () => {
    const cleanup = makeCleanup({ editorUnchanged: true });
    const send = vi.fn().mockResolvedValue(true);

    await runSendWithCleanup(send, [], cleanup);

    expect(cleanup.clearEditor).toHaveBeenCalledTimes(1);
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
