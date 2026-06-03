/**
 * Regression tests for the mixed text+image send-failure data-loss bug
 * (octo-web#227, Jerry-Xin P1).
 *
 * The bug: MessageInput cleared the editor / deleted pasted-image File refs /
 * revoked preview URLs synchronously, BEFORE the awaited async send (mixed
 * RichText) could report failure. A failed image upload therefore destroyed
 * the user's whole text+image compose with no message and nothing to retry.
 *
 * The contract these tests lock in:
 *   - send resolves false  → NO cleanup runs; editor draft + image refs +
 *                            preview URLs survive for retry.
 *   - send throws          → same as false (preserve draft).
 *   - send resolves true    → cleanup runs (success path unchanged).
 *   - send resolves void    → treated as success (back-compat with legacy
 *                            void-returning onSend callers).
 *   - cleanup never runs before the send settles (ordering guarantee).
 */

import { describe, it, expect, vi } from "vitest";
import { runSendWithCleanup, SendCleanup } from "../sendFlow";

function makeCleanup(): SendCleanup & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deleteAttachmentRefs: vi.fn(() => calls.push("deleteAttachmentRefs")),
    revokePreviewUrls: vi.fn(() => calls.push("revokePreviewUrls")),
    clearTopAttachments: vi.fn(() => calls.push("clearTopAttachments")),
    clearEditor: vi.fn(() => calls.push("clearEditor")),
    collapseExpanded: vi.fn(() => calls.push("collapseExpanded")),
  };
}

describe("runSendWithCleanup — mixed send failure preserves draft (octo-web#227)", () => {
  it("does NOT clear editor / delete image refs / revoke URLs when send resolves false", async () => {
    const cleanup = makeCleanup();
    // mixed text+image send fails (e.g. image upload / read failure)
    const send = vi.fn().mockResolvedValue(false);

    const ok = await runSendWithCleanup(send, cleanup);

    expect(ok).toBe(false);
    // The whole compose state must survive so the user can retry.
    expect(cleanup.deleteAttachmentRefs).not.toHaveBeenCalled();
    expect(cleanup.revokePreviewUrls).not.toHaveBeenCalled();
    expect(cleanup.clearTopAttachments).not.toHaveBeenCalled();
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
    expect(cleanup.collapseExpanded).not.toHaveBeenCalled();
    expect(cleanup.calls).toEqual([]);
  });

  it("preserves draft when send throws (image prepare/upload error)", async () => {
    const cleanup = makeCleanup();
    const send = vi.fn().mockRejectedValue(new Error("upload failed"));

    const ok = await runSendWithCleanup(send, cleanup);

    expect(ok).toBe(false);
    expect(cleanup.calls).toEqual([]);
  });

  it("clears compose state when send succeeds (resolves true)", async () => {
    const cleanup = makeCleanup();
    const send = vi.fn().mockResolvedValue(true);

    const ok = await runSendWithCleanup(send, cleanup);

    expect(ok).toBe(true);
    expect(cleanup.deleteAttachmentRefs).toHaveBeenCalledTimes(1);
    expect(cleanup.revokePreviewUrls).toHaveBeenCalledTimes(1);
    expect(cleanup.clearTopAttachments).toHaveBeenCalledTimes(1);
    expect(cleanup.clearEditor).toHaveBeenCalledTimes(1);
    expect(cleanup.collapseExpanded).toHaveBeenCalledTimes(1);
  });

  it("treats void/undefined return as success (back-compat with legacy onSend)", async () => {
    const cleanup = makeCleanup();
    const send = vi.fn().mockResolvedValue(undefined);

    const ok = await runSendWithCleanup(send, cleanup);

    expect(ok).toBe(true);
    expect(cleanup.clearEditor).toHaveBeenCalledTimes(1);
  });

  it("treats a synchronous void return as success", async () => {
    const cleanup = makeCleanup();
    const send = vi.fn(() => {
      /* legacy void onSend */
    });

    const ok = await runSendWithCleanup(send, cleanup);

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

    const p = runSendWithCleanup(send, cleanup);

    // Send is still in flight (upload pending) — nothing must be cleared yet.
    await Promise.resolve();
    expect(cleanup.clearEditor).not.toHaveBeenCalled();
    expect(cleanup.deleteAttachmentRefs).not.toHaveBeenCalled();

    resolveSend(true);
    await p;

    // Only after the send resolves successfully does cleanup happen.
    expect(cleanup.clearEditor).toHaveBeenCalledTimes(1);
  });
});
