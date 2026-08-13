import { describe, expect, it } from "vitest";
import { shouldHandleMailSpaceChange } from "./mailNavigation";

describe("Mail navigation", () => {
  it("handles Space changes only while Mail is the active menu", () => {
    expect(shouldHandleMailSpaceChange("mail")).toBe(true);
    expect(shouldHandleMailSpaceChange("chat")).toBe(false);
    expect(shouldHandleMailSpaceChange(undefined)).toBe(false);
  });
});
