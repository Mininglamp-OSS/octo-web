import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the transport, NOT the facade: the whole point of this suite is that the
// facade (`skillApi`) is what attaches review invalidation to every mutation,
// so `vi.mock("./skillApi")` would delete the behaviour under test.
vi.mock("./skillApiReal");
vi.mock("./skillApiMock");

const listener = vi.fn();
let unsubscribe: (() => void) | undefined;

beforeEach(async () => {
  vi.resetModules();
  listener.mockClear();
  const { subscribeReviewsChanged } = await import("./reviewSignal");
  unsubscribe = subscribeReviewsChanged(listener);
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  vi.clearAllMocks();
});

describe("review invalidation on the skillApi facade", () => {
  /**
   * The 组织发布管理 sidebar badge is a separate read from the 待审核 list, so
   * every endpoint that can move the Space's pending count MUST announce it.
   * Adding a decision endpoint without adding it here reintroduces the stale
   * badge, which is why the list is enumerated rather than spot-checked.
   */
  const mutations: Array<[string, (api: Record<string, any>) => Promise<unknown>]> = [
    ["approveReview", (api) => api.approveReview("rev-1")],
    ["rejectReview", (api) => api.rejectReview("rev-1", "no")],
    ["cancelReview", (api) => api.cancelReview("rev-1")],
    ["createReviewRequest", (api) => api.createReviewRequest({ pluginId: "p-1", version: "1.0.0", changelog: "x" })],
    ["publishPlugin", (api) => api.publishPlugin({ pluginId: "p-1" })],
    ["delistPlugin", (api) => api.delistPlugin({ pluginId: "p-1" })],
    ["deleteSkill", (api) => api.deleteSkill("p-1")],
  ];

  it.each(mutations)("notifies subscribers after %s resolves", async (_name, call) => {
    const api = (await import("./skillApi")) as unknown as Record<string, any>;

    await call(api);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each(mutations)("notifies subscribers even when %s is refused", async (_name, call) => {
    const real = (await import("./skillApiReal")) as unknown as Record<string, any>;
    const api = (await import("./skillApi")) as unknown as Record<string, any>;
    // A 409 from a decision endpoint means our copy of the queue is already
    // stale (someone else decided first), so the badge must re-read on failure
    // too — that is the case where it is most likely to be wrong.
    const name = _name as string;
    real[name].mockRejectedValueOnce(new Error("conflict"));

    await expect(call(api)).rejects.toThrow("conflict");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify on reads", async () => {
    const api = (await import("./skillApi")) as unknown as Record<string, any>;

    await api.listReviewRequests("space", {});
    await api.getReviewRequest("rev-1");
    await api.getMySkills();

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps notifying the remaining subscribers when one throws", async () => {
    const { subscribeReviewsChanged } = await import("./reviewSignal");
    const boom = vi.fn(() => {
      throw new Error("subscriber blew up");
    });
    const after = vi.fn();
    const stopBoom = subscribeReviewsChanged(boom);
    const stopAfter = subscribeReviewsChanged(after);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const api = (await import("./skillApi")) as unknown as Record<string, any>;
    await api.approveReview("rev-1");

    expect(boom).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
    stopBoom();
    stopAfter();
  });

  it("stops notifying after unsubscribe", async () => {
    const api = (await import("./skillApi")) as unknown as Record<string, any>;

    unsubscribe?.();
    unsubscribe = undefined;
    await api.approveReview("rev-1");

    expect(listener).not.toHaveBeenCalled();
  });
});
