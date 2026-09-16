import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilePreviewInfo } from "../../Components/FilePreviewPanel/types";
import {
  setWebAttachmentHost,
  getWebAttachmentHost,
  canForwardToHost,
  tryHostTakeover,
  cancelHostAttachmentRequests,
  subscribeHostAttachmentPreview,
  subscribeHostAttachmentClosed,
  updateHostAttachmentLayout,
  subscribeHostAttachmentState,
  notifyHostAttachmentState,
  releaseHostAttachmentPreview,
  notifyHostAttachmentClosed,
  type WebAttachmentHost,
  type AttachmentPreviewResult,
} from "./attachmentHost";

const fileInfo = (overrides: Partial<FilePreviewInfo> = {}): FilePreviewInfo => ({
  url: "https://example.com/file.pdf",
  name: "report.pdf",
  extension: "pdf",
  size: 1024,
  sourceChannelId: "g_100",
  sourceChannelType: 2,
  messageId: "123456789012345678",
  messageSeq: 42,
  attachmentIndex: 0,
  fromUID: "user_a",
  ...overrides,
});

let host: WebAttachmentHost;
beforeEach(() => {
  host = {
    openFilePreview: vi.fn().mockResolvedValue({ status: "accepted" }),
    cancelFilePreview: vi.fn().mockResolvedValue(undefined),
  };
  setWebAttachmentHost(host);
});
afterEach(() => setWebAttachmentHost(null));

describe("attachment host source and capability validation", () => {
  it("preserves entries without a host", async () => {
    setWebAttachmentHost(null);
    expect(getWebAttachmentHost()).toBeNull();
    expect(canForwardToHost(fileInfo())).toBe(false);
    await expect(tryHostTakeover(fileInfo())).resolves.toBe("fallback");
  });

  it.each<Partial<FilePreviewInfo>>([
    { sourceChannelId: undefined }, { sourceChannelType: undefined },
    { sourceChannelType: 6 }, { messageId: undefined }, { messageId: "0" },
    { messageId: "9223372036854775808" }, { messageSeq: 0 }, { messageSeq: 1.5 },
    { attachmentIndex: undefined }, { attachmentIndex: -1 }, { attachmentIndex: 4096 },
  ])("keeps unverifiable source %j in Web", async (invalid) => {
    expect(canForwardToHost(fileInfo(invalid))).toBe(false);
    await expect(tryHostTakeover(fileInfo(invalid))).resolves.toBe("fallback");
    expect(host.openFilePreview).not.toHaveBeenCalled();
  });

  it.each(["pdf", "docx", "txt", "png", "mp4"])("forwards verifiable file messages regardless of extension: %s", async (extension) => {
    expect(canForwardToHost(fileInfo({ extension }))).toBe(true);
    await expect(tryHostTakeover(fileInfo({ extension }))).resolves.toBe("taken");
  });

  it("sends only canonical identifiers, preserving exact large IDs and rich block indices", async () => {
    await tryHostTakeover(fileInfo({ messageId: "9223372036854775807", attachmentIndex: 3 }));
    expect(host.openFilePreview).toHaveBeenCalledWith({
      version: 1, requestId: expect.any(String),
      locator: {
        kind: "message-attachment", channelId: "g_100", channelType: 2,
        messageId: "9223372036854775807", messageSeq: 42, attachmentIndex: 3,
      },
    });
  });

});

