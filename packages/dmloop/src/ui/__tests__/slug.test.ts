import { describe, it, expect } from "vitest";
import { normalizeBase, slugSuffix, withRandomSuffix } from "../slug";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("normalizeBase", () => {
  it("lowercases, dashes non-alnum, trims edge dashes", () => {
    expect(normalizeBase("  AI Native!! ")).toBe("ai-native");
  });
  it("caps at 34 chars to leave room for the suffix", () => {
    expect(normalizeBase("a".repeat(60)).length).toBe(34);
  });
  it("never ends in a dash even when truncation lands on one", () => {
    // 33 alnum + separator: slice(34) lands exactly on the "-" → must be re-stripped,
    // otherwise withRandomSuffix would produce "base--suffix" (invalid).
    const base = normalizeBase("a".repeat(33) + " secondword");
    expect(base.endsWith("-")).toBe(false);
    expect(SLUG_RE.test(`${base}-x7f2`)).toBe(true);
  });
  it("is empty for input with no ASCII alphanumerics", () => {
    expect(normalizeBase("前端团队")).toBe("");
  });
});

describe("slugSuffix", () => {
  it("is always 4 lowercase-alnum chars", () => {
    for (let i = 0; i < 100; i++) expect(slugSuffix()).toMatch(/^[a-z0-9]{4}$/);
  });
});

describe("withRandomSuffix", () => {
  it("appends the suffix and matches the backend slug regex", () => {
    expect(withRandomSuffix("AI Native", "x7f2")).toBe("ai-native-x7f2");
    expect(SLUG_RE.test(withRandomSuffix("AI Native", "x7f2"))).toBe(true);
  });
  it("falls back to ws when the base normalizes to empty", () => {
    expect(withRandomSuffix("前端团队", "x7f2")).toBe("ws-x7f2");
    expect(SLUG_RE.test(withRandomSuffix("🚀", "x7f2"))).toBe(true);
  });
  it("stays valid with a freshly generated suffix", () => {
    expect(SLUG_RE.test(withRandomSuffix("ainative", slugSuffix()))).toBe(true);
  });
});
