import { Subscriber } from "wukongimjssdk";
import { describe, expect, it } from "vitest";

import { describeMemberRemovalOutcome } from "../memberRemovalOutcome";

function member(uid: string) {
  const row = new Subscriber();
  row.uid = uid;
  return row;
}

describe("member removal outcome", () => {
  it("completes only when every target is confirmed absent", () => {
    expect(describeMemberRemovalOutcome({ absent: ["a", "b"], present: [], unknown: [] }, 2))
      .toMatchObject({ complete: true });
    expect(describeMemberRemovalOutcome({ absent: ["a"], present: [], unknown: ["b"] }, 2))
      .toMatchObject({ complete: false });
  });

  it("preserves a safe request error for partial and unknown results", () => {
    const partial = describeMemberRemovalOutcome(
      { absent: ["a"], present: [member("b")], unknown: [] }, 2, "移除失败"
    );
    const unknown = describeMemberRemovalOutcome(
      { absent: [], present: [], unknown: ["a"] }, 1, "移除失败"
    );
    expect(partial.message).toContain("移除失败");
    expect(unknown.message).toContain("移除失败");
  });
});
