import { describe, expect, it, vi } from "vitest";

import {
  buildGroupCreateSearchIndex,
  createEmptyGroupCreateSearchIndex,
  filterGroupCreateCandidates,
} from "./groupCreateSearch";

describe("group create candidate search", () => {
  const candidates = [
    { uid: "weijiaoying", name: "魏娇莹" },
    { uid: "alice", name: "Alice" },
  ];

  it("matches Chinese, full pinyin and case-insensitive pinyin", () => {
    const index = buildGroupCreateSearchIndex(candidates);

    expect(
      filterGroupCreateCandidates(index, "魏娇").map((item) => item.uid)
    ).toEqual(["weijiaoying"]);
    expect(
      filterGroupCreateCandidates(index, "weijiao").map((item) => item.uid)
    ).toEqual(["weijiaoying"]);
    expect(
      filterGroupCreateCandidates(index, "WEIJIAO").map((item) => item.uid)
    ).toEqual(["weijiaoying"]);
  });

  it("preserves English matching, empty-query results and candidate order", () => {
    const index = buildGroupCreateSearchIndex(candidates);

    expect(filterGroupCreateCandidates(index, "ali")).toEqual([candidates[1]]);
    expect(filterGroupCreateCandidates(index, "")).toEqual(candidates);
    expect(filterGroupCreateCandidates(index, "missing")).toEqual([]);
  });

  it("returns no candidates before the index is ready", () => {
    expect(
      filterGroupCreateCandidates(createEmptyGroupCreateSearchIndex(), "alice")
    ).toEqual([]);
  });

  it("converts 10,000 names once and reuses the index for repeated queries", () => {
    const toPinyin = vi.fn((name: string) =>
      name === "魏娇莹" ? "weijiaoying" : name
    );
    const largeCandidates = Array.from({ length: 10_000 }, (_, index) => ({
      uid: `user-${index}`,
      name: index === 9_999 ? "魏娇莹" : `User ${index}`,
    }));
    const index = buildGroupCreateSearchIndex(largeCandidates, toPinyin);
    const startedAt = performance.now();

    for (let count = 0; count < 20; count += 1) {
      expect(filterGroupCreateCandidates(index, "weijiao")).toHaveLength(1);
    }

    expect(toPinyin).toHaveBeenCalledTimes(10_000);
    expect((performance.now() - startedAt) / 20).toBeLessThan(15);
  });
});
