// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { requireAppsHostBridge } from "./hostBridge";

describe("apps host bridge", () => {
  afterEach(() => {
    delete window.octoBuddyApps;
  });

  it("returns the preload bridge", () => {
    const bridge = {} as NonNullable<typeof window.octoBuddyApps>;
    window.octoBuddyApps = bridge;
    expect(requireAppsHostBridge()).toBe(bridge);
  });

  it("fails fast when preload did not expose the bridge", () => {
    expect(() => requireAppsHostBridge()).toThrow(
      "octoBuddy apps bridge is unavailable"
    );
  });
});
