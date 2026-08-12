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
    const store = new ComposeRecoveryStore<Recovery>({ dispose });
    store.subscribe("channel", listener);
    store.add(recovery("channel", "A"));
    store.add(recovery("channel", "B"));

    store.consume("channel", ["A"]);

    expect(store.list("channel").map(({ attemptId }) => attemptId)).toEqual([
      "B",
    ]);
    expect(dispose).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(3);
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
    expect(store.list("two")).toEqual([]);
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
