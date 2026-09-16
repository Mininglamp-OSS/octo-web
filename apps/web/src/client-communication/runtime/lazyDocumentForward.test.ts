import { describe, expect, it, vi } from "vitest";
import { installLazyDocumentForward } from "./lazyDocumentForward";
import type { DocumentForwardRequest, OctoBuddyCommunicationBridge } from "../hostBridge";

describe("lazy document forwarding", () => {
  it("waits for UI and does not revive a cancelled or expired request", async () => {
    let receive!: (request: DocumentForwardRequest) => void;
    let cancel!: (value: { requestId: string }) => void;
    let ready!: () => void;
    let current = true;
    const host = {
      onDocumentForward: (fn: typeof receive) => { receive = fn; return vi.fn(); },
      onDocumentForwardCancel: (fn: typeof cancel) => { cancel = fn; return vi.fn(); },
      grantDocumentForward: vi.fn(), authorizeDocumentForward: vi.fn(), respondDocumentForward: vi.fn(),
    };
    const controller = installLazyDocumentForward(host as unknown as OctoBuddyCommunicationBridge,
      { isCurrent: () => current }, () => new Promise<void>(resolve => { ready = resolve; }));
    const listener = vi.fn();
    controller.subscribe(listener);
    const request = { requestId: "r", runtimeScope: { ownerId: "o", contextId: "c", epoch: 1 }, spaceId: "s", input: {} } as DocumentForwardRequest;
    receive(request);
    expect(listener).not.toHaveBeenCalled();
    cancel({ requestId: "r" });
    ready();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(host.respondDocumentForward).toHaveBeenLastCalledWith({ requestId: "r", ok: true, result: null });
    receive({ ...request, requestId: "other" });
    current = false;
    ready();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(host.respondDocumentForward).toHaveBeenLastCalledWith({ requestId: "other", ok: false, error: "Document forward context expired" });
    controller.dispose();
  });
});
