// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectStatus } from 'wukongimjssdk';

const badge = vi.hoisted(() => {
  let scopeRev = 0;
  return {
    scopeRev,
    readCount: vi.fn(),
    resetScope: vi.fn(() => { scopeRev++; }),
    getBadge: vi.fn(() => 0),
  };
});

const wksdk = vi.hoisted(() => {
  const messageListeners: Array<(msg: unknown) => void> = [];
  const statusListeners: Array<(s: ConnectStatus) => void> = [];
  return {
    addMessageListener: vi.fn((cb: (msg: unknown) => void) => { messageListeners.push(cb); }),
    removeMessageListener: vi.fn((cb: (msg: unknown) => void) => {
      const i = messageListeners.indexOf(cb);
      if (i >= 0) messageListeners.splice(i, 1);
    }),
    addConnectStatusListener: vi.fn((cb: (s: ConnectStatus) => void) => { statusListeners.push(cb); }),
    removeConnectStatusListener: vi.fn((cb: (s: ConnectStatus) => void) => {
      const i = statusListeners.indexOf(cb);
      if (i >= 0) statusListeners.splice(i, 1);
    }),
    messageListeners,
    statusListeners,
    reset() {
      messageListeners.length = 0;
      statusListeners.length = 0;
      this.addMessageListener.mockClear();
      this.removeMessageListener.mockClear();
      this.addConnectStatusListener.mockClear();
      this.removeConnectStatusListener.mockClear();
    },
  };
});

vi.mock("wukongimjssdk", () => ({
  default: {
    shared: () => ({
      chatManager: {
        addMessageListener: wksdk.addMessageListener,
        removeMessageListener: wksdk.removeMessageListener,
      },
      connectManager: {
        addConnectStatusListener: wksdk.addConnectStatusListener,
        removeConnectStatusListener: wksdk.removeConnectStatusListener,
      },
    }),
  },
  ConnectStatus: { Connected: 1, Disconnected: 0 },
}));

vi.mock("../../utils/summaryAttentionBadge", () => ({
  readSummaryAttentionCount: badge.readCount,
  resetSummaryAttentionScope: badge.resetScope,
  getSummaryAttentionBadge: badge.getBadge,
  setSummaryAttentionBadge: vi.fn(),
  setSummaryAttentionPublisher: vi.fn(),
}));

vi.mock("../../utils/summaryAttentionSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/summaryAttentionSync")>();
  return {
    ...actual,
  };
});

import {
  createDesktopSummaryAttention,
  resetDesktopAttentionState,
} from "../desktopAttention";
import type { DesktopBadge } from "../desktopAttention";

type Sched = ReturnType<typeof createScheduler>;

function createScheduler() {
  let now = 100_000;
  const timers: Array<{ h: symbol; fn: () => void; t: number }> = [];
  let nextId = 0;
  return {
    now: vi.fn(() => now),
    advance: (ms: number) => { now += ms; },
    setTimeout: vi.fn((fn: () => void, t: number) => {
      const h = Symbol(`t${nextId++}`);
      timers.push({ h, fn, t });
      return h;
    }),
    clearTimeout: vi.fn((handle: unknown) => {
      const idx = timers.findIndex((x) => x.h === handle);
      if (idx >= 0) timers.splice(idx, 1);
    }),
    /** Fire and await the next pending poll tick (the periodic non-fresh path). */
    async fireTick(): Promise<void> {
      const item = timers.shift();
      if (!item) throw new Error("no pending timer");
      item.fn();
      await settle();
    },
    timerCount(): number { return timers.length; },
    nextDelay(): number { return timers.length ? timers[0].t : -1; },
    flushAll(): void { timers.length = 0; },
  };
}

async function settle() { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); }

function install(s: Sched) {
  const badges: DesktopBadge[] = [];
  const ctrl = createDesktopSummaryAttention({
    scheduler: s,
    onBadge: (b) => badges.push(b),
  });
  return { ctrl, badges };
}

