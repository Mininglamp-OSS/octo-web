import { describe, expect, it } from "vitest";
import {
  clampResizablePanelWidth,
  shouldUseResizablePanelOverlay,
} from "../index";

const size = {
  minWidth: 360,
  defaultWidth: 480,
  maxWidth: 720,
  storageKey: "test-panel",
};

describe("clampResizablePanelWidth", () => {
  it("keeps the requested width inside the configured range", () => {
    expect(clampResizablePanelWidth(200, 1600, size)).toBe(360);
    expect(clampResizablePanelWidth(520, 1600, size)).toBe(520);
    expect(clampResizablePanelWidth(900, 2000, size)).toBe(720);
  });

  it("leaves at least half of the container for the main content", () => {
    expect(clampResizablePanelWidth(700, 1000, size)).toBe(500);
  });

  it("switches to overlay when two usable columns no longer fit", () => {
    expect(shouldUseResizablePanelOverlay(719, size)).toBe(true);
    expect(shouldUseResizablePanelOverlay(720, size)).toBe(false);
  });
});
