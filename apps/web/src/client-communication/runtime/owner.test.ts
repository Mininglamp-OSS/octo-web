import { describe, expect, it, vi } from "vitest";
import { createCommunicationOwner, type OwnerRuntimePorts } from "./owner";
import type { RuntimeBadge, RuntimeSnapshot } from "../../client-feature/runtimeContract";

const scope = { ownerId: "owner", contextId: "context-a", epoch: 1 };
function fixture(withSummary = false) {
  let accept: (command: unknown) => void = () => {};
  let notify = () => {};
  let badge: RuntimeBadge = { status: "loading", count: null };
  let connected = true;
  const release = vi.fn();
  const stopListening = vi.fn();
  const ports: OwnerRuntimePorts = {
    bootstrap: { ...scope, version: 1, summaryAttention: withSummary ? "owner" : "disabled" },
    retainData: vi.fn(() => release),
    subscribeData: vi.fn(callback => { notify = callback; return stopListening; }),
    readMessages: () => badge,
    isConnected: () => connected,
    refreshMessages: vi.fn(() => new Promise<void>(() => {})),
    applySpace: vi.fn(() => { badge = { status: "loading", count: null }; notify(); }),
    setReadAttention: vi.fn(),
    disposeData: vi.fn(),
    reportReady: vi.fn(async () => {}),
    reportSnapshot: vi.fn(),
    reportCommandResult: vi.fn(),
    onCommand: vi.fn(callback => { accept = callback; return stopListening; }),
    dispatchUi: vi.fn(), startUi: vi.fn(async () => {}), disposeUi: vi.fn(),
    fireTimer: vi.fn(), onError: vi.fn(),
    ...(withSummary ? { summary: {
      start: vi.fn(), setActivity: vi.fn(), refresh: vi.fn(async () => {}), switchSpace: vi.fn(), dispose: vi.fn(),
    } } : {}),
  };
  const owner = createCommunicationOwner(ports);
  return {
    owner, ports, release, stopListening,
    send: (fields: object) => accept({ version: 1, ...scope, ...fields }),
    setBadge: (next: RuntimeBadge) => { badge = next; notify(); },
    disconnect: () => { connected = false; notify(); },
    snapshots: () => vi.mocked(ports.reportSnapshot).mock.calls.map(([snapshot]) => snapshot as RuntimeSnapshot),
  };
}
describe("communication data owner", () => {
  it("acknowledges refresh acceptance before network completion and rejects stale scopes", async () => {
    const f = fixture(true);
    vi.mocked(f.ports.summary!.refresh).mockImplementation(() => new Promise(() => {}));
    await f.owner.start();
    f.send({ type: "invalidateSummary", requestId: "r1", reason: "mutation" });
    expect(f.ports.summary!.refresh).toHaveBeenCalledWith("mutation");
    expect(f.ports.reportCommandResult).toHaveBeenLastCalledWith({
      version: 1, ...scope, requestId: "r1", accepted: true,
    });
    f.send({ type: "invalidateSummary", requestId: "r2", reason: "mutation", epoch: 0 });
    expect(f.ports.summary!.refresh).toHaveBeenCalledTimes(1);
    expect(f.ports.reportCommandResult).toHaveBeenLastCalledWith({
      version: 1, ...scope, epoch: 0, requestId: "r2", accepted: false,
    });
    f.owner.dispose();
  });
  it("is ready without UI or network completion and starts once", async () => {
    const f = fixture();
    await f.owner.start();
    await f.owner.start();
    expect(f.ports.reportReady).toHaveBeenCalledOnce();
    expect(f.ports.reportReady).toHaveBeenCalledWith({ version: 1, ...scope, backgroundRuntimeVersion: 1 });
    expect(f.ports.retainData).toHaveBeenCalledOnce();
    expect(f.ports.startUi).not.toHaveBeenCalled();
    expect(f.snapshots().at(-1)?.badges.messages).toEqual({ status: "loading", count: null });
    f.setBadge({ status: "ready", count: 8 });
    expect(f.snapshots().at(-1)?.badges.messages).toEqual({ status: "ready", count: 8 });
    f.disconnect();
    expect(f.snapshots().at(-1)).toMatchObject({ phase: "offline", badges: { messages: { status: "stale", count: 8 } } });
    f.owner.dispose();
  });
  it("invalidates the old scope and clears UI targets before applying Space", async () => {
    const f = fixture(true);
    await f.owner.start();
    f.setBadge({ status: "ready", count: 9 });
    f.owner.updateSummary({ status: "ready", count: 3 });
    f.send({ type: "spaceChanged", next: { contextId: "context-b", epoch: 2, space: { id: "b", name: "B" } } });
    expect(f.owner.getScope()).toEqual({ ...scope, contextId: "context-b", epoch: 2 });
    expect(f.snapshots().at(-1)).toMatchObject({
      contextId: "context-b", epoch: 2,
      badges: { messages: { status: "loading", count: null }, summary: { status: "loading", count: null } },
    });
    expect(vi.mocked(f.ports.dispatchUi).mock.invocationCallOrder.at(-1))
      .toBeLessThan(vi.mocked(f.ports.applySpace).mock.invocationCallOrder.at(-1)!);
    f.send({ type: "navigate", page: "chat" });
    expect(f.ports.startUi).not.toHaveBeenCalled();
    f.send({ contextId: "context-b", epoch: 2, type: "navigate", page: "chat" });
    expect(f.ports.startUi).toHaveBeenCalledOnce();
    expect(f.ports.summary?.switchSpace).toHaveBeenCalledOnce();
    f.owner.dispose();
  });
  it("requires all reading conditions and revokes attention on scope switch", async () => {
    const f = fixture(true);
    await f.owner.start();
    const activity = { applicationActive: true, windowVisible: true, windowFocused: true, communicationSurfaceVisible: true };
    for (const key of Object.keys(activity)) {
      f.send({ type: "activity", activity: { ...activity, [key]: false } });
      expect(f.ports.setReadAttention).toHaveBeenLastCalledWith(false);
    }
    f.send({ type: "activity", activity });
    expect(f.ports.setReadAttention).toHaveBeenLastCalledWith(true);
    f.send({ type: "spaceChanged", next: { contextId: "new", epoch: 2, space: { id: "b", name: "" } } });
    expect(f.ports.setReadAttention).toHaveBeenLastCalledWith(false);
    f.owner.dispose();
  });
  it("rejects malformed messages and rollback/same-context transitions", async () => {
    const f = fixture();
    await f.owner.start();
    f.send({ type: "execute", script: "x" });
    f.send({ type: "refresh", epoch: 0 });
    f.send({ type: "spaceChanged", next: { contextId: "new", epoch: 0, space: { id: "b", name: "" } } });
    f.send({ type: "spaceChanged", next: { contextId: scope.contextId, epoch: 2, space: { id: "b", name: "" } } });
    expect(f.ports.applySpace).not.toHaveBeenCalled();
    expect(f.ports.refreshMessages).toHaveBeenCalledOnce();
    expect(f.ports.onError).toHaveBeenCalledOnce();
    f.owner.dispose();
  });
  it("tears down UI before data/gate and ignores late callbacks", async () => {
    const f = fixture(true);
    await f.owner.start();
    f.owner.dispose();
    f.owner.dispose();
    expect(f.ports.disposeUi).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.ports.summary?.dispose).toHaveBeenCalledOnce();
    expect(vi.mocked(f.ports.disposeUi).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(f.ports.disposeData).mock.invocationCallOrder[0]);
    const count = f.snapshots().length;
    f.setBadge({ status: "ready", count: 100 });
    f.send({ type: "navigate", page: "chat" });
    f.owner.updateSummary({ status: "ready", count: 40 });
    expect(f.snapshots()).toHaveLength(count);
    expect(f.ports.startUi).not.toHaveBeenCalled();
  });
  it("disposes after handshake failure without mounting a fallback UI", async () => {
    const f = fixture();
    vi.mocked(f.ports.reportReady).mockRejectedValueOnce(new Error("Mismatch"));
    await expect(f.owner.start()).rejects.toThrow("Mismatch");
    expect(f.ports.disposeData).toHaveBeenCalledOnce();
    expect(f.ports.startUi).not.toHaveBeenCalled();
  });
});
