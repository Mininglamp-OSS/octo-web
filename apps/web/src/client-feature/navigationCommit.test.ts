import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NavigationCommitController,
  hasNavigationCommitBridge,
  isPositiveSafeInteger,
} from "./navigationCommit";

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("NavigationCommitController", () => {
  let report: ReturnType<typeof vi.fn>;
  let controller: NavigationCommitController;

  beforeEach(() => {
    report = vi.fn(async () => {});
    controller = new NavigationCommitController(report);
  });

  it("reports after page commit when no conversation target", async () => {
    controller.start({ navigationId: 42 });
    expect(controller.isPending).toBe(true);
    controller.pageCommitted();
    await flush();
    expect(report).toHaveBeenCalledWith(42);
    expect(controller.isPending).toBe(false);
  });

  it("waits for both page and conversation barriers", async () => {
    controller.start({ navigationId: 42, hasConversation: true });
    controller.pageCommitted();
    await flush();
    expect(report).not.toHaveBeenCalled();
    controller.conversationCommitted();
    await flush();
    expect(report).toHaveBeenCalledWith(42);
  });

  it("reports immediately when page is already committed and no conversation target", async () => {
    controller.start({ navigationId: 42, pageCommitted: true });
    await flush();
    expect(report).toHaveBeenCalledWith(42);
  });

  it("reports immediately when page is already committed and conversation releases", async () => {
    controller.start({ navigationId: 42, pageCommitted: true, hasConversation: true });
    await flush();
    expect(report).not.toHaveBeenCalled();
    controller.conversationCommitted();
    await flush();
    expect(report).toHaveBeenCalledWith(42);
  });

  it("does not report for legacy / no-navigationId commands", async () => {
    controller.start({});
    controller.pageCommitted();
    controller.conversationCommitted();
    await flush();
    expect(report).not.toHaveBeenCalled();
    expect(controller.isPending).toBe(false);
  });

  it("cancels a stale pending commit when superseded", async () => {
    controller.start({ navigationId: 42, hasConversation: false });
    controller.start({ navigationId: 99, hasConversation: false });
    controller.pageCommitted();
    await flush();
    expect(report).not.toHaveBeenCalledWith(42);
    expect(report).toHaveBeenCalledWith(99);
  });

  it("cancels on explicit cancel", async () => {
    controller.start({ navigationId: 42, hasConversation: false });
    controller.cancel();
    controller.pageCommitted();
    await flush();
    expect(report).not.toHaveBeenCalled();
  });

  it("cancels on dispose", async () => {
    controller.start({ navigationId: 42, hasConversation: false });
    controller.dispose();
    controller.pageCommitted();
    await flush();
    expect(report).not.toHaveBeenCalled();
  });

  it("does not report when page barrier never released", async () => {
    controller.start({ navigationId: 42, hasConversation: false });
    controller.conversationCommitted();
    await flush();
    expect(report).not.toHaveBeenCalled();
  });

  it("reports the latest pending id", async () => {
    controller.start({ navigationId: 42, hasConversation: true });
    controller.start({ navigationId: 99, pageCommitted: true });
    await flush();
    expect(report).toHaveBeenCalledWith(99);
    expect(report).not.toHaveBeenCalledWith(42);
  });

  it("isolates report failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    report.mockRejectedValueOnce(new Error("IPC failed"));

    controller.start({ navigationId: 42 });
    controller.pageCommitted();

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "[NavigationCommit] failed to report commit",
        expect.any(Error),
      );
    });
    consoleSpy.mockRestore();
  });

  it("exposes pending state", () => {
    expect(controller.isPending).toBe(false);
    expect(controller.pendingNavigationId).toBeUndefined();
    controller.start({ navigationId: 42 });
    expect(controller.isPending).toBe(true);
    expect(controller.pendingNavigationId).toBe(42);
    controller.pageCommitted();
    expect(controller.isPending).toBe(false);
  });
});

describe("hasNavigationCommitBridge", () => {
  it("returns true when reportNavigationCommitted is a function", () => {
    expect(hasNavigationCommitBridge({ reportNavigationCommitted: async () => {} })).toBe(true);
  });

  it("returns false when missing or not a function", () => {
    expect(hasNavigationCommitBridge({})).toBe(false);
    expect(hasNavigationCommitBridge({ reportNavigationCommitted: "x" as any })).toBe(false);
  });
});

