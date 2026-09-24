import { describe, expect, it, vi } from "vitest";
import { SpaceUnreadStore } from "./store";

describe("SpaceUnreadStore", () => {
  it("keeps total and new counts separate, then clears only new counts", () => {
    const store = new SpaceUnreadStore();
    store.replaceTotals({ a: 27 });
    store.recordIncoming("a", "m1");
    store.recordIncoming("a", "m2");
    store.recordIncoming("a", "m3");

    expect(store.getSnapshot().totalBySpace.a).toBe(30);
    expect(store.getSnapshot().newBySpace.a).toBe(3);

    store.clearNewUnreads();
    expect(store.getSnapshot().totalBySpace.a).toBe(30);
    expect(store.getSnapshot().newBySpace.a).toBeUndefined();
  });

  it("deduplicates recent message ids with a fixed-capacity set", () => {
    const store = new SpaceUnreadStore(2);
    expect(store.recordIncoming("a", "m1")).toBe(true);
    expect(store.recordIncoming("a", "m1")).toBe(false);
    store.recordIncoming("a", "m2");
    store.recordIncoming("a", "m3");
    expect(store.recordIncoming("a", "m1")).toBe(true);
    expect(store.getSnapshot().totalBySpace.a).toBe(4);
  });

  it("keeps the raced Space while applying authoritative totals for other Spaces", () => {
    const store = new SpaceUnreadStore();
    store.replaceTotals({ a: 4 });
    const revision = store.getAuthorityRevision();
    store.recordIncoming("a", "m1");

    expect(store.replaceTotals({ a: 4, b: 7 }, revision)).toBe(true);
    expect(store.getSnapshot().totalBySpace.a).toBe(5);
    expect(store.getSnapshot().totalBySpace.b).toBe(7);
    expect(store.getSnapshot().newBySpace.a).toBe(1);
  });

  it("keeps a higher authoritative backlog when a cold Space changes during sync", () => {
    const store = new SpaceUnreadStore();
    const revision = store.getAuthorityRevision();
    store.recordIncoming("a", "m1");

    expect(store.replaceTotals({ a: 40 }, revision)).toBe(true);
    expect(store.getSnapshot().totalBySpace.a).toBe(40);
    expect(store.getSnapshot().newBySpace.a).toBe(1);
  });

  it("applies a later authoritative total after the local mutation is in its baseline", () => {
    const store = new SpaceUnreadStore();
    store.replaceTotals({ a: 4 });
    store.recordIncoming("a", "m1");
    const revision = store.getAuthorityRevision();

    expect(store.replaceTotals({ a: 2 }, revision)).toBe(true);
    expect(store.getSnapshot().totalBySpace.a).toBe(2);
    expect(store.getSnapshot().newBySpace.a).toBe(1);
  });

  it("rejects a snapshot captured before an account reset", () => {
    const store = new SpaceUnreadStore();
    const revision = store.getAuthorityRevision();
    store.reset();

    expect(store.replaceTotals({ a: 4 }, revision)).toBe(false);
    expect(store.getSnapshot().totalBySpace).toEqual({});
  });

  it("clamps new unread when an authoritative total decreases", () => {
    const store = new SpaceUnreadStore();
    store.recordIncoming("a", "m1");
    store.recordIncoming("a", "m2");
    store.replaceTotals({ a: 1 });

    expect(store.getSnapshot().newBySpace.a).toBe(1);
    store.setTotal("a", 0);
    expect(store.getSnapshot().totalBySpace.a).toBeUndefined();
    expect(store.getSnapshot().newBySpace.a).toBeUndefined();
  });

  it("publishes only actual state changes", () => {
    const store = new SpaceUnreadStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.replaceTotals({});
    store.clearNewUnreads();
    expect(listener).not.toHaveBeenCalled();
    store.recordIncoming("a", "m1");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clears account-scoped counts and deduplication on reset", () => {
    const store = new SpaceUnreadStore();
    store.recordIncoming("a", "m1");
    store.replaceMemberships([{ channel_id: "g1", space_id: "a" }]);

    store.reset();

    expect(store.getSnapshot().totalBySpace).toEqual({});
    expect(store.getSnapshot().newBySpace).toEqual({});
    expect(store.getGroupSpaceId("g1")).toBeUndefined();
    expect(store.recordIncoming("a", "m1")).toBe(true);
  });

  it("replaces the feature-owned membership snapshot and prefers the source Space", () => {
    const store = new SpaceUnreadStore();
    store.replaceMemberships([
      { channel_id: "native", space_id: "space-a" },
      { channel_id: "external", space_id: "space-remote", my_source_space_id: "space-local" },
    ]);

    expect(store.getGroupSpaceId("native")).toBe("space-a");
    expect(store.getGroupSpaceId("external")).toBe("space-local");

    store.replaceMemberships([{ channel_id: "native", space_id: "space-b" }]);
    expect(store.getGroupSpaceId("native")).toBe("space-b");
    expect(store.getGroupSpaceId("external")).toBeUndefined();
  });
});
