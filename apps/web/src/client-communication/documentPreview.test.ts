import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDocumentPreviewBody,
} from "@octo/base/src/Service/DocumentPreviewService";
import type { DocumentPreviewResponse } from "@octo/base/src/Service/DocumentPreviewService";
import { installHostDocumentPreview } from "./documentPreview";
import type { HostCommand, OctoBuddyCommunicationBridge } from "./hostBridge";

vi.mock("@octo/base/src/Messages/DocumentShareCard/preview", () => ({
  resetDocPreviewCache: vi.fn(),
}));

import { resetDocPreviewCache } from "@octo/base/src/Messages/DocumentShareCard/preview";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.clearAllMocks();
});

function fixture() {
  let onCommand: (command: HostCommand) => void = () => {};
  const bridge = {
    getDocumentPreview: vi.fn(async (): Promise<DocumentPreviewResponse> => ({
      ok: true, body: { preview: {} },
    })),
    reportAuthExpired: vi.fn(),
    onCommand: vi.fn((callback: typeof onCommand) => {
      onCommand = callback;
      return vi.fn();
    }),
  };
  dispose = installHostDocumentPreview(bridge as unknown as OctoBuddyCommunicationBridge, "space-a");
  return { bridge, command: (command: HostCommand) => onCommand(command) };
}

describe("communication document preview adapter", () => {
  it("supports an older host without registering a transport", () => {
    expect(() => installHostDocumentPreview({} as OctoBuddyCommunicationBridge, "space-a")()).not.toThrow();
    expect(resetDocPreviewCache).not.toHaveBeenCalled();
  });

  it("passes document identity to the host without message-supplied space", async () => {
    const f = fixture();
    await getDocumentPreviewBody({ docId: "d_1", kind: "html" }, "untrusted-space");
    expect(f.bridge.getDocumentPreview).toHaveBeenCalledWith({ docId: "d_1", kind: "html" });
  });

  it("reports an expired current session instead of hiding authentication failure", async () => {
    const f = fixture();
    f.bridge.getDocumentPreview.mockResolvedValue({ ok: false, status: 401 });
    await expect(getDocumentPreviewBody({ docId: "d_1", kind: "doc" }, ""))
      .rejects.toMatchObject({ status: 401 });
    expect(f.bridge.reportAuthExpired).toHaveBeenCalledTimes(1);
  });

  it("does not invalidate cached status for same-space or visibility updates", async () => {
    const f = fixture();
    f.command({ type: "spaceChanged", space: { id: "space-a", name: "A" } });
    f.command({ type: "hostVisibilityChanged", visible: false });
    expect(resetDocPreviewCache).toHaveBeenCalledTimes(1);
    await expect(getDocumentPreviewBody({ docId: "d_1", kind: "doc" }, ""))
      .resolves.toEqual({ preview: {} });
  });

  it("does not issue new preview requests after session revocation", async () => {
    const f = fixture();
    f.command({ type: "sessionRevoked" });
    await expect(getDocumentPreviewBody({ docId: "d_1", kind: "doc" }, "")).rejects.toThrow();
    expect(f.bridge.getDocumentPreview).not.toHaveBeenCalled();
  });

  it.each(["spaceChanged", "sessionRevoked", "dispose"] as const)(
    "rejects stale completion after %s and clears the preview cache", async (type) => {
      const f = fixture();
      let resolve: (result: DocumentPreviewResponse) => void = () => {};
      f.bridge.getDocumentPreview.mockImplementation(() => new Promise((done) => { resolve = done; }));
      const pending = getDocumentPreviewBody({ docId: "d_1", kind: "doc" }, "");
      const assertion = expect(pending).rejects.toMatchObject({ status: undefined });
      if (type === "dispose") dispose!();
      else if (type === "spaceChanged") f.command({ type, space: { id: "new", name: "New" } });
      else f.command({ type });
      resolve({ ok: false, status: 401 });
      await assertion;
      expect(f.bridge.reportAuthExpired).not.toHaveBeenCalled();
      expect(resetDocPreviewCache).toHaveBeenCalledTimes(2);
    },
  );
});
