import { describe, expect, it, vi } from "vitest";
import { ComposeRecoveryStore } from "../composeRecoveryStore";

interface Recovery {
  channelKey: string;
  attemptId: string;
  value: string;
}

const recovery = (channelKey: string, attemptId: string): Recovery => ({
  channelKey,
  attemptId,
  value: attemptId,
});

describe("ComposeRecoveryStore", () => {
  it("preserves failed attempts in arrival order and ignores duplicates", () => {
    const store = new ComposeRecoveryStore<Recovery>();

    expect(store.add(recovery("channel", "A"))).toBe(true);
    expect(store.add(recovery("channel", "B"))).toBe(true);
    expect(store.add(recovery("channel", "A"))).toBe(false);

    expect(store.list("channel").map(({ attemptId }) => attemptId)).toEqual([
      "A",
      "B",
    ]);
  });

  it("notifies the active subscriber even when another owner adds recovery", () => {
    const store = new ComposeRecoveryStore<Recovery>();
    const staleOwner = vi.fn((item: Recovery) => store.add(item));
    const activeOwner = vi.fn();
    store.subscribe("channel", activeOwner);

    staleOwner(recovery("channel", "A"));

    expect(activeOwner).toHaveBeenCalledTimes(1);
    expect(store.list("channel")).toHaveLength(1);
  });

  it("consumes restored records without disposing transferred resources", () => {
    const dispose = vi.fn();
    const listener = vi.fn();
    const owner = Symbol("owner");
    const store = new ComposeRecoveryStore<Recovery>({ dispose });
    store.subscribe("channel", listener);
    store.add(recovery("channel", "A"));
    store.add(recovery("channel", "B"));

    expect(store.claim("channel", owner).map(({ attemptId }) => attemptId)).toEqual([
      "A",
      "B",
    ]);
    store.consume("channel", owner, ["A"]);

    expect(store.list("channel").map(({ attemptId }) => attemptId)).toEqual([
      "B",
    ]);
    expect(dispose).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("allows only one mounted owner to claim a recovery", () => {
    const store = new ComposeRecoveryStore<Recovery>();
    const first = Symbol("first");
    const second = Symbol("second");
    store.add(recovery("channel", "A"));

    expect(store.claim("channel", first)).toHaveLength(1);
    expect(store.claim("channel", second)).toEqual([]);

    store.release("channel", first);
    expect(store.claim("channel", second)).toHaveLength(1);
  });

  it("does not let another owner consume a claimed recovery", () => {
    const store = new ComposeRecoveryStore<Recovery>();
    const owner = Symbol("owner");
    const stranger = Symbol("stranger");
    store.add(recovery("channel", "A"));
    store.claim("channel", owner);

    store.consume("channel", stranger, ["A"]);

    expect(store.list("channel")).toHaveLength(1);
  });

  it("keeps list pure and expires unclaimed records on the next claim", () => {
    let now = 0;
    const dispose = vi.fn();
    const store = new ComposeRecoveryStore<Recovery>({
      ttlMs: 10,
      now: () => now,
      dispose,
    });
    store.add(recovery("channel", "A"));
    now = 10;

    expect(store.list("channel")).toHaveLength(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(store.claim("channel", Symbol("owner"))).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes expired records and bounds channels and records per channel", () => {
    let now = 0;
    const dispose = vi.fn();
    const store = new ComposeRecoveryStore<Recovery>({
      maxChannels: 2,
      maxRecordsPerChannel: 2,
      ttlMs: 10,
      now: () => now,
      dispose,
    });

    store.add(recovery("one", "A"));
    store.add(recovery("one", "B"));
    store.add(recovery("one", "C"));
    expect(dispose).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: "A" })
    );

    now = 1;
    store.add(recovery("two", "D"));
    now = 2;
    store.add(recovery("three", "E"));
    expect(store.list("one")).toEqual([]);
    expect(dispose).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: "B" })
    );
    expect(dispose).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: "C" })
    );

    now = 12;
    expect(store.claim("two", Symbol("owner"))).toEqual([]);
    expect(dispose).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: "D" })
    );
  });

  it("notifies another mounted channel when a write expires its records", () => {
    let now = 0;
    const expiredChannel = vi.fn();
    const store = new ComposeRecoveryStore<Recovery>({
      ttlMs: 10,
      now: () => now,
    });
    store.add(recovery("expired", "A"));
    store.subscribe("expired", expiredChannel);

    now = 10;
    store.add(recovery("active", "B"));

    expect(expiredChannel).toHaveBeenCalledTimes(1);
    expect(store.list("expired")).toEqual([]);
  });
});
