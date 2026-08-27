import { describe, expect, it } from "vitest";
import { isShellSafeSpaceId, sanitizeShellSpaceId } from "./spaceId";

describe("shell-safe Space ids", () => {
  it.each([
    "11111111-2222-3333-4444-555555555555",
    "9f5fda183d94482cb49bca5024439105",
    "minglue_default",
    "mail.prod-1",
  ])("accepts server-issued value %j", (value) => {
    expect(isShellSafeSpaceId(value)).toBe(true);
    expect(sanitizeShellSpaceId(value)).toBe(value);
  });

  it("trims a valid Space id", () => {
    expect(sanitizeShellSpaceId("  minglue_default  ")).toBe("minglue_default");
  });

  it.each([
    "",
    "space id",
    "space;id",
    'space"id',
    "space'id",
    "$(whoami)",
    "`whoami`",
    "-space",
    ".space",
    "..",
  ])("replaces shell-unsafe value %j with the placeholder", (value) => {
    expect(isShellSafeSpaceId(value)).toBe(false);
    expect(sanitizeShellSpaceId(value)).toBe("<space-id>");
  });
});
