import { describe, expect, it } from "vitest";
import { buildPrivateChatGroupMemberUids } from "../memberUids";

describe("buildPrivateChatGroupMemberUids", () => {
  it("includes the current user, private chat peer, and selected contacts", () => {
    expect(
      buildPrivateChatGroupMemberUids("u_self", "u_peer", ["u_a", "u_b"])
    ).toEqual(["u_self", "u_peer", "u_a", "u_b"]);
  });

  it("deduplicates members and omits empty login uid", () => {
    expect(
      buildPrivateChatGroupMemberUids("", "u_peer", ["u_peer", "u_a", "u_a"])
    ).toEqual(["u_peer", "u_a"]);
  });
});
