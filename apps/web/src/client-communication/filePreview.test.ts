import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelHostAttachmentRequests,
  getWebAttachmentHost,
  setWebAttachmentHost,
} from "@octo/base/src/features/filePreview/attachmentHost";
import { installHostFilePreview } from "./filePreview";
import type { HostCommand, OctoBuddyCommunicationBridge } from "./hostBridge";
import type {
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
} from "@octo/base/src/features/filePreview/attachmentHost";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  setWebAttachmentHost(null);
  cancelHostAttachmentRequests();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function fixture() {
  let onCommand: (command: HostCommand) => void = () => {};
  const openFilePreview = vi.fn(async (): Promise<AttachmentPreviewResult> => ({ status: "accepted" }));
  const cancelFilePreview = vi.fn(async () => {});
  const bridge = {
    openFilePreview, cancelFilePreview,
    onCommand: vi.fn((callback: typeof onCommand) => {
      onCommand = callback;
      return vi.fn();
    }),
  };
  dispose = installHostFilePreview(bridge as unknown as OctoBuddyCommunicationBridge, "space-a");
  return { bridge, openFilePreview, cancelFilePreview, command: (command: HostCommand) => onCommand(command) };
}

const request: AttachmentPreviewRequest = {
  version: 1,
  requestId: "r_1",
  locator: {
    kind: "message-attachment",
    channelId: "g_100",
    channelType: 2,
    messageId: "123456789012345678",
    messageSeq: 42,
    attachmentIndex: 0,
  },
};

describe("communication file preview adapter", () => {
  it("installs inline ports only as a pair and disables them after session revocation", async () => {
    let command!: (value: HostCommand) => void;
    const bridge = {
      openFilePreview: vi.fn(async () => ({ status: "accepted" })),
      cancelFilePreview: vi.fn(async () => {}),
      openFilePreviewInPlace: vi.fn(async () => ({ status: "accepted" })),
      setFilePreviewLayout: vi.fn(async () => {}),
      onCommand: (listener: typeof command) => { command = listener; return () => {}; },
    };
    dispose = installHostFilePreview(bridge as unknown as OctoBuddyCommunicationBridge, "space-a");
    const host = getWebAttachmentHost()!;
    await host.openFilePreviewInPlace!(request);
    const layout = { version: 1 as const, requestId: request.requestId, visible: true, bounds: { x: 0, y: 0, width: 320, height: 600 } };
    await host.setFilePreviewLayout!(layout);
    expect(bridge.openFilePreviewInPlace).toHaveBeenCalledWith(request);
    expect(bridge.setFilePreviewLayout).toHaveBeenCalledWith(layout);
    command({ type: "sessionRevoked" });
    await expect(host.openFilePreviewInPlace!(request)).resolves.toEqual({ status: "cancelled" });
    await host.setFilePreviewLayout!(layout);
    expect(bridge.setFilePreviewLayout).toHaveBeenCalledTimes(1);
    dispose();
    dispose = installHostFilePreview({ ...bridge, setFilePreviewLayout: undefined } as unknown as OctoBuddyCommunicationBridge, "space-a");
    expect(getWebAttachmentHost()!.openFilePreviewInPlace).toBeUndefined();
  });

  it("does nothing without a host port", () => {
    expect(
      () => installHostFilePreview({} as OctoBuddyCommunicationBridge, "space-a")()
    ).not.toThrow();
    expect(getWebAttachmentHost()).toBeNull();
  });

  it("registers the top-level methods exposed by the Client preload", async () => {
    const f = fixture();
    const host = getWebAttachmentHost();
    expect(host).not.toBeNull();
    await host!.openFilePreview(request);
    expect(f.openFilePreview).toHaveBeenCalledWith(request);
  });

  it("forwards cancellation to the host port", async () => {
    const f = fixture();
    const host = getWebAttachmentHost()!;
    await host.cancelFilePreview({ version: 1, requestId: "r_1" });
    expect(f.cancelFilePreview).toHaveBeenCalledWith({ version: 1, requestId: "r_1" });
  });

  it("returns cancelled after session revocation without hitting the host", async () => {
    const f = fixture();
    const host = getWebAttachmentHost()!;
    f.command({ type: "sessionRevoked" });
    f.command({ type: "sessionRevoked" });
    await expect(host.openFilePreview(request)).resolves.toEqual({ status: "cancelled" });
    expect(f.openFilePreview).not.toHaveBeenCalled();
  });

  it("cancels in-flight takeover on space change", async () => {
    const f = fixture();
    const { tryHostTakeover } = await import(
      "@octo/base/src/features/filePreview/attachmentHost"
    );
    const previewInfo = {
      url: "https://example.com/f.pdf",
      name: "f.pdf",
      extension: "pdf",
      size: 10,
      sourceChannelId: "g_100",
      sourceChannelType: 2,
      messageId: "123456789012345678",
      messageSeq: 42,
      fromUID: "user_a",
      attachmentIndex: 0,
    };
    let resolveOpen!: (r: AttachmentPreviewResult) => void;
    f.openFilePreview.mockImplementationOnce(() => new Promise((done) => { resolveOpen = done; }));
    const pending = tryHostTakeover(previewInfo);
    await Promise.resolve();
    f.command({ type: "spaceChanged", space: { id: "space-b", name: "B" } });
    await Promise.resolve();
    expect(f.cancelFilePreview).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: expect.any(String) })
    );
    resolveOpen({ status: "accepted" });
    await expect(pending).resolves.toBe("cancelled");
  });

  it("clears the host registry on dispose", () => {
    const f = fixture();
    expect(getWebAttachmentHost()).not.toBeNull();
    dispose?.();
    dispose = undefined;
    expect(getWebAttachmentHost()).toBeNull();
  });

  it("unregisters host and cancels pending requests on dispose", () => {
    const f = fixture();
    dispose?.();
    dispose = undefined;
    expect(f.bridge.onCommand).toHaveBeenCalled();
    expect(getWebAttachmentHost()).toBeNull();
  });

  it("does not install a partial capability", () => {
    dispose?.();
    dispose = undefined;
    installHostFilePreview({ openFilePreview: vi.fn() } as unknown as OctoBuddyCommunicationBridge, "space-a");
    expect(getWebAttachmentHost()).toBeNull();
  });

  it("ignores layout suspension and preserves the same workspace", async () => {
    const f = fixture();
    const host = getWebAttachmentHost()!;
    f.command({ type: "suspend" });
    f.command({ type: "resume" });
    f.command({ type: "spaceChanged", space: { id: "space-a", name: "Renamed" } });
    await expect(host.openFilePreview(request)).resolves.toEqual({ status: "accepted" });
    expect(f.cancelFilePreview).not.toHaveBeenCalled();
  });

  it("does not let a disposed adapter remove a newer host", () => {
    fixture();
    const firstDispose = dispose!;
    fixture();
    const nextHost = getWebAttachmentHost();
    firstDispose();
    expect(getWebAttachmentHost()).toBe(nextHost);
  });
});
