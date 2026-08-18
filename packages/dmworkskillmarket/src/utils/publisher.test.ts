import { describe, expect, it } from "vitest";
import { isPlatformPublishedSkill } from "./publisher";

describe("isPlatformPublishedSkill", () => {
  it("identifies only system visibility as platform-published", () => {
    expect(isPlatformPublishedSkill({ visibility: "system" })).toBe(true);
    expect(isPlatformPublishedSkill({ visibility: "public" })).toBe(false);
    expect(isPlatformPublishedSkill({ visibility: "space" })).toBe(false);
    expect(isPlatformPublishedSkill({ visibility: "private" })).toBe(false);
  });
});
