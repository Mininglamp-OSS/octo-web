// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { requireSummaryHostBridge } from "./hostBridge";

describe("summary host bridge", () => {
  afterEach(() => {
    delete window.octoBuddySummary;
  });

  it("returns the preload bridge", () => {
    const bridge = {} as NonNullable<typeof window.octoBuddySummary>;
    window.octoBuddySummary = bridge;
    expect(requireSummaryHostBridge()).toBe(bridge);
  });

  it("fails fast when preload did not expose the bridge", () => {
    expect(() => requireSummaryHostBridge()).toThrow(
      "octoBuddy summary bridge is unavailable"
    );
  });
});
