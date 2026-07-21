import { describe, it, expect } from "vitest";
import {
  shouldEnableMultiLine,
  MULTILINE_TEXT_THRESHOLD,
} from "../multiLine";

// 无任一多行条件的基线参数，测试里按需覆写单个字段。
const baseline = {
  text: "",
  hasMultipleParagraphs: false,
  hasNewline: false,
  hasAttachments: false,
  composing: false,
  previous: false,
};

describe("shouldEnableMultiLine", () => {
  describe("composing=true：维持 previous，不切布局（IME 保护）", () => {
    it("四条件全触发也返回 previous=false", () => {
      expect(
        shouldEnableMultiLine({
          text: "x".repeat(MULTILINE_TEXT_THRESHOLD + 1),
          hasMultipleParagraphs: true,
          hasNewline: true,
          hasAttachments: true,
          composing: true,
          previous: false,
        })
      ).toBe(false);
    });

    it("四条件全触发也返回 previous=true", () => {
      expect(
        shouldEnableMultiLine({
          text: "x".repeat(MULTILINE_TEXT_THRESHOLD + 1),
          hasMultipleParagraphs: true,
          hasNewline: true,
          hasAttachments: true,
          composing: true,
          previous: true,
        })
      ).toBe(true);
    });

    it("零条件时也返回 previous=true（组字期不能从 true 反切成 false）", () => {
      expect(
        shouldEnableMultiLine({ ...baseline, composing: true, previous: true })
      ).toBe(true);
    });
  });

  describe("composing=false：按四条件独立判定", () => {
    it("hasMultipleParagraphs=true → true", () => {
      expect(
        shouldEnableMultiLine({ ...baseline, hasMultipleParagraphs: true })
      ).toBe(true);
    });

    it("hasNewline=true → true", () => {
      expect(shouldEnableMultiLine({ ...baseline, hasNewline: true })).toBe(
        true
      );
    });

    it("hasAttachments=true → true", () => {
      expect(shouldEnableMultiLine({ ...baseline, hasAttachments: true })).toBe(
        true
      );
    });

    it("text.length 超阈 → true", () => {
      expect(
        shouldEnableMultiLine({
          ...baseline,
          text: "x".repeat(MULTILINE_TEXT_THRESHOLD + 1),
        })
      ).toBe(true);
    });

    it("四条件全 false → false", () => {
      expect(shouldEnableMultiLine(baseline)).toBe(false);
    });

    it("previous=true 且四条件全 false → false（可以反切）", () => {
      expect(shouldEnableMultiLine({ ...baseline, previous: true })).toBe(
        false
      );
    });
  });

  describe("text.length 边界（阈值定义：> MULTILINE_TEXT_THRESHOLD 才算长）", () => {
    it(`text.length===${MULTILINE_TEXT_THRESHOLD} → false`, () => {
      expect(
        shouldEnableMultiLine({
          ...baseline,
          text: "x".repeat(MULTILINE_TEXT_THRESHOLD),
        })
      ).toBe(false);
    });

    it(`text.length===${MULTILINE_TEXT_THRESHOLD + 1} → true`, () => {
      expect(
        shouldEnableMultiLine({
          ...baseline,
          text: "x".repeat(MULTILINE_TEXT_THRESHOLD + 1),
        })
      ).toBe(true);
    });
  });
});