describe("isPositiveSafeInteger", () => {
  it("accepts positive safe integers", () => {
    expect(isPositiveSafeInteger(1)).toBe(true);
    expect(isPositiveSafeInteger(42)).toBe(true);
    expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("rejects non-positive and unsafe values", () => {
    expect(isPositiveSafeInteger(0)).toBe(false);
    expect(isPositiveSafeInteger(-1)).toBe(false);
    expect(isPositiveSafeInteger(1.5)).toBe(false);
    expect(isPositiveSafeInteger(Infinity)).toBe(false);
    expect(isPositiveSafeInteger(NaN)).toBe(false);
  });

  it("rejects non-numbers", () => {
    expect(isPositiveSafeInteger("42" as any)).toBe(false);
    expect(isPositiveSafeInteger(null)).toBe(false);
    expect(isPositiveSafeInteger(undefined)).toBe(false);
  });
});
describe("identity token stale-guard", () => {
  let report: ReturnType<typeof vi.fn>;
  let controller: NavigationCommitController;

  beforeEach(() => {
    report = vi.fn(async () => {});
    controller = new NavigationCommitController(report);
  });

  it("start() returns a monotonically increasing identity token", () => {
    const t1 = controller.start({ navigationId: 10 });
    const t2 = controller.start({ navigationId: 20 });
    const t3 = controller.start({ navigationId: 30 });
    expect(t1).toBeTypeOf("number");
    expect(t2).toBeTypeOf("number");
    expect(t3).toBeTypeOf("number");
    // start() cancels the previous navigation before arming, bumping an
    // internal generation counter, so tokens are distinct and increasing
    // rather than exactly sequential by one.
    expect(t2).toBeGreaterThan(t1!);
    expect(t3).toBeGreaterThan(t2!);
  });

  it("returns undefined for legacy commands without navigationId", () => {
    expect(controller.start({})).toBeUndefined();
    expect(controller.start({ navigationId: -1 })).toBeUndefined();
    expect(controller.start({ navigationId: 0 })).toBeUndefined();
  });

  it("pageCommitted with stale token does not release barrier", async () => {
    controller.start({ navigationId: 10 });
    controller.start({ navigationId: 20 });
    controller.pageCommitted();
    // page barrier released with undefined (latest pending), so ack arrives
    await flush();
    expect(report).toHaveBeenCalledWith(20);

    report.mockClear();
    controller.start({ navigationId: 30 });
    // stale token from navigation 10 should not release
    controller.pageCommitted(1);
    await flush();
    expect(report).not.toHaveBeenCalled();
    // the correct token still works
    controller.pageCommitted(controller.start({ navigationId: 40 }));
    await flush();
    expect(report).toHaveBeenCalledWith(40);
  });

  it("conversationCommitted with stale token does not release barrier", async () => {
    const firstToken = controller.start({ navigationId: 10, hasConversation: true });
    controller.start({ navigationId: 20, hasConversation: true });
    // Release the page barrier first so conversation is the gating one.
    controller.pageCommitted();
    // stale conversation release should not work
    controller.conversationCommitted(firstToken);
    await flush();
    expect(report).not.toHaveBeenCalled();
    // correct latest conversation release works
    controller.conversationCommitted();
    await flush();
    expect(report).toHaveBeenCalledWith(20);
  });

  it("cancel prevents any pending commit even with token match", async () => {
    const token = controller.start({ navigationId: 42 });
    controller.cancel();
    controller.pageCommitted(token);
    controller.conversationCommitted(token);
    await flush();
    expect(report).not.toHaveBeenCalled();
  });

  it("dispose prevents any pending commit", async () => {
    const token = controller.start({ navigationId: 42 });
    controller.dispose();
    controller.pageCommitted(token);
    await flush();
    expect(report).not.toHaveBeenCalled();
  });

  it("does not double-report after supersede + token match", async () => {
    const tokenA = controller.start({ navigationId: 10 });
    controller.pageCommitted(tokenA);
    await flush();
    expect(report).toHaveBeenCalledTimes(1);
    // second release of same barrier does nothing
    controller.pageCommitted(tokenA);
    await flush();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("report catches synchronous throws from preload bridge", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    report.mockImplementationOnce(() => { throw new Error("sync IPC fail"); });
    controller.start({ navigationId: 42 });
    controller.pageCommitted();
    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith("[NavigationCommit] failed to report commit", expect.any(Error));
    });
    consoleSpy.mockRestore();
  });
});
