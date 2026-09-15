import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OctoBuddySummaryBridge } from "./hostBridge";
import { installSummaryExternalRuntime } from "./externalRuntime";

const adapter = vi.hoisted(() => ({
  apply: vi.fn(), dispose: vi.fn(), requestRefresh: undefined as undefined | ((reason: "mutation" | "manual-refresh") => Promise<void>),
}));
vi.mock("@dmwork/summary/runtime", () => ({
  installExternalSummaryAttention: (options: { requestRefresh: typeof adapter.requestRefresh }) => {
    adapter.requestRefresh = options.requestRefresh;
    return adapter;
  },
}));
const scope = { version: 1 as const, contextId: "a", epoch: 1, summaryAttention: "external" as const };
const snapshot = (revision: number, count: number, contextId = "a", epoch = 1, ownerId = "owner") => ({
  version: 1, ownerId, contextId, epoch, revision, phase: "ready",
  badges: { messages: { status: "ready", count: 0 }, summary: { status: "ready", count } },
});
function fixture() {
  let receive!: (value: unknown) => void;
  let finish!: (value: unknown) => void;
  const host = {
    getRuntimeSnapshot: vi.fn(() => new Promise(resolve => { finish = resolve; })),
    onRuntimeSnapshot: vi.fn(callback => { receive = callback; return off; }),
    invalidateSummaryRuntime: vi.fn(async () => {}),
  };
  const off = vi.fn();
  const controller = installSummaryExternalRuntime(host as unknown as OctoBuddySummaryBridge, scope);
  return { controller, host, off, receive: (value: unknown) => receive(value), finish: (value: unknown) => finish(value) };
}
beforeEach(() => vi.clearAllMocks());
describe("summary external runtime bridge", () => {
  it("subscribes before reading and rejects late initial or malformed snapshots", async () => {
    const f = fixture();
    expect(f.host.onRuntimeSnapshot.mock.invocationCallOrder[0]).toBeLessThan(f.host.getRuntimeSnapshot.mock.invocationCallOrder[0]);
    f.receive(snapshot(2, 8));
    f.finish(snapshot(1, 10));
    await Promise.resolve();
    f.receive(snapshot(3, 5, "old"));
    f.receive(snapshot(3, 5, "a", 1, "old-owner"));
    f.receive(snapshot(3, -1));
    expect(adapter.apply.mock.calls).toEqual([[8]]);
    f.controller.dispose();
    f.receive(snapshot(4, 100));
    expect(adapter.apply.mock.calls).toEqual([[8]]);
    expect(f.off).toHaveBeenCalledOnce();
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
  it("changes scope only with a newer explicit host context and clears old count", async () => {
    const f = fixture();
    f.receive(snapshot(5, 10));
    expect(f.controller.acceptSpace(undefined)).toBe(false);
    expect(f.controller.acceptSpace({ ...scope, epoch: 2 })).toBe(false);
    expect(f.controller.acceptSpace({ ...scope, contextId: "b", epoch: 2 })).toBe(true);
    expect(adapter.apply).toHaveBeenLastCalledWith(null);
    f.receive(snapshot(99, 100));
    f.receive(snapshot(1, 4, "b", 2, "next-owner"));
    expect(adapter.apply).toHaveBeenLastCalledWith(4);
    await adapter.requestRefresh?.("mutation");
    expect(f.host.invalidateSummaryRuntime).toHaveBeenLastCalledWith({ ...scope, contextId: "b", epoch: 2, reason: "mutation" });
    f.controller.dispose();
  });
  it("does not start a silent local fallback if IPC is missing", () => {
    expect(() => installSummaryExternalRuntime({} as OctoBuddySummaryBridge, scope)).toThrow("unavailable");
  });
});
