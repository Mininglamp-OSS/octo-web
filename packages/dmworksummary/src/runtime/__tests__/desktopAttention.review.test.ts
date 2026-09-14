import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDesktopSummaryAttention, type DesktopBadge } from "../desktopAttention";

const mocks = vi.hoisted(() => ({ read: vi.fn(), reset: vi.fn() }));
vi.mock("../../utils/summaryAttentionBadge", () => ({
  readSummaryAttentionCount: mocks.read,
  resetSummaryAttentionScope: mocks.reset,
}));
vi.mock("../../utils/summaryAttentionSync", () => ({ shouldRefreshForMessage: () => true }));
vi.mock("wukongimjssdk", () => ({
  default: { shared: () => ({
    chatManager: { addMessageListener() {}, removeMessageListener() {} },
    connectManager: { addConnectStatusListener() {}, removeConnectStatusListener() {} },
  }) },
  ConnectStatus: { Connected: 1 },
}));

let dispose: (() => void) | undefined;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: (value: { count: number; sampleAt: number }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ count: number; sampleAt: number }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const timers = new Map<symbol, { callback: () => void; delay: number }>();
  const badges: DesktopBadge[] = [];
  const controller = createDesktopSummaryAttention({
    scheduler: {
      now: () => 100_000,
      setTimeout: (callback, delay) => { const id = Symbol(); timers.set(id, { callback, delay }); return id; },
      clearTimeout: id => { timers.delete(id as symbol); },
    },
    onBadge: badge => badges.push(badge),
  });
  dispose = controller.dispose;
  return {
    controller, badges, timers,
    tick() {
      const next = timers.entries().next().value;
      if (!next) throw new Error("Expected a scheduled poll");
      timers.delete(next[0]);
      next[1].callback();
    },
  };
}
beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue({ count: 8, sampleAt: 100_000 });
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => { dispose?.(); dispose = undefined; vi.restoreAllMocks(); });

for (const fresh of [false, true]) {
  it(`superseded ${fresh ? "fresh" : "poll"} result cannot restore ready before the queued mutation finishes`, async () => {
    const { controller, badges, tick } = fixture();
    controller.start();
    await settle();
    const old = deferred(), next = deferred();
    mocks.read.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => next.promise);
    if (fresh) void controller.refresh();
    else tick();
    void controller.refresh("mutation");
    expect(badges.at(-1)).toEqual({ status: "stale", count: 8 });
    old.resolve({ count: 99, sampleAt: 200_000 });
    await settle();
    expect(badges.at(-1)).toEqual({ status: "stale", count: 8 });
    expect(badges.some(badge => badge.count === 99)).toBe(false);
    next.resolve({ count: 4, sampleAt: 200_001 });
    await settle();
    expect(badges.at(-1)).toEqual({ status: "ready", count: 4 });
  });
}

for (const failed of [false, true]) {
  it(`suspend keeps a queued refresh pending when the in-flight read ${failed ? "fails" : "succeeds"}`, async () => {
    const { controller, tick, timers } = fixture();
    controller.start();
    await settle();
    const old = deferred();
    mocks.read.mockImplementationOnce(() => old.promise);
    tick();
    void controller.refresh("mutation");
    controller.setActivity({ applicationActive: false, foreground: false });
    const before = mocks.read.mock.calls.length;
    if (failed) old.reject(new Error("offline"));
    else old.resolve({ count: 10, sampleAt: 100_001 });
    await settle();
    expect(mocks.read).toHaveBeenCalledTimes(before);
    expect(timers.size).toBe(0);
    controller.setActivity({ applicationActive: true, foreground: false });
    await settle();
    expect(mocks.read).toHaveBeenCalledTimes(before + 1);
    expect(mocks.read).toHaveBeenLastCalledWith({ fresh: true });
    expect(timers.size).toBe(1);
  });
}

it("hidden failures back off from 60 seconds to the 300 second ceiling", async () => {
  const { controller, tick, timers, badges } = fixture();
  controller.start();
  await settle();
  mocks.read.mockRejectedValue(new Error("offline"));
  for (const delay of [120_000, 240_000, 300_000, 300_000]) {
    tick();
    await settle();
    expect([...timers.values()].map(timer => timer.delay)).toEqual([delay]);
    expect(badges.at(-1)).toEqual({ status: "stale", count: 8 });
  }
});
