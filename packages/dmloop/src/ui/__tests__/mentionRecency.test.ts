// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { sortByRecency, recordMentionUsage, getRecencyMap } from "../mentionRecency";

// jsdom's localStorage is unreliable under Node here; inject a minimal in-memory one.
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

type Item = { type: string; id: string; label: string };
const it0 = (type: string, id: string, label: string): Item => ({ type, id, label });

describe("sortByRecency", () => {
  it("orders by recency desc, then label asc for ties", () => {
    const items = [it0("agent", "a", "Zoe"), it0("agent", "b", "Amy"), it0("member", "c", "Bob")];
    const recency = { "agent:b": 100, "member:c": 200 };
    // c (200) > b (100) > a (0). a/Zoe and... only a has 0; label tiebreak only when equal recency.
    expect(sortByRecency(items, recency).map((i) => i.id)).toEqual(["c", "b", "a"]);
  });

  it("falls back to label when recency is equal (both unseen)", () => {
    const items = [it0("agent", "z", "Zed"), it0("agent", "a", "Ann")];
    expect(sortByRecency(items, {}).map((i) => i.id)).toEqual(["a", "z"]);
  });

  it("does not mutate the input array", () => {
    const items = [it0("agent", "z", "Z"), it0("agent", "a", "A")];
    const copy = [...items];
    sortByRecency(items, {});
    expect(items).toEqual(copy);
  });
});

describe("recordMentionUsage / getRecencyMap", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips a recorded mention under its workspace", () => {
    recordMentionUsage("ws1", { type: "agent", id: "x" });
    expect(getRecencyMap("ws1")["agent:x"]).toBeGreaterThan(0);
  });

  it("isolates recency per workspace", () => {
    recordMentionUsage("ws1", { type: "agent", id: "x" });
    expect(getRecencyMap("ws2")["agent:x"]).toBeUndefined();
  });

  it("no-ops on empty workspace id", () => {
    recordMentionUsage("", { type: "agent", id: "x" });
    expect(getRecencyMap("")).toEqual({});
  });
});
