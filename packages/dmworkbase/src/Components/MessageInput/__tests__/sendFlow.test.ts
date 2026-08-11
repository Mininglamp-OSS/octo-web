/**
 * Regression tests for the send-side compose bugs (octo-web#227 → #1280).
 *
 * Round 1 (#227) — mixed text+image send failure wiped the draft:
 *   MessageInput cleared the editor / deleted pasted-image File refs / revoked
 *   preview URLs synchronously, BEFORE the awaited async send (mixed RichText)
 *   could report failure. A failed image upload therefore destroyed the user's
 *   whole text+image compose with no message and nothing to retry.
 *
 * Round 2 (#227) — await-cleanup race wiped the NEXT draft:
 *   The editor stayed editable during the wait, so the older send's success
 *   cleared the live (newer) editor and top-attachment list.
 *
 * Round 3 (#1280) — the round-2 "snapshot-aware" cleanup was all-or-nothing:
 *   whenever the document changed mid-flight the ALREADY SENT content stayed in
 *   the composer (visible in history + still in the input box, re-sendable by a
 *   second Enter). Consecutive image/text sends hit this constantly.
 *
 * Current contract (consume-first / restore-on-failure) locked in below:
 *   - the caller consumes the compose synchronously before calling;
 *   - send resolves true / void → consumed stays consumed; File refs + preview
 *     URLs are disposed; nothing is restored (so no leftovers, no duplicates);
 *   - send resolves false / throws → the compose is restored (editor content
 *     re-inserted, top attachments re-added) and nothing is disposed;
 *   - detail result → editor restored per editorConsumed, only the top ids NOT
 *     in consumedTopIds are restored (already-sent files never come back);
 *   - restore/dispose never run before the send settles (ordering guarantee);
 *   - createSendQueue serializes sends instead of dropping them.
 */

