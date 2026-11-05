import { describe, expect, it } from "vitest";
import { nameDisplayLines, splitNameMatches } from "../nameResultMapper";
import type { NameSearchItem } from "../../../Service/NameSearchTypes";

const item: NameSearchItem = {
  id: "u",
  kind: "contact",
  contactType: "human",
  originalName: "😀向东",
  remarkName: "同事向",
  displayName: "同事向",
  matches: { original: [{ start: 1, end: 2 }], remark: [{ start: 2, end: 3 }] },
};
describe("nameResultMapper", () => {
  it("processes overlapping spans without expanding every range into characters", () => {
    let reads = 0;
    const ranges = Array.from({ length: 2000 }, () => ({
      get start() {
        reads += 1;
        return 0;
      },
      get end() {
        reads += 1;
        return 1000;
      },
    }));
    const result = splitNameMatches("😀".repeat(1000), ranges);
    expect(result).toEqual([{ text: "😀".repeat(1000), matched: true }]);
    expect(reads).toBeLessThan(40000);
  });
  it("keeps separate matching fields and slices Unicode code points", () => {
    expect(nameDisplayLines(item)).toEqual([
      {
        field: "remark",
        text: "同事向",
        segments: [
          { text: "同事", matched: false },
          { text: "向", matched: true },
        ],
      },
      {
        field: "original",
        text: "😀向东",
        segments: [
          { text: "😀", matched: false },
          { text: "向", matched: true },
          { text: "东", matched: false },
        ],
      },
    ]);
  });
  it("shows a matching original on line two without inventing remark highlighting", () => {
    const lines = nameDisplayLines({
      ...item,
      matches: { original: item.matches.original, remark: [] },
    });
    expect(lines[0].segments).toEqual([{ text: "同事向", matched: false }]);
    expect(lines[1].field).toBe("original");
  });
  it("does not duplicate equal names or invent a missing original", () => {
    expect(nameDisplayLines({ ...item, originalName: "同事向" })).toHaveLength(
      1
    );
    expect(
      nameDisplayLines({
        ...item,
        originalName: "",
        matches: { original: [], remark: item.matches.remark },
      })
    ).toHaveLength(1);
  });
  it("treats markup in names as plain text and highlights every range", () => {
    expect(
      splitNameMatches("<小王>小王", [
        { start: 1, end: 3 },
        { start: 4, end: 6 },
      ])
    ).toEqual([
      { text: "<", matched: false },
      { text: "小王", matched: true },
      { text: ">", matched: false },
      { text: "小王", matched: true },
    ]);
  });
});
