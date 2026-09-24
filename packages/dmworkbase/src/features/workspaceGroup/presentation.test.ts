import { describe, expect, it } from "vitest";
import {
  isWorkspaceGroupDisplayText,
  isWorkspaceGroupDisplayName,
  normalizeWorkspaceGroupDisplayName,
  stripWorkspaceGroupDisplayControls,
} from "./presentation";

const forbiddenCodePoints = [
  0x0000, 0x001F, 0x007F, 0x009F,
  0x061C, 0x200E, 0x200F, 0x202A, 0x202E, 0x2066, 0x2069,
];

describe("workspace group display names", () => {
  it("accepts and preserves Unicode, emoji and Chinese names", () => {
    const value = "研发 Workspace 🚀";
    expect(isWorkspaceGroupDisplayName(value)).toBe(true);
    expect(normalizeWorkspaceGroupDisplayName(`  ${value}  `)).toBe(value);
  });

  it("allows empty and ordinary whitespace values", () => {
    for (const value of ["", "   ", "\u3000"]) {
      expect(isWorkspaceGroupDisplayName(value)).toBe(true);
      expect(normalizeWorkspaceGroupDisplayName(value)).toBe("");
    }
  });

  it("enforces the 256 UTF-16 code unit bound", () => {
    const max = "a".repeat(256);
    expect(isWorkspaceGroupDisplayName(max)).toBe(true);
    expect(normalizeWorkspaceGroupDisplayName(max)).toBe(max);

    const over = "a".repeat(257);
    expect(isWorkspaceGroupDisplayName(over)).toBe(false);
    expect(normalizeWorkspaceGroupDisplayName(over)).toBe("");

    const maxEmoji = "😀".repeat(128);
    expect(maxEmoji.length).toBe(256);
    expect(isWorkspaceGroupDisplayName(maxEmoji)).toBe(true);
    expect(isWorkspaceGroupDisplayName(`${maxEmoji}😀`)).toBe(false);
  });

  it("strips controls from unbounded project and group display text", () => {
    const longName = "a".repeat(257);
    expect(stripWorkspaceGroupDisplayControls(` \u200E${longName}\u202E `)).toBe(longName);
    expect(isWorkspaceGroupDisplayText(longName)).toBe(true);
    expect(isWorkspaceGroupDisplayText(`before\u2066after`)).toBe(false);
    expect(stripWorkspaceGroupDisplayControls(null)).toBe("");
  });

  it.each(forbiddenCodePoints)("rejects and strips forbidden code point U+%s", codePoint => {
    const control = String.fromCodePoint(codePoint);
    expect(isWorkspaceGroupDisplayName(`before${control}after`)).toBe(false);
    expect(normalizeWorkspaceGroupDisplayName(`  before${control}after  `)).toBe("beforeafter");
  });

  it("trims before applying the normalization bound and rejects non-strings", () => {
    expect(normalizeWorkspaceGroupDisplayName(` ${"a".repeat(256)} `)).toBe("a".repeat(256));
    expect(normalizeWorkspaceGroupDisplayName(null)).toBe("");
    expect(normalizeWorkspaceGroupDisplayName(42)).toBe("");
    expect(isWorkspaceGroupDisplayName(null)).toBe(false);
    expect(isWorkspaceGroupDisplayName(42)).toBe(false);
  });
});
