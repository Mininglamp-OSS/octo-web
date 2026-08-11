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
}

function makeCompose(): RecordingCompose {
  const calls: string[] = [];
  const restoredTopIds: string[] = [];
  const disposedTopIds: string[] = [];
  const state = {
    calls,
    restoredTopIds,
    disposedTopIds,
    restoreEditor: vi.fn(() => calls.push("restoreEditor")),
    disposeEditorAttachments: vi.fn(() => calls.push("disposeEditorAttachments")),
    disposeTopAttachments: vi.fn((ids: string[]) => {
      calls.push("disposeTopAttachments");
      disposedTopIds.push(...ids);
    }),
    restoreTopAttachments: vi.fn((ids: string[]) => {
      calls.push("restoreTopAttachments");
      restoredTopIds.push(...ids);
    }),
  };
  return state as unknown as RecordingCompose;
}

describe("runSendWithConsumedCompose — success keeps the composer empty (#1280)", () => {
  it("disposes refs/urls and restores nothing when the send succeeds", async () => {
    const compose = makeCompose();
    const send = vi.fn().mockResolvedValue(true);

    const ok = await runSendWithConsumedCompose(send, ["t1", "t2"], compose);

    expect(ok).toBe(true);
    expect(compose.restoreEditor).not.toHaveBeenCalled();
    expect(compose.restoreTopAttachments).not.toHaveBeenCalled();
    expect(compose.disposeEditorAttachments).toHaveBeenCalledTimes(1);
    expect(compose.disposedTopIds).toEqual(["t1", "t2"]);
  });

  it("treats void/undefined return as success (back-compat with legacy onSend)", async () => {
    const compose = makeCompose();

    const ok = await runSendWithConsumedCompose(
      vi.fn().mockResolvedValue(undefined),
      ["t1"],
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

    const ok = await runSendWithConsumedCompose(send, [], compose);

    expect(ok).toBe(true);
    expect(compose.restoreEditor).not.toHaveBeenCalled();
    expect(compose.disposeEditorAttachments).toHaveBeenCalledTimes(1);
  });

  it("does NOT restore already-sent content even when the user typed during the await", async () => {
    // The #1280 bug: a mid-flight document change used to leave the sent content
    // in the composer. Consume-first makes it structurally impossible — success
    // simply never touches the live document.
    const compose = makeCompose();
    let resolveSend!: (v: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((res) => (resolveSend = res)));

    const p = runSendWithConsumedCompose(send, ["t1"], compose);
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

    const ok = await runSendWithConsumedCompose(send, ["t1", "t2"], compose);

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

    const ok = await runSendWithConsumedCompose(send, ["t1"], compose);

    expect(ok).toBe(false);
    expect(compose.restoreEditor).toHaveBeenCalledTimes(1);
    expect(compose.restoredTopIds).toEqual(["t1"]);
    expect(compose.disposeEditorAttachments).not.toHaveBeenCalled();
  });

  it("never restores or disposes before the async send settles (ordering guarantee)", async () => {
    const compose = makeCompose();
    let resolveSend!: (v: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((res) => (resolveSend = res)));

    const p = runSendWithConsumedCompose(send, ["t1"], compose);

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

    const ok = await runSendWithConsumedCompose(send, ["t1", "t2"], compose);

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

    const ok = await runSendWithConsumedCompose(send, ["t1", "t2"], compose);

    expect(ok).toBe(true);
    expect(compose.disposedTopIds).toEqual(["t1"]);
    expect(compose.restoredTopIds).toEqual(["t2"]);
  });

  it("detail editorConsumed=true with no consumedTopIds falls back to all top ids", async () => {
    const compose = makeCompose();

    await runSendWithConsumedCompose(
      vi.fn().mockResolvedValue({ editorConsumed: true }),
      ["t1", "t2"],
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
    const target: ComposeRestoreTarget = {
      isEmpty: () => isEmpty,
      setContent: () => calls.push("setContent"),
      focusEnd: () => calls.push("focusEnd"),
      insertContentAtStart: () => {
        calls.push("insertContentAtStart");
        if (throwOnStart) throw new Error("bad position");
      },
      appendContent: () => calls.push("appendContent"),
    };
    return { target, calls };
  }

  const snapshot = { content: [{ type: "paragraph" }] };

  it("restores the snapshot as-is when the composer is still empty", () => {
    const { target, calls } = makeTarget(true);
    restoreComposeSnapshot(snapshot, target);
    expect(calls).toEqual(["setContent", "focusEnd"]);
  });

  it("prepends the failed content before a draft typed during the await", () => {
    const { target, calls } = makeTarget(false);
    restoreComposeSnapshot(snapshot, target);
    // Never setContent here — that was the #227 round-2 data loss.
    expect(calls).toEqual(["insertContentAtStart"]);
  });

  it("falls back to appending when the start position is rejected", () => {
    const { target, calls } = makeTarget(false, true);
    restoreComposeSnapshot(snapshot, target);
    expect(calls).toEqual(["insertContentAtStart", "appendContent"]);
  });

  it("does nothing for an empty snapshot", () => {
    const { target, calls } = makeTarget(true);
    restoreComposeSnapshot({ content: [] }, target);
    restoreComposeSnapshot(undefined, target);
    expect(calls).toEqual([]);
  });
});
