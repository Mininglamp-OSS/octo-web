import { describe, expect, it } from "vitest";

import { parseAvatarColorIndex } from "../channelSettingAvatarColor";

describe("parseAvatarColorIndex", () => {
  it("keeps valid numeric palette indices", () => {
    expect(parseAvatarColorIndex(0)).toBe(0);
    expect(parseAvatarColorIndex(3)).toBe(3);
    expect(parseAvatarColorIndex("4")).toBe(4);
  });

  it("treats cleared or missing avatar colors as default", () => {
    expect(parseAvatarColorIndex("")).toBeUndefined();
    expect(parseAvatarColorIndex(null)).toBeUndefined();
    expect(parseAvatarColorIndex(undefined)).toBeUndefined();
  });

  it("rejects non-integer and negative values", () => {
    expect(parseAvatarColorIndex(-1)).toBeUndefined();
    expect(parseAvatarColorIndex(1.5)).toBeUndefined();
    expect(parseAvatarColorIndex("-1")).toBeUndefined();
    expect(parseAvatarColorIndex("1.5")).toBeUndefined();
    expect(parseAvatarColorIndex("abc")).toBeUndefined();
  });
});