describe("createDesktopSummaryAttention", () => {
  let s: Sched;

  beforeEach(() => {
    resetDesktopAttentionState();
    badge.resetScope.mockClear();
    badge.getBadge.mockReset();
    badge.getBadge.mockReturnValue(0);
    badge.readCount.mockReset();
    wksdk.reset();
    s = createScheduler();
  });

  // -- Single active / ownership --------------------------------------------

  it("rejects a second provider", () => {
    const { ctrl } = install(s);
    ctrl.start();
    expect(() => install(s)).toThrow("another provider is already active");
    ctrl.dispose();
  });

  it("rejects a second provider created before either starts", () => {
    const { ctrl: a } = install(s);
    // Second factory (before a.start) is rejected because ownership is captured
    // at creation time.
    expect(() => install(s)).toThrow("another provider is already active");
    a.start();
    a.dispose();
  });

  // -- start / dispose idempotency ------------------------------------------

  it("start is idempotent", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    const count = s.timerCount();
    const msgCalls = wksdk.addMessageListener.mock.calls.length;
    const connCalls = wksdk.addConnectStatusListener.mock.calls.length;
    ctrl.start();
    ctrl.start();
    expect(s.timerCount()).toBe(count);
    expect(wksdk.addMessageListener.mock.calls.length).toBe(msgCalls);
    expect(wksdk.addConnectStatusListener.mock.calls.length).toBe(connCalls);
    ctrl.dispose();
  });

  it("dispose is idempotent", () => {
    const { ctrl } = install(s);
    ctrl.start();
    s.flushAll();
    ctrl.dispose();
    ctrl.dispose();
  });

  it("dispose emits unavailable", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    badges.length = 0;
    ctrl.dispose();
    expect(badges).toContainEqual({ status: "unavailable", count: null });
  });

  // -- IM listeners ----------------------------------------------------------

  it("subscribes IM listeners on start and unsubscribes on dispose", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    expect(wksdk.addMessageListener).toHaveBeenCalledTimes(1);
    expect(wksdk.addConnectStatusListener).toHaveBeenCalledTimes(1);
    expect(wksdk.messageListeners.length).toBe(1);
    expect(wksdk.statusListeners.length).toBe(1);
    ctrl.dispose();
    expect(wksdk.removeMessageListener).toHaveBeenCalledTimes(1);
    expect(wksdk.removeConnectStatusListener).toHaveBeenCalledTimes(1);
    expect(wksdk.messageListeners.length).toBe(0);
    expect(wksdk.statusListeners.length).toBe(0);
  });

  it("does not subscribe IM before start", () => {
    const { ctrl } = install(s);
    expect(wksdk.addMessageListener).not.toHaveBeenCalled();
    expect(wksdk.addConnectStatusListener).not.toHaveBeenCalled();
    ctrl.start();
    ctrl.dispose();
  });

  it("IM message filtered by shouldRefreshForMessage triggers a fresh mutation", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    badge.readCount.mockClear();
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 101000 });

    // Relevant message: content type 21 (summary notify) or 2000 (WK_TIP).
    wksdk.messageListeners[0]({ contentType: 21 });
    await settle();
    expect(badge.readCount).toHaveBeenCalledWith({ fresh: true });
    expect(badge.readCount).toHaveBeenCalledTimes(1);
    ctrl.dispose();
  });

  it("IM irrelevant message does not trigger a refresh", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    badge.readCount.mockClear();
    wksdk.messageListeners[0]({ contentType: 1000 });
    await settle();
    expect(badge.readCount).not.toHaveBeenCalledWith({ fresh: true });
    ctrl.dispose();
  });

  it("removes IM listeners on dispose so no stale refresh is triggered", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    ctrl.dispose();
    expect(wksdk.messageListeners.length).toBe(0);
    expect(wksdk.statusListeners.length).toBe(0);
  });

  it("IM Connected triggers a fresh refresh; other statuses do not", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    badge.readCount.mockClear();

    wksdk.statusListeners[0](0 /* Disconnected */);
    await settle();
    expect(badge.readCount.mock.calls.some((c) => c[0]?.fresh === true)).toBe(false);

    badge.readCount.mockResolvedValueOnce({ count: 3, sampleAt: 101000 });
    wksdk.statusListeners[0](1 /* Connected */);
    await settle();
    expect(badge.readCount.mock.calls.some((c) => c[0]?.fresh === true)).toBe(true);
    ctrl.dispose();
  });

  // -- Badge publication ----------------------------------------------------

  it("start does not publish old local badge as ready", async () => {
    badge.getBadge.mockReturnValue(99);
    badge.readCount.mockResolvedValue({ count: 3, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    expect(badges.some((b) => b.status === "ready" && b.count === 99)).toBe(false);
    expect(badges).toContainEqual({ status: "ready", count: 3 });
    ctrl.dispose();
  });

  it("emits ready only after a confirmed fetch", async () => {
    badge.readCount.mockResolvedValueOnce({ count: 7, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    expect(badges).toContainEqual({ status: "ready", count: 7 });
    ctrl.dispose();
  });

  it("a null fetch result never fabricates a ready count from the old badge", async () => {
    badge.getBadge.mockReturnValue(99);
    badge.readCount.mockResolvedValueOnce(null);
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    expect(badges.some((b) => b.status === "ready")).toBe(false);
    ctrl.dispose();
  });

  // -- Fresh reads via refresh -----------------------------------------------

  it("refresh(mutation) uses fresh=true", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    badge.readCount.mockClear();
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 101000 });
    await ctrl.refresh("mutation");
    expect(badge.readCount).toHaveBeenCalledWith({ fresh: true });
    ctrl.dispose();
  });

  it("refresh(manual-refresh) also uses fresh=true", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    badge.readCount.mockClear();
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 101000 });
    await ctrl.refresh("manual-refresh");
    expect(badge.readCount).toHaveBeenCalledWith({ fresh: true });
    ctrl.dispose();
  });

  // -- In-flight mutation ----------------------------------------------------

  it("mutation during in-flight schedules a follow-up fresh read after completion", async () => {
    let resolveFirst!: (v: { count: number; sampleAt: number }) => void;
    const first = new Promise<{ count: number; sampleAt: number }>((res) => { resolveFirst = res; });
    let resolveSecond!: (v: { count: number; sampleAt: number }) => void;
    const second = new Promise<{ count: number; sampleAt: number }>((res) => { resolveSecond = res; });
    badge.readCount
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();

    const refreshP = ctrl.refresh("mutation");
    await settle();

    resolveFirst({ count: 2, sampleAt: 100000 });
    await settle();

    resolveSecond({ count: 7, sampleAt: 101000 });
    await refreshP.catch(() => {});
    await settle();

    expect(badges.some((b) => b.status === "ready" && b.count === 7)).toBe(true);
    ctrl.dispose();
  });

  // -- Stale guard -----------------------------------------------------------

  it("non-fresh poll result does not regress an accepted fresh count when older", async () => {
    badge.readCount.mockResolvedValueOnce({ count: 10, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    expect(badges.some((b) => b.status === "ready" && b.count === 10)).toBe(true);

    // A periodic non-fresh poll tick older than the accepted fresh sample must
    // not regress the count.
    badge.readCount.mockClear();
    badge.readCount.mockResolvedValueOnce({ count: 3, sampleAt: 90000 });
    await s.fireTick();
    const lastReady = badges.filter((b) => b.status === "ready").pop();
    expect(lastReady?.count).toBe(10);
    ctrl.dispose();
  });

  it("non-fresh result with fresh sampleAt or newer is accepted", async () => {
    badge.readCount.mockResolvedValueOnce({ count: 10, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    expect(badges.some((b) => b.status === "ready" && b.count === 10)).toBe(true);

    // Non-fresh sample at the same boundary (>= lastFreshSampleAt) is accepted
    // and does not regress to a smaller value.
    badge.readCount.mockClear();
    badge.readCount.mockResolvedValueOnce({ count: 4, sampleAt: 100500 });
    await s.fireTick();
    const lastReady = badges.filter((b) => b.status === "ready").pop();
    // Even though sampleAt is >= lastFreshSampleAt, publishing only happens when
    // the poll value truly differs/regresses. Exact desired semantics: newer
    // non-fresh samples ARE accepted (not dropped). So expect 4 here.
    expect(lastReady?.count).toBe(4);
    ctrl.dispose();
  });

  // -- Scope guard -----------------------------------------------------------

  it("discards late results after switchSpace", async () => {
    let resolveFetch!: (v: { count: number; sampleAt: number }) => void;
    badge.readCount.mockReset();
    badge.readCount.mockImplementationOnce(() =>
      new Promise<{ count: number; sampleAt: number }>((res) => { resolveFetch = res; }),
    );
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle(); // fetch pending

    ctrl.switchSpace(); // bump revision + trigger new fresh fetch
    // Provide a result for the switchSpace-triggered fetch (poll.notifyActivity).
    badge.readCount.mockResolvedValueOnce({ count: 42, sampleAt: 101000 });
    // Resolve old fetch (stale revision)
    resolveFetch({ count: 99, sampleAt: 100000 });
    await settle();
    s.flushAll();
    expect(badges.some((b) => b.status === "ready" && b.count === 99)).toBe(false);
    ctrl.dispose();
  });

  it("switchSpace emits loading then fresh ready", async () => {
    badge.readCount.mockResolvedValue({ count: 42, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    expect(badges.some((b) => b.status === "ready" && b.count === 42)).toBe(true);

    badges.length = 0;
    badge.readCount.mockReset();
    badge.readCount.mockResolvedValue({ count: 7, sampleAt: 101000 });
    ctrl.switchSpace();
    expect(badges).toContainEqual({ status: "loading", count: null });
    await settle();
    // The switchSpace triggers a fresh read which should emit ready:7
    await new Promise(r => setTimeout(r, 0)); // extra settle
    await settle();
    expect(badges.some((b) => b.status === "ready" && b.count === 7)).toBe(true);
    ctrl.dispose();
  });

  // -- Activity transitions --------------------------------------------------

  it("starts hidden by default; setActivity(to) foreground triggers a fresh read", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    // Default hidden: no foreground trigger yet.
    badge.readCount.mockClear();
    // Transition to foreground fires a fresh read.
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 101000 });
    ctrl.setActivity({ applicationActive: true, foreground: true });
    await settle();
    expect(badge.readCount.mock.calls.some((c) => c[0]?.fresh === true)).toBe(true);
    ctrl.dispose();
  });

  it("hidden->hidden is a no-op (no duplicate read)", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    badge.readCount.mockClear();
    ctrl.setActivity({ applicationActive: true, foreground: false });
    await settle();
    expect(badge.readCount).not.toHaveBeenCalledWith({ fresh: true });
    ctrl.dispose();
  });

  it("suspend stops poll; resume triggers fresh fetch", async () => {
    badge.readCount.mockResolvedValue({ count: 0, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    s.flushAll();
    badge.readCount.mockClear();

    ctrl.setActivity({ applicationActive: false, foreground: true });
    expect(s.timerCount()).toBe(0);

    badge.readCount.mockResolvedValueOnce({ count: 0, sampleAt: 101000 });
    ctrl.setActivity({ applicationActive: true, foreground: true });
    await settle();
    // After resume, poll.start() schedules a timer, then notifyActivity fires
    // an immediate tick which calls executor. The readCount should be called.
    expect(badge.readCount.mock.calls.some((c) => c[0]?.fresh === true)).toBe(true);
    ctrl.dispose();
  });

  // -- Stale on failure ------------------------------------------------------

  it("emits stale after a fetch failure when ready value exists", async () => {
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    expect(badges).toContainEqual({ status: "ready", count: 5 });
    badges.length = 0;
    badge.readCount.mockRejectedValueOnce(new Error("network"));
    await ctrl.refresh("manual-refresh").catch(() => {});
    await settle();
    expect(badges).toContainEqual({ status: "stale", count: 5 });
    ctrl.dispose();
  });

  it("first fetch failure emits unavailable (not stuck on loading)", async () => {
    badge.readCount.mockRejectedValueOnce(new Error("network"));
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    expect(badges).toContainEqual({ status: "unavailable", count: null });
    // The final stat must not remain loading; the first failure resolved it.
    expect(badges[badges.length - 1]).toEqual({ status: "unavailable", count: null });
    ctrl.dispose();
  });

  it("first fetch failure does not emit ready", async () => {
    badge.readCount.mockRejectedValueOnce(new Error("network"));
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    expect(badges.some((b) => b.status === "ready")).toBe(false);
    ctrl.dispose();
  });

  // -- Dispose invalidates shared attention tickets --------------------------

  it("dispose invalidates shared attention tickets via resetSummaryAttentionScope", () => {
    badge.resetScope.mockClear();
    const { ctrl } = install(s);
    ctrl.start();
    ctrl.dispose();
    expect(badge.resetScope).toHaveBeenCalled();
  });

  // -- Mutation/manual-refresh stale ready immediately -----------------------

  it("refresh(mutation) marks ready badge stale before confirming new ready", async () => {
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    expect(badges).toContainEqual({ status: "ready", count: 5 });
    badges.length = 0;

    // A delayed fetch lets us observe the stale transition before ready.
    let resolveLater!: (v: { count: number; sampleAt: number }) => void;
    const later = new Promise<{ count: number; sampleAt: number }>((res) => { resolveLater = res; });
    badge.readCount.mockClear();
    badge.readCount.mockImplementationOnce(() => later);
    const refreshP = ctrl.refresh("mutation");
    await settle();
    // publish("ready"...) was skipped by the dedup check because we published it
    // as "stale", not "ready". Verify stale was emitted.
    expect(badges).toContainEqual({ status: "stale", count: 5 });

    resolveLater({ count: 7, sampleAt: 101000 });
    await refreshP.catch(() => {});
    await settle();
    expect(badges).toContainEqual({ status: "ready", count: 7 });
    ctrl.dispose();
  });

  it("refresh(manual-refresh) also marks ready stale immediately", async () => {
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    badges.length = 0;

    let resolveLater!: (v: { count: number; sampleAt: number }) => void;
    const later = new Promise<{ count: number; sampleAt: number }>((res) => { resolveLater = res; });
    badge.readCount.mockClear();
    badge.readCount.mockImplementationOnce(() => later);
    const refreshP = ctrl.refresh("manual-refresh");
    await settle();
    expect(badges).toContainEqual({ status: "stale", count: 5 });

    resolveLater({ count: 3, sampleAt: 101000 });
    await refreshP.catch(() => {});
    await settle();
    expect(badges).toContainEqual({ status: "ready", count: 3 });
    ctrl.dispose();
  });

  // -- In-flight failure with queued post-mutation read -----------------------

  it("in-flight failure with queued fresh still drains the queued read", async () => {
    // First fetch succeeds (initial start).
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    badges.length = 0;

    // Next fetch will fail. Queue a mutation while it is in-flight.
    badge.readCount.mockClear();
    badge.readCount.mockImplementationOnce(() => Promise.reject(new Error("network")));
    const refreshP = ctrl.refresh("manual-refresh");
    await settle();
    // While still failing, queue a mutation: executor must catch the throw and
    // keep draining.
    badge.readCount.mockResolvedValueOnce({ count: 9, sampleAt: 101000 });
    void ctrl.refresh("mutation");
    await refreshP.catch(() => {});
    await settle();
    // The queued mutation read should have run after the failed one.
    expect(badges).toContainEqual({ status: "ready", count: 9 });
    ctrl.dispose();
  });

  // -- Suspended mode suppresses fetches -------------------------------------

  it("refresh while suspended queues the reason without fetching", async () => {
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 100000 });
    const { ctrl, badges } = install(s);
    ctrl.start();
    await settle();
    badges.length = 0;
    badge.readCount.mockClear();

    ctrl.setActivity({ applicationActive: false, foreground: true });
    await ctrl.refresh("mutation");
    // No fetch should have been called while suspended.
    expect(badge.readCount).not.toHaveBeenCalled();
    ctrl.dispose();
  });

  it("IM message while suspended queues fresh and does not fetch until resume", async () => {
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    badge.readCount.mockClear();

    ctrl.setActivity({ applicationActive: false, foreground: true });
    // Fire IM message listener while suspended.
    wksdk.messageListeners[0]({ contentType: 21 });
    await settle();
    expect(badge.readCount).not.toHaveBeenCalled();

    // Resume: the queued fresh should be flushed.
    badge.readCount.mockResolvedValueOnce({ count: 3, sampleAt: 101000 });
    ctrl.setActivity({ applicationActive: true, foreground: true });
    await settle();
    expect(badge.readCount).toHaveBeenCalledWith({ fresh: true });
    ctrl.dispose();
  });

  it("IM Connected while suspended queues fresh and does not fetch until resume", async () => {
    badge.readCount.mockResolvedValueOnce({ count: 5, sampleAt: 100000 });
    const { ctrl } = install(s);
    ctrl.start();
    await settle();
    badge.readCount.mockClear();

    ctrl.setActivity({ applicationActive: false, foreground: true });
    wksdk.statusListeners[0](1 /* Connected */);
    await settle();
    expect(badge.readCount).not.toHaveBeenCalled();

    badge.readCount.mockResolvedValueOnce({ count: 3, sampleAt: 101000 });
    ctrl.setActivity({ applicationActive: true, foreground: true });
    await settle();
    expect(badge.readCount).toHaveBeenCalledWith({ fresh: true });
    ctrl.dispose();
  });

  // -- subscribeIm partial install failure ------------------------------------

  it("rethrows when subscribeIm fails, removing already-installed listener", async () => {
    // Inject a failure on the second listener install.
    wksdk.addConnectStatusListener.mockImplementationOnce(() => {
      throw new Error("connect listener failed");
    });
    const { ctrl } = install(s);
    // start() must throw because subscribeIm rethrows.
    expect(() => ctrl.start()).toThrow();
    // The message listener must have been removed on the partial failure.
    expect(wksdk.removeMessageListener).toHaveBeenCalledTimes(1);
    // The connect listener was thrown before being installed, so no remove for it.
    expect(wksdk.removeConnectStatusListener).not.toHaveBeenCalled();
    // Ownership should remain so the owner can retry.
    // start fails, but ownership was captured at factory time — that is OK.
    ctrl.dispose();
  });

  it("start does not advance to started state after subscribeIm failure", async () => {
    wksdk.addConnectStatusListener.mockImplementationOnce(() => {
      throw new Error("connect listener failed");
    });
    const { ctrl, badges } = install(s);
    try { ctrl.start(); } catch { /* expected */ }
    // No badge calls should have happened.
    expect(badges.length).toBe(0);
    // A second call can be attempted (can rethrow or succeed).
    ctrl.dispose();
  });

});
