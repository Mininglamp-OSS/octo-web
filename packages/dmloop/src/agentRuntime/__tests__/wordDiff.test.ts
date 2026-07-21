import { describe, expect, it } from "vitest";
import { tokenize, wordDiff } from "../wordDiff";

describe("wordDiff", () => {
  it("tokenize 保留分隔符，可无损拼回", () => {
    const s = "const x = foo(a, b);";
    expect(tokenize(s).join("")).toBe(s);
  });

  it("完全相同的行只有 equal 片段", () => {
    const segs = wordDiff("hello world", "hello world");
    expect(segs.every((s) => s.kind === "equal")).toBe(true);
    expect(segs.map((s) => s.value).join("")).toBe("hello world");
  });

  it("只标出变化的词", () => {
    const segs = wordDiff("const x = 1", "const x = 2");
    // old 侧重建
    const oldText = segs.filter((s) => s.kind !== "insert").map((s) => s.value).join("");
    const newText = segs.filter((s) => s.kind !== "delete").map((s) => s.value).join("");
    expect(oldText).toBe("const x = 1");
    expect(newText).toBe("const x = 2");
    // "1" 被删、"2" 被插，其余 equal
    expect(segs.some((s) => s.kind === "delete" && s.value === "1")).toBe(true);
    expect(segs.some((s) => s.kind === "insert" && s.value === "2")).toBe(true);
  });

  it("纯新增 / 纯删除", () => {
    expect(wordDiff("", "new")).toEqual([{ kind: "insert", value: "new" }]);
    expect(wordDiff("old", "")).toEqual([{ kind: "delete", value: "old" }]);
  });

  it("相邻同类片段被合并", () => {
    const segs = wordDiff("a b c", "a x y c");
    // 中间 "b" → "x y" 段应合并为紧凑输出（不逐字符碎片化）
    const inserts = segs.filter((s) => s.kind === "insert");
    expect(inserts.length).toBeLessThanOrEqual(2);
  });
});
