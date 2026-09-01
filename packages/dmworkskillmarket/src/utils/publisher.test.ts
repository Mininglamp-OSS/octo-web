import { describe, expect, it } from "vitest";
import { isPlatformPublishedSkill } from "./publisher";

describe("isPlatformPublishedSkill", () => {
  it("treats public and system visibility as platform-published", () => {
    expect(isPlatformPublishedSkill({ visibility: "public" })).toBe(true);
    // Aligned with the connector/expert markets: system is the unified backend's
    // official visibility, so a system-admin-published skill keeps its badge.
    expect(isPlatformPublishedSkill({ visibility: "system" })).toBe(true);
    expect(isPlatformPublishedSkill({ visibility: "space" })).toBe(false);
    expect(isPlatformPublishedSkill({ visibility: "private" })).toBe(false);
  });
});
