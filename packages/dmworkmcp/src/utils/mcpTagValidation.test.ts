import { describe, expect, it, vi } from "vitest";

// The validator calls t() to build its error strings; the test doesn't care
// about the resolved copy, only that a message was returned (invalid) or was
// null (valid). Mocking @octo/base to a pass-through t() keeps the tests
// independent of the i18n runtime.
vi.mock("@octo/base", () => ({
  t: (key: string) => key,
}));

import {
  MAX_MCP_TAGS,
  MAX_MCP_TAG_LENGTH,
  tagLength,
  validateMcpTag,
  validateMcpTags,
} from "./mcpTagValidation";

describe("tagLength — codepoint counting (not UTF-16 units)", () => {
  it("counts BMP CJK as 1 each", () => {
    expect(tagLength("数据服务")).toBe(4);
  });
  it("counts surrogate-pair (astral) CJK as 1 each", () => {
    // U+20BB7 (𠮷) is a supplementary-plane codepoint; its .length is 2
    // (surrogate pair) but visually and semantically it is one character.
    // Regression guard: `value.length` would produce 2 here and would push
    // a 24-visual-char CJK tag past MAX_MCP_TAG_LENGTH.
    const astral = "𠮷";
    expect(astral.length).toBe(2);
    expect(tagLength(astral)).toBe(1);
    expect(tagLength(astral.repeat(24))).toBe(24);
  });
});

describe("validateMcpTag — single-tag rules", () => {
  it("empty / whitespace-only returns null (caller decides whether to add)", () => {
    expect(validateMcpTag("")).toBeNull();
    expect(validateMcpTag("   ")).toBeNull();
  });

  it("length boundary is MAX_MCP_TAG_LENGTH codepoints (inclusive)", () => {
    const at = "a".repeat(MAX_MCP_TAG_LENGTH);
    const over = "a".repeat(MAX_MCP_TAG_LENGTH + 1);
    expect(validateMcpTag(at)).toBeNull();
    expect(validateMcpTag(over)).not.toBeNull();
  });

  it("length boundary applies to astral CJK, too (regression guard against value.length)", () => {
    const at = "𠮷".repeat(MAX_MCP_TAG_LENGTH);
    expect(validateMcpTag(at)).toBeNull();
  });

  it("charset allows letters, digits, and - _ / . # + and spaces", () => {
    expect(validateMcpTag("v1.0")).toBeNull();
    expect(validateMcpTag("data-service")).toBeNull();
    expect(validateMcpTag("c++")).toBeNull();
    expect(validateMcpTag("dev tools")).toBeNull();
    expect(validateMcpTag("api/v1")).toBeNull();
    expect(validateMcpTag("#tag")).toBeNull();
    expect(validateMcpTag("数据服务")).toBeNull();
  });

  it("charset rejects tab / newline / zero-width-space / emoji / comma", () => {
    expect(validateMcpTag("a\tb")).not.toBeNull();
    expect(validateMcpTag("a\nb")).not.toBeNull();
    expect(validateMcpTag("a​b")).not.toBeNull();
    expect(validateMcpTag("hi\u{1F600}")).not.toBeNull();
    expect(validateMcpTag("a,b")).not.toBeNull();
  });
});

describe("validateMcpTags — collection rules", () => {
  it("count boundary is MAX_MCP_TAGS (inclusive)", () => {
    const at = Array.from({ length: MAX_MCP_TAGS }, (_, i) => `t${i}`);
    const over = [...at, "extra"];
    expect(validateMcpTags(at)).toBeNull();
    expect(validateMcpTags(over)).not.toBeNull();
  });

  it("propagates the first invalid tag error", () => {
    expect(validateMcpTags(["ok", "a,b"])).not.toBeNull();
  });

  it("empty strings in the array do NOT short-circuit later validation", () => {
    // validateMcpTag("") returns null so a caller that leaked an empty tag
    // into the array shouldn't accidentally mask a real violation later.
    expect(validateMcpTags(["", "bad,tag"])).not.toBeNull();
  });
});
