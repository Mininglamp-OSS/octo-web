import { describe, expect, it } from "vitest";
import { isOfficialMcp } from "./publisher";

describe("isOfficialMcp", () => {
  it("only treats visibility=system as official", () => {
    expect(isOfficialMcp({ visibility: "system" })).toBe(true);
    expect(isOfficialMcp({ visibility: "public" })).toBe(false);
    expect(isOfficialMcp({ visibility: "private" })).toBe(false);
    expect(isOfficialMcp({ visibility: undefined })).toBe(false);
  });
});
