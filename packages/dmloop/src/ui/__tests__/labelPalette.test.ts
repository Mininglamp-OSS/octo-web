import { describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_COLOR,
  LABEL_PALETTE,
  normalizeLabelColor,
} from "../labelPalette";

describe("labelPalette", () => {
  it("provides muted backend-safe hex colors", () => {
    expect(LABEL_PALETTE).toHaveLength(10);
    for (const color of LABEL_PALETTE) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("normalizes invalid colors to the default palette color", () => {
    expect(DEFAULT_LABEL_COLOR).toBe("#6B7280");
    expect(normalizeLabelColor("#657C9A")).toBe("#657C9A");
    expect(normalizeLabelColor("657C9A")).toBe(DEFAULT_LABEL_COLOR);
    expect(normalizeLabelColor("red")).toBe(DEFAULT_LABEL_COLOR);
    expect(normalizeLabelColor(null)).toBe(DEFAULT_LABEL_COLOR);
  });
});
