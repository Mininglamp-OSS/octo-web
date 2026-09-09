import { describe, expect, it, vi } from "vitest";
import { installDocumentForward, supportsDocumentForward } from "./documentForward";
import type { OctoBuddyCommunicationBridge, DocumentForwardRequest } from "./hostBridge";
import type { WKBaseContext } from "@octo/base/src/Components/WKBase";
import type { DocForwardOpen } from "@octo/base/src/Components/ForwardModal/grant";

function fixture() {
  const listeners = new Map<string, Function>();
  const subscribe = (key: string) => (fn: Function) => { listeners.set(key, fn); return () => { listeners.delete(key); }; };
  const closed = vi.fn();
  let forward: DocForwardOpen;
  const context = {
    showConversationSelect: vi.fn((_callback, _title, input: DocForwardOpen) => { forward = input; return closed; }),
  } as unknown as WKBaseContext;
  const bridge = {
    onDocumentForward: subscribe("request"), onDocumentForwardCancel: subscribe("cancel"), onCommand: subscribe("command"),
    grantDocumentForward: vi.fn(async () => ({ granted: 1, failed: 0 })),
    authorizeDocumentForward: vi.fn(async () => {}),
    respondDocumentForward: vi.fn(),
  } as unknown as OctoBuddyCommunicationBridge;
  const state = { space: "sender-space" };
  const dispose = installDocumentForward(bridge, { getSpaceId: () => state.space, getContext: () => context });
  const request: DocumentForwardRequest = {
    requestId: "main-request", spaceId: state.space,
    input: { docId: "doc-a", title: "Title", link: "https://docs.test/d/doc-a#instruction",
      spaceId: "document-home", canGrant: true, shareAsCard: false },
  };
  return { bridge, listeners, closed, dispose, state, context,
    open: () => listeners.get("request")!(request),
    get forward() { return forward!; },
  };
}

describe("Docs communication artifact adapter", () => {
  it("does nothing for an older host", () => {
    const bridge = {} as OctoBuddyCommunicationBridge;
    expect(supportsDocumentForward(bridge)).toBe(false);
    expect(() => installDocumentForward(bridge, {} as never)()).not.toThrow();
  });
  it("preserves card/text semantics and document space, delegates grant and authorizes every send", async () => {
    const f = fixture();
    f.open();
    expect(f.forward).toMatchObject({ docId: "doc-a", spaceId: "document-home", shareAsCard: false,
      link: "https://docs.test/d/doc-a#instruction" });
    await f.forward.grantAccess!(["recipient"], "writer");
    expect(f.bridge.grantDocumentForward).toHaveBeenCalledWith({ requestId: "main-request", uids: ["recipient"], role: "writer" });
    await f.forward.beforeSend!();
    await f.forward.beforeSend!();
    expect(f.bridge.authorizeDocumentForward).toHaveBeenCalledTimes(2);
    f.forward.onResult!({ sent: 2, failed: 0 });
    f.forward.onResult!({ sent: 2, failed: 0 });
    expect(f.bridge.respondDocumentForward).toHaveBeenCalledTimes(1);
    f.dispose();
  });
  it("source cancellation closes only its picker and rejects any late grant/send", async () => {
    const f = fixture();
    f.open();
    f.listeners.get("cancel")!({ requestId: "unknown" });
    expect(f.closed).not.toHaveBeenCalled();
    f.listeners.get("cancel")!({ requestId: "main-request" });
    expect(f.closed).toHaveBeenCalledTimes(1);
    await expect(f.forward.beforeSend!()).rejects.toThrow();
    await expect(f.forward.grantAccess!(["u"], "reader")).rejects.toThrow();
    expect(f.bridge.authorizeDocumentForward).not.toHaveBeenCalled();
    f.dispose();
  });
  it("rechecks context after asynchronous grant and send authorization", async () => {
    const f = fixture();
    let finish: () => void = () => {};
    vi.mocked(f.bridge.authorizeDocumentForward!).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    f.open();
    const send = f.forward.beforeSend!();
    f.state.space = "new-space";
    finish();
    await expect(send).rejects.toThrow();
    f.dispose();
  });
  it("preserves the picker across layout suspension and same-space updates", () => {
    const f = fixture();
    f.open();
    for (const type of ["suspend", "resume", "hostVisibilityChanged"]) f.listeners.get("command")!({ type });
    f.listeners.get("command")!({ type: "spaceChanged", space: { id: f.state.space } });
    expect(f.forward.isActive!()).toBe(true);
    expect(f.closed).not.toHaveBeenCalled();
    expect(f.bridge.respondDocumentForward).not.toHaveBeenCalled();
    f.dispose();
  });
  it.each(["sessionRevoked", "spaceChanged"])("cancels on %s and removes listeners on cleanup", (type) => {
    const f = fixture();
    f.open();
    f.listeners.get("command")!({ type, space: { id: "different-space" } });
    expect(f.forward.isActive!()).toBe(false);
    expect(f.closed).toHaveBeenCalledTimes(1);
    f.dispose();
    expect(f.listeners.size).toBe(0);
  });
});