import { describe, it, expect, vi } from "vitest";
import {
  announceContextAfterSendReady,
  createSendQueue,
  invokeReadySend,
  restoreComposeSnapshot,
  runSendWithConsumedCompose,
  ConsumedCompose,
  ComposeRestoreTarget,
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

interface RecordingCompose extends ConsumedCompose {
  calls: string[];
  restoredTopIds: string[];
  disposedTopIds: string[];
  restoredEditorBlocks: unknown[];
  disposedEditorIds: string[];
  restoreErrors: Array<{ step: string; err: unknown }>;
}

function makeCompose(
  opts: { throwOn?: string } = {},
): RecordingCompose {
  const calls: string[] = [];
  const restoredTopIds: string[] = [];
  const disposedTopIds: string[] = [];
  const restoredEditorBlocks: unknown[] = [];
  const disposedEditorIds: string[] = [];
  const restoreErrors: Array<{ step: string; err: unknown }> = [];
  const record = (name: string) => {
    calls.push(name);
    if (opts.throwOn === name) throw new Error(`${name} exploded`);
  };
  const state = {
    calls,
    restoredTopIds,
    disposedTopIds,
    restoredEditorBlocks,
    disposedEditorIds,
    restoreErrors,
    restoreEditor: vi.fn(() => record("restoreEditor")),
    restoreEditorBlocks: vi.fn((blocks: unknown[]) => {
      restoredEditorBlocks.push(...blocks);
      record("restoreEditorBlocks");
    }),
    disposeEditorAttachments: vi.fn((ids: string[]) => {
      disposedEditorIds.push(...ids);
      record("disposeEditorAttachments");
    }),
    disposeTopAttachments: vi.fn((ids: string[]) => {
      disposedTopIds.push(...ids);
      record("disposeTopAttachments");
    }),
    restoreTopAttachments: vi.fn((ids: string[]) => {
      restoredTopIds.push(...ids);
      record("restoreTopAttachments");
    }),
    onRestoreError: vi.fn((err: unknown, step: string) => {
      restoreErrors.push({ step, err });
    }),
  };
  return state as unknown as RecordingCompose;
}

/** Ids helper: `runSendWithConsumedCompose` now takes both id families. */
const ids = (topIds: string[], editorAttachmentIds: string[] = []) => ({
  topIds,
  editorAttachmentIds,
});

describe("runSendWithConsumedCompose — success keeps the composer empty (#1280)", () => {
  it("disposes refs/urls and restores nothing when the send succeeds", async () => {
    const compose = makeCompose();
    const send = vi.fn().mockResolvedValue(true);

    const ok = await runSendWithConsumedCompose(
      send,
      ids(["t1", "t2"], ["e1"]),
      compose,
    );

    expect(ok).toBe(true);
    expect(compose.restoreEditor).not.toHaveBeenCalled();
    expect(compose.restoreTopAttachments).not.toHaveBeenCalled();
    expect(compose.restoreEditorBlocks).not.toHaveBeenCalled();
    expect(compose.disposedEditorIds).toEqual(["e1"]);
    expect(compose.disposedTopIds).toEqual(["t1", "t2"]);
  });

  it("treats void/undefined return as success (back-compat with legacy onSend)", async () => {
    const compose = makeCompose();

    const ok = await runSendWithConsumedCompose(
      vi.fn().mockResolvedValue(undefined),
      ids(["t1"]),
      compose,
    );

    expect(ok).toBe(true);
    expect(compose.restoreEditor).not.toHaveBeenCalled();
    expect(compose.disposedTopIds).toEqual(["t1"]);
  });

  it("treats a synchronous void return as success", async () => {
    const compose = makeCompose();
    const send = vi.fn(() => {
      /* legacy void onSend */
    });

    const ok = await runSendWithConsumedCompose(send, ids([], ["e1"]), compose);

    expect(ok).toBe(true);
    expect(compose.restoreEditor).not.toHaveBeenCalled();
    expect(compose.disposedEditorIds).toEqual(["e1"]);
  });

  it("does NOT restore already-sent content even when the user typed during the await", async () => {
    // The #1280 bug: a mid-flight document change used to leave the sent content
    // in the composer. Consume-first makes it structurally impossible — success
    // simply never touches the live document.
    const compose = makeCompose();
    let resolveSend!: (v: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((res) => (resolveSend = res)));

    const p = runSendWithConsumedCompose(send, ids(["t1"]), compose);
    // ...user pastes another image / types the next line here...
    resolveSend(true);

    await expect(p).resolves.toBe(true);
    expect(compose.restoreEditor).not.toHaveBeenCalled();
    expect(compose.restoreTopAttachments).not.toHaveBeenCalled();
  });
});

describe("runSendWithConsumedCompose — round 1: failure restores the whole draft", () => {
  it("restores editor + top attachments when the send resolves false", async () => {
    const compose = makeCompose();
    const send = vi.fn().mockResolvedValue(false);

    const ok = await runSendWithConsumedCompose(send, ids(["t1", "t2"]), compose);

    expect(ok).toBe(false);
    expect(compose.restoreEditor).toHaveBeenCalledTimes(1);
    expect(compose.restoredTopIds).toEqual(["t1", "t2"]);
    // Nothing disposed → the restored pasted images still resolve to their File.
    expect(compose.disposeEditorAttachments).not.toHaveBeenCalled();
    expect(compose.disposeTopAttachments).not.toHaveBeenCalled();
  });

  it("restores the draft when the send throws (image prepare/upload error)", async () => {
    const compose = makeCompose();
    const send = vi.fn().mockRejectedValue(new Error("upload failed"));

    const ok = await runSendWithConsumedCompose(send, ids(["t1"]), compose);

    expect(ok).toBe(false);
    expect(compose.restoreEditor).toHaveBeenCalledTimes(1);
    expect(compose.restoredTopIds).toEqual(["t1"]);
    expect(compose.disposeEditorAttachments).not.toHaveBeenCalled();
  });

  it("never restores or disposes before the async send settles (ordering guarantee)", async () => {
    const compose = makeCompose();
    let resolveSend!: (v: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((res) => (resolveSend = res)));

    const p = runSendWithConsumedCompose(send, ids(["t1"]), compose);

    await Promise.resolve();
    expect(compose.calls).toEqual([]);

    resolveSend(false);
    await p;

    expect(compose.restoreEditor).toHaveBeenCalledTimes(1);
  });
});

describe("runSendWithConsumedCompose — partial result (top attachments sent, editor failed)", () => {
  it("restores the editor but keeps the already-sent top attachments consumed", async () => {
    const compose = makeCompose();
    // Top attachments t1,t2 were sent first; the mixed editor send then failed.
    const send = vi
      .fn()
      .mockResolvedValue({ editorConsumed: false, consumedTopIds: ["t1", "t2"] });

    const ok = await runSendWithConsumedCompose(send, ids(["t1", "t2"]), compose);

    expect(ok).toBe(false);
    expect(compose.restoreEditor).toHaveBeenCalledTimes(1);
    // Already-sent files must NOT come back, otherwise a retry duplicates them.
    expect(compose.restoreTopAttachments).not.toHaveBeenCalled();
    expect(compose.disposedTopIds).toEqual(["t1", "t2"]);
  });

  it("restores only the top attachments that were not sent", async () => {
    const compose = makeCompose();
    const send = vi
      .fn()
      .mockResolvedValue({ editorConsumed: true, consumedTopIds: ["t1"] });

    const ok = await runSendWithConsumedCompose(send, ids(["t1", "t2"]), compose);

    expect(ok).toBe(true);
    expect(compose.disposedTopIds).toEqual(["t1"]);
    expect(compose.restoredTopIds).toEqual(["t2"]);
  });

  it("detail editorConsumed=true with no consumedTopIds falls back to all top ids", async () => {
    const compose = makeCompose();

    await runSendWithConsumedCompose(
      vi.fn().mockResolvedValue({ editorConsumed: true }),
      ids(["t1", "t2"]),
      compose,
    );

    expect(compose.disposedTopIds).toEqual(["t1", "t2"]);
    expect(compose.restoreTopAttachments).not.toHaveBeenCalled();
  });
});

describe("createSendQueue — consecutive sends are serialized, never dropped (#1280)", () => {
  it("runs queued sends in order instead of rejecting them while one is pending", async () => {
    const queue = createSendQueue();
    const order: string[] = [];
    const resolvers: Array<() => void> = [];
    const task = (name: string) => () =>
      new Promise<string>((res) => {
        order.push(`start:${name}`);
        resolvers.push(() => {
          order.push(`end:${name}`);
          res(name);
        });
      });

    const first = queue.enqueue(task("a"));
    const second = queue.enqueue(task("b"));

    await Promise.resolve();
    // b must not start before a finished (message ordering).
    expect(order).toEqual(["start:a"]);
    expect(queue.pending).toBe(2);

    resolvers[0]();
    await expect(first).resolves.toBe("a");
    await Promise.resolve();
    resolvers[1]();
    await expect(second).resolves.toBe("b");

    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
    expect(queue.pending).toBe(0);
  });

  it("keeps draining after a failed send", async () => {
    const queue = createSendQueue();
    const failing = queue.enqueue(() => Promise.reject(new Error("boom")));
    const following = queue.enqueue(() => Promise.resolve("ok"));

    await expect(failing).rejects.toThrow("boom");
    await expect(following).resolves.toBe("ok");
    expect(queue.pending).toBe(0);
  });
});

describe("restoreComposeSnapshot — a failed send never loses or overwrites content", () => {
  function makeTarget(isEmpty: boolean, throwOnStart = false) {
    const calls: string[] = [];
    const offsets: number[] = [];
    const target: ComposeRestoreTarget = {
      isEmpty: () => isEmpty,
      setContent: () => calls.push("setContent"),
      focusEnd: () => calls.push("focusEnd"),
      insertContentAtBlock: (blockOffset: number) => {
        calls.push("insertContentAtBlock");
        offsets.push(blockOffset);
        if (throwOnStart) throw new Error("bad position");
      },
      appendContent: () => calls.push("appendContent"),
    };
    return { target, calls, offsets };
  }

  const snapshot = { content: [{ type: "paragraph" }] };

  it("restores the snapshot as-is when the composer is still empty", () => {
    const { target, calls } = makeTarget(true);
    restoreComposeSnapshot(snapshot, target);
    expect(calls).toEqual(["setContent", "focusEnd"]);
  });

  it("prepends the failed content before a draft typed during the await", () => {
    const { target, calls, offsets } = makeTarget(false);
    expect(restoreComposeSnapshot(snapshot, target)).toBe(1);
    // Never setContent here — that was the #227 round-2 data loss.
    expect(calls).toEqual(["insertContentAtBlock"]);
    expect(offsets).toEqual([0]);
  });

  it("inserts after content an earlier failed send already restored", () => {
    const { target, offsets } = makeTarget(false);
    restoreComposeSnapshot(snapshot, target, 2);
    // Two blocks already belong to an earlier restore → keep A, B order.
    expect(offsets).toEqual([2]);
  });

  it("falls back to appending when the insert position is rejected", () => {
    const { target, calls } = makeTarget(false, true);
    restoreComposeSnapshot(snapshot, target);
    expect(calls).toEqual(["insertContentAtBlock", "appendContent"]);
  });

  it("does nothing for an empty snapshot", () => {
    const { target, calls } = makeTarget(true);
    restoreComposeSnapshot({ content: [] }, target);
    restoreComposeSnapshot(undefined, target);
    expect(calls).toEqual([]);
  });
});

describe("runSendWithConsumedCompose — partial editor blocks (#1280 review)", () => {
  it("restores only the pasted attachments that were rejected, disposing the sent ones", async () => {
    const compose = makeCompose();
    // Two pasted images: img-1 enqueued, img-2 rejected by the upload pre-check.
    const send = vi.fn().mockResolvedValue({
      editorConsumed: true,
      consumedTopIds: [],
      unsentEditorBlocks: [{ type: "attachment", id: "img-2" }],
    });

    const ok = await runSendWithConsumedCompose(
      send,
      ids([], ["img-1", "img-2"]),
      compose,
    );

    expect(ok).toBe(true);
    // The sent image's File ref/URL can go; the rejected one must stay alive…
    expect(compose.disposedEditorIds).toEqual(["img-1"]);
    // …and its node comes back so the user can retry just that image.
    expect(compose.restoredEditorBlocks).toEqual([
      { type: "attachment", id: "img-2" },
    ]);
  });

  it("restores text that failed before enqueue after an earlier block was sent", async () => {
    const compose = makeCompose();
    // A top attachment went out, then the text block's send threw pre-enqueue
    // (disbanded-group guard / sendMessage failure). Reporting only
    // `editorConsumed: true` used to discard that text for good (#1333 review).
    const send = vi.fn().mockResolvedValue({
      editorConsumed: true,
      consumedTopIds: ["t1"],
      unsentEditorBlocks: [{ type: "text", text: "please keep me" }],
    });

    const ok = await runSendWithConsumedCompose(send, ids(["t1"], []), compose);

    expect(ok).toBe(true);
    expect(compose.restoredEditorBlocks).toEqual([
      { type: "text", text: "please keep me" },
    ]);
    // The attachment that did go out stays consumed → no duplicate on retry.
    expect(compose.disposedTopIds).toEqual(["t1"]);
  });

  it("keeps document order when both text and an attachment are unsent", async () => {
    const compose = makeCompose();
    const send = vi.fn().mockResolvedValue({
      editorConsumed: true,
      unsentEditorBlocks: [
        { type: "text", text: "before" },
        { type: "attachment", id: "img-2" },
        { type: "text", text: "after" },
      ],
    });

    await runSendWithConsumedCompose(send, ids([], ["img-1", "img-2"]), compose);

    expect(compose.restoredEditorBlocks).toEqual([
      { type: "text", text: "before" },
      { type: "attachment", id: "img-2" },
      { type: "text", text: "after" },
    ]);
    expect(compose.disposedEditorIds).toEqual(["img-1"]);
  });

  it("restores every pasted attachment when nothing was enqueued", async () => {
    const compose = makeCompose();

    await runSendWithConsumedCompose(
      vi.fn().mockResolvedValue(false),
      ids([], ["img-1", "img-2"]),
      compose,
    );

    // Whole compose restored → no per-attachment restore, nothing disposed.
    expect(compose.restoreEditor).toHaveBeenCalledTimes(1);
    expect(compose.restoreEditorBlocks).not.toHaveBeenCalled();
    expect(compose.disposeEditorAttachments).not.toHaveBeenCalled();
  });

  it("ignores unsentEditorBlocks when the editor compose was not consumed", async () => {
    const compose = makeCompose();

    await runSendWithConsumedCompose(
      vi.fn().mockResolvedValue({
        editorConsumed: false,
        unsentEditorBlocks: [{ type: "attachment", id: "img-1" }],
      }),
      ids([], ["img-1", "img-2"]),
      compose,
    );

    expect(compose.restoreEditor).toHaveBeenCalledTimes(1);
    expect(compose.restoreEditorBlocks).not.toHaveBeenCalled();
  });
});

describe("runSendWithConsumedCompose — step isolation (#1280 review)", () => {
  it("settles top attachments BEFORE the editor so an editor throw cannot skip them", async () => {
    const compose = makeCompose({ throwOn: "restoreEditor" });

    const ok = await runSendWithConsumedCompose(
      vi.fn().mockResolvedValue(false),
      ids(["t1"], ["e1"]),
      compose,
    );

    expect(ok).toBe(false);
    // Attachments were restored first, so the editor failure cannot swallow them.
    expect(compose.calls).toEqual(["restoreTopAttachments", "restoreEditor"]);
    expect(compose.restoredTopIds).toEqual(["t1"]);
    // The failure is reported instead of vanishing silently.
    expect(compose.restoreErrors.map((e) => e.step)).toEqual(["restoreEditor"]);
  });

  it("keeps going when a dispose step throws", async () => {
    const compose = makeCompose({ throwOn: "disposeTopAttachments" });

    const ok = await runSendWithConsumedCompose(
      vi.fn().mockResolvedValue(true),
      ids(["t1"], ["e1"]),
      compose,
    );

    expect(ok).toBe(true);
    expect(compose.disposedEditorIds).toEqual(["e1"]);
    expect(compose.restoreErrors.map((e) => e.step)).toEqual([
      "disposeTopAttachments",
    ]);
  });

  it("never rejects, so the fire-and-forget Enter path cannot produce an unhandled rejection", async () => {
    const compose = makeCompose({ throwOn: "restoreEditor" });
    await expect(
      runSendWithConsumedCompose(
        vi.fn().mockRejectedValue(new Error("network down")),
        ids([], []),
        compose,
      ),
    ).resolves.toBe(false);
  });
});
