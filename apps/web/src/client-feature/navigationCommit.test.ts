import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NavigationCommitController,
  hasNavigationCommitBridge,
  isPositiveSafeInteger,
} from "./navigationCommit";

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe("NavigationCommitController", () => {
  let report: ReturnType<typeof vi.fn>;
  let controller: NavigationCommitController;

  beforeEach(() => {
    vi.useFakeTimers();
    report = vi.fn(async () => {});
    controller = new NavigationCommitController(report);
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports after the page commits when there is no conversation target", async () => {
    const token = controller.start({ navigationId: 42 })!;
    expect(controller.isPending).toBe(true);
    controller.pageCommitted(token);
    await flush();
    expect(report).toHaveBeenCalledExactlyOnceWith(42);
    expect(controller.isPending).toBe(false);
  });

  it.each(["page", "conversation"])("waits for both barriers, releasing %s first", async (first) => {
    const token = controller.start({ navigationId: 42, hasConversation: true })!;
    controller[first === "page" ? "pageCommitted" : "conversationCommitted"](token);
    await flush();
    expect(report).not.toHaveBeenCalled();
    controller[first === "page" ? "conversationCommitted" : "pageCommitted"](token);
    await flush();
    expect(report).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("accepts an already committed page", async () => {
    controller.start({ navigationId: 42, pageCommitted: true });
    await flush();
    expect(report).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("still waits for the conversation when the page is already committed", async () => {
    const token = controller.start({ navigationId: 42, pageCommitted: true, hasConversation: true })!;
    await flush();
    expect(report).not.toHaveBeenCalled();
    controller.conversationCommitted(token);
    await flush();
    expect(report).toHaveBeenCalledExactlyOnceWith(42);
  });

  it.each([undefined, 0, -1, 1.5, NaN])("does not arm invalid or legacy id %s", async (navigationId) => {
    expect(controller.start({ navigationId })).toBeUndefined();
    controller.pageCommitted(1);
    controller.conversationCommitted(1);
    await flush();
    expect(report).not.toHaveBeenCalled();
    expect(controller.isPending).toBe(false);
  });

  it("returns distinct increasing tokens across cancellation and A-B-A navigation", () => {
    const a = controller.start({ navigationId: 10 })!;
    controller.cancel();
    const b = controller.start({ navigationId: 20 })!;
    const nextA = controller.start({ navigationId: 10 })!;
    expect(b).toBeGreaterThan(a);
    expect(nextA).toBeGreaterThan(b);
  });

  it.each(["pageCommitted", "conversationCommitted"] as const)(
    "%s rejects stale and missing tokens", async (release) => {
      const stale = controller.start({ navigationId: 10, hasConversation: true })!;
      const token = controller.start({ navigationId: 20, hasConversation: true })!;
      controller[release === "pageCommitted" ? "conversationCommitted" : "pageCommitted"](token);
      controller[release](stale);
      controller[release](undefined as unknown as number);
      await flush();
      expect(report).not.toHaveBeenCalled();
      controller[release](token);
      await flush();
      expect(report).toHaveBeenCalledExactlyOnceWith(20);
    },
  );

  it.each(["cancel", "dispose"] as const)("%s rejects even matching tokens", async (cancel) => {
    const token = controller.start({ navigationId: 42 })!;
    controller[cancel]();
    controller.pageCommitted(token);
    await flush();
    expect(report).not.toHaveBeenCalled();
  });

  it.each(["cancel", "supersede"])("suppresses a fully committed ack before its send microtask on %s", async (action) => {
    const token = controller.start({ navigationId: 42 })!;
    controller.pageCommitted(token);
    if (action === "cancel") controller.cancel();
    else controller.start({ navigationId: 99, pageCommitted: true });
    await flush();
    expect(report).not.toHaveBeenCalledWith(42);
    expect(report).toHaveBeenCalledTimes(action === "cancel" ? 0 : 1);
  });

  it("does not double-report duplicate barrier releases", async () => {
    const token = controller.start({ navigationId: 42 })!;
    controller.pageCommitted(token);
    controller.pageCommitted(token);
    await flush();
    controller.pageCommitted(token);
    await flush();
    expect(report).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("exposes DOM pending state independently of async delivery", async () => {
    expect(controller.pendingNavigationId).toBeUndefined();
    const token = controller.start({ navigationId: 42 })!;
    expect(controller.pendingNavigationId).toBe(42);
    controller.pageCommitted(token);
    expect(controller.isPending).toBe(false);
    expect(report).not.toHaveBeenCalled();
    await flush();
    expect(report).toHaveBeenCalledWith(42);
  });

  it.each(["reject", "throw"])("retries a transient %s without re-running navigation", async (failure) => {
    if (failure === "reject") report.mockRejectedValueOnce(new Error("IPC failed"));
    else report.mockImplementationOnce(() => { throw new Error("IPC failed"); });
    controller.start({ navigationId: 42, pageCommitted: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(report.mock.calls).toEqual([[42], [42]]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(report).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds permanently rejected sends and reports exhaustion", async () => {
    const error = new Error("IPC failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    report.mockRejectedValue(error);
    controller.start({ navigationId: 42, pageCommitted: true });
    await vi.advanceTimersByTimeAsync(2500);
    expect(report).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledExactlyOnceWith("[NavigationCommit] failed to report commit", error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exhausts hung sends before the host's five-second reveal deadline", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    report.mockImplementation(() => new Promise<void>(() => {}));
    controller.start({ navigationId: 42, pageCommitted: true });
    await vi.advanceTimersByTimeAsync(2500);
    expect(report).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["cancel", "dispose", "supersede"])("cancels delayed retries on %s", async (action) => {
    report.mockRejectedValueOnce(new Error("IPC failed"));
    controller.start({ navigationId: 42, pageCommitted: true });
    await flush();
    if (action === "supersede") controller.start({ navigationId: 99, pageCommitted: true });
    else controller[action as "cancel" | "dispose"]();
    await vi.advanceTimersByTimeAsync(3000);
    expect(report.mock.calls.filter(([id]) => id === 42)).toHaveLength(1);
    if (action === "supersede") expect(report).toHaveBeenLastCalledWith(99);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late failure from a superseded in-flight send", async () => {
    let reject!: (error: Error) => void;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    report.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
    controller.start({ navigationId: 42, pageCommitted: true });
    await flush();
    controller.start({ navigationId: 99, pageCommitted: true });
    reject(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(report.mock.calls).toEqual([[42], [99]]);
    expect(log).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("navigation commit capability and input validation", () => {
  it("advertises only a callable report method", () => {
    expect(hasNavigationCommitBridge({ reportNavigationCommitted: async () => {} })).toBe(true);
    expect(hasNavigationCommitBridge({})).toBe(false);
    expect(hasNavigationCommitBridge({ reportNavigationCommitted: "x" as any })).toBe(false);
  });

  it("accepts only positive safe integers", () => {
    for (const value of [1, 42, Number.MAX_SAFE_INTEGER]) expect(isPositiveSafeInteger(value)).toBe(true);
    for (const value of [undefined, null, "42", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isPositiveSafeInteger(value)).toBe(false);
    }
  });
});
