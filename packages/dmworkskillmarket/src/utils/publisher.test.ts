import { describe, expect, it } from "vitest";
import { isPlatformPublishedSkill } from "./publisher";

describe("isPlatformPublishedSkill", () => {
  it("identifies public visibility as platform-published", () => {
    expect(isPlatformPublishedSkill({ visibility: "public" })).toBe(true);
    expect(isPlatformPublishedSkill({ visibility: "space" })).toBe(false);
    expect(isPlatformPublishedSkill({ visibility: "private" })).toBe(false);
  });
});