describe("attachment takeover lifetime", () => {
  it("restores context on a matching native close and ignores a stale close", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeHostAttachmentPreview(listener);
    try {
      await tryHostTakeover(fileInfo());
      const first = vi.mocked(host.openFilePreview).mock.calls[0][0];
      expect(listener).toHaveBeenLastCalledWith(first.locator);
      await tryHostTakeover(fileInfo({ messageSeq: 43 }));
      const second = vi.mocked(host.openFilePreview).mock.calls[1][0];
      notifyHostAttachmentClosed(first.requestId);
      expect(listener).toHaveBeenLastCalledWith(second.locator);
      notifyHostAttachmentClosed(second.requestId);
      expect(listener).toHaveBeenLastCalledWith(null);
    } finally { unsubscribe(); }
  });

  it("settles a native close arriving before the acceptance reply", async () => {
    vi.mocked(host.openFilePreview).mockImplementation(() => new Promise(() => {}));
    const pending = tryHostTakeover(fileInfo());
    await Promise.resolve();
    const request = vi.mocked(host.openFilePreview).mock.calls[0][0];
    notifyHostAttachmentClosed(request.requestId);
    await expect(pending).resolves.toBe("cancelled");
  });

  it("falls back only on explicit unsupported", async () => {
    vi.mocked(host.openFilePreview).mockResolvedValue({ status: "unsupported" });
    await expect(tryHostTakeover(fileInfo())).resolves.toBe("fallback");
  });

  it("never falls back on cancelled", async () => {
    vi.mocked(host.openFilePreview).mockResolvedValue({ status: "cancelled" });
    await expect(tryHostTakeover(fileInfo())).resolves.toBe("cancelled");
  });

  it("reports transport errors without fallback and releases any pending host source", async () => {
    vi.mocked(host.openFilePreview).mockRejectedValue(new Error("Request failed"));
    await expect(tryHostTakeover(fileInfo())).resolves.toBe("error");
    expect(host.cancelFilePreview).toHaveBeenCalledOnce();
  });

  it("rejects extended host replies instead of interpreting them as unsupported", async () => {
    vi.mocked(host.openFilePreview).mockResolvedValue({ status: "unsupported", url: "untrusted" } as AttachmentPreviewResult);
    await expect(tryHostTakeover(fileInfo())).resolves.toBe("error");
  });

  it.each(["transport", "response-validation"])("logs only the failure stage for %s errors", async (stage) => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      if (stage === "transport") {
        vi.mocked(host.openFilePreview).mockRejectedValue(new Error("secret-token-must-not-be-logged"));
      } else {
        vi.mocked(host.openFilePreview).mockResolvedValue({
          status: "unsupported", token: "secret-token-must-not-be-logged",
        } as AttachmentPreviewResult);
      }
      await expect(tryHostTakeover(fileInfo())).resolves.toBe("error");
      expect(debug).toHaveBeenCalledExactlyOnceWith("[file-preview] Native takeover failed", { stage });
    } finally { debug.mockRestore(); }
  });

  it.each(["accepted", "unsupported", "cancelled"] as const)("settles cancellation immediately and ignores late %s", async (status) => {
    let finish!: (result: AttachmentPreviewResult) => void;
    vi.mocked(host.openFilePreview).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = tryHostTakeover(fileInfo());
    await Promise.resolve();
    cancelHostAttachmentRequests();
    await expect(pending).resolves.toBe("cancelled");
    expect(host.cancelFilePreview).toHaveBeenCalledOnce();
    finish({ status });
    await expect(pending).resolves.toBe("cancelled");
  });

  it("does not invoke a source cancelled before bridge dispatch", async () => {
    const pending = tryHostTakeover(fileInfo());
    cancelHostAttachmentRequests();
    await expect(pending).resolves.toBe("cancelled");
    expect(host.openFilePreview).not.toHaveBeenCalled();
  });

  it("releases the old accepted source when the next entry stays in Web", async () => {
    await expect(tryHostTakeover(fileInfo())).resolves.toBe("taken");
    const request = vi.mocked(host.openFilePreview).mock.calls[0][0];
    await expect(tryHostTakeover(fileInfo({ messageId: undefined }))).resolves.toBe("fallback");
    expect(host.cancelFilePreview).toHaveBeenCalledWith({ version: 1, requestId: request.requestId });
  });

  it("releases accepted sources on host replacement and tolerates a disconnected old bridge", async () => {
    vi.mocked(host.cancelFilePreview).mockRejectedValue(new Error("Bridge gone"));
    await expect(tryHostTakeover(fileInfo())).resolves.toBe("taken");
    const next = { openFilePreview: vi.fn().mockResolvedValue({ status: "accepted" }), cancelFilePreview: vi.fn() };
    setWebAttachmentHost(next);
    await expect(tryHostTakeover(fileInfo())).resolves.toBe("taken");
    expect(host.cancelFilePreview).toHaveBeenCalledOnce();
    expect(next.openFilePreview).toHaveBeenCalledOnce();
  });

  it("does not let an old rejected request cancel the newer accepted source", async () => {
    let rejectOld!: (error: Error) => void;
    vi.mocked(host.openFilePreview).mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }));
    const first = tryHostTakeover(fileInfo());
    await Promise.resolve();
    await expect(tryHostTakeover(fileInfo({ messageSeq: 43 }))).resolves.toBe("taken");
    const newerRequest = vi.mocked(host.openFilePreview).mock.calls[1][0];
    await expect(first).resolves.toBe("cancelled");
    rejectOld(new Error("Late failure"));
    // Drain the rejection's complete promise chain before inspecting the new request.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(host.cancelFilePreview).toHaveBeenCalledTimes(1);
    cancelHostAttachmentRequests();
    await vi.waitFor(() => {
      expect(host.cancelFilePreview).toHaveBeenCalledTimes(2);
      expect(host.cancelFilePreview).toHaveBeenLastCalledWith({
        version: 1, requestId: newerRequest.requestId,
      });
    });
  });

  describe("inline host negotiation", () => {
    beforeEach(() => {
      host.openFilePreviewInPlace = vi.fn().mockResolvedValue({ status: "accepted" });
      host.setFilePreviewLayout = vi.fn().mockResolvedValue(undefined);
      setWebAttachmentHost(host);
    });
    afterEach(() => {
      delete (host as any).openFilePreviewInPlace;
      delete (host as any).setFilePreviewLayout;
    });

    it("falls back to openFilePreview when the host lacks in-place capability", async () => {
      delete (host as any).openFilePreviewInPlace;
      delete (host as any).setFilePreviewLayout;
      setWebAttachmentHost(host);
      const onInline = vi.fn();
      await expect(tryHostTakeover(fileInfo(), onInline)).resolves.toBe("taken");
      expect(host.openFilePreview).toHaveBeenCalled();
      expect(onInline).not.toHaveBeenCalled();
    });

    it("invokes inline callback and uses in-place methods when available", async () => {
      const onInline = vi.fn();
      await expect(tryHostTakeover(fileInfo(), onInline)).resolves.toBe("taken");
      expect(host.openFilePreviewInPlace).toHaveBeenCalledOnce();
      expect(host.openFilePreview).not.toHaveBeenCalled();
      expect(onInline).toHaveBeenCalledOnce();
      const inlineFile = onInline.mock.calls[0][0];
      expect(inlineFile.hostPreview).toBeDefined();
      expect(inlineFile.hostPreview.requestId).toEqual(expect.any(String));
    });

    it("leaves unsupported fallback to its caller without cancelling the replacement Web layer", async () => {
      vi.mocked(host.openFilePreviewInPlace!).mockResolvedValue({ status: "unsupported" });
      const closeListener = vi.fn();
      const unsub = subscribeHostAttachmentClosed(closeListener);
      try {
        await expect(tryHostTakeover(fileInfo(), vi.fn())).resolves.toBe("fallback");
        expect(closeListener).not.toHaveBeenCalled();
      } finally { unsub(); }
    });

    it("propagates accepted source to preview listeners", async () => {
      const previewListener = vi.fn();
      const unsub = subscribeHostAttachmentPreview(previewListener);
      try {
        const onInline = (f: any) => {};
        await tryHostTakeover(fileInfo(), onInline);
        const req = vi.mocked(host.openFilePreviewInPlace!).mock.calls[0][0];
        expect(previewListener).toHaveBeenLastCalledWith(req.locator);
      } finally { unsub(); }
    });

    it("does not accept a new takeover after host replacement with stale in-place reply", async () => {
      let resolveInPlace!: (r: any) => void;
      vi.mocked(host.openFilePreviewInPlace!).mockImplementationOnce(
        () => new Promise((r) => { resolveInPlace = r; }),
      );
      const pending = tryHostTakeover(fileInfo(), vi.fn());
      await Promise.resolve();
      setWebAttachmentHost({ openFilePreview: vi.fn().mockResolvedValue({ status: "accepted" }), cancelFilePreview: vi.fn() });
      resolveInPlace!({ status: "accepted" });
      await expect(pending).resolves.toBe("cancelled");
    });

    it("uses openFilePreview (non-inline) when no onInlineOpen callback is given even with in-place host", async () => {
      await expect(tryHostTakeover(fileInfo())).resolves.toBe("taken");
      expect(host.openFilePreview).toHaveBeenCalledOnce();
      expect(host.openFilePreviewInPlace).not.toHaveBeenCalled();
    });
  });

  describe("host attachment state subscription", () => {
    it("forwards only the current state and replays it to a newly mounted slot", async () => {
      await tryHostTakeover(fileInfo());
      const { requestId } = vi.mocked(host.openFilePreview).mock.calls[0][0];
      const listener = vi.fn();
      const unsubscribe = subscribeHostAttachmentState(listener);
      notifyHostAttachmentState({ requestId: "stale", phase: "error" });
      expect(listener).not.toHaveBeenCalled();
      const state = { requestId, phase: "error" as const, error: "Denied" };
      notifyHostAttachmentState(state);
      expect(listener).toHaveBeenCalledWith(state);
      unsubscribe();
      const replay = vi.fn();
      const offReplay = subscribeHostAttachmentState(replay);
      expect(replay).toHaveBeenCalledWith(state);
      offReplay();
      cancelHostAttachmentRequests();
      const afterCancel = vi.fn();
      const offCancelled = subscribeHostAttachmentState(afterCancel);
      expect(afterCancel).not.toHaveBeenCalled();
      offCancelled();
    });
  });

  describe("stale layout and close", () => {
    it("releases only the unmounted slot's source, leaving a newer request alone", async () => {
      await tryHostTakeover(fileInfo());
      const first = vi.mocked(host.openFilePreview).mock.calls[0][0].requestId;
      await tryHostTakeover(fileInfo({ messageSeq: 43 }));
      const second = vi.mocked(host.openFilePreview).mock.calls[1][0].requestId;
      vi.mocked(host.cancelFilePreview).mockClear();
      releaseHostAttachmentPreview(first);
      await Promise.resolve();
      expect(host.cancelFilePreview).not.toHaveBeenCalled();
      releaseHostAttachmentPreview(second);
      await Promise.resolve();
      expect(host.cancelFilePreview).toHaveBeenCalledWith({ version: 1, requestId: second });
    });
    it("ignores layout updates for an unknown requestId", async () => {
      await expect(updateHostAttachmentLayout({
        version: 1, requestId: "nonexistent", bounds: { x: 0, y: 0, width: 100, height: 100 }, visible: true,
      })).resolves.toBeUndefined();
    });

    it("ignores a native close for an unknown requestId", () => {
      const listener = vi.fn();
      const unsub = subscribeHostAttachmentClosed(listener);
      try {
        notifyHostAttachmentClosed("stale-request");
        expect(listener).not.toHaveBeenCalled();
      } finally { unsub(); }
    });
  });
});
