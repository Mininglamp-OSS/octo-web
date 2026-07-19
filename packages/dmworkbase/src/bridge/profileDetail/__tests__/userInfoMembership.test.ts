import { describe, expect, it, vi } from "vitest";

vi.mock("wukongimjssdk", () => ({
  ChannelTypePerson: 1,
}));

import {
  userInfoMembershipCreatedAt,
  userInfoMembershipOrgData,
} from "../userInfoMembership";

describe("userInfoMembershipOrgData", () => {
  it("prefers subscriber membership data when available", () => {
    const orgData = userInfoMembershipOrgData({
      fromChannel: { channelID: "group-a", channelType: 2 } as any,
      channelInfo: {
        orgData: {
          created_at: "2026-07-19T10:00:00Z",
          invite_uid: "from-profile",
        },
      } as any,
      fromSubscriberOfUser: {
        orgData: {
          created_at: "2026-07-18T10:00:00Z",
          invite_uid: "from-subscriber",
        },
      } as any,
    });

    expect(orgData?.created_at).toBe("2026-07-18T10:00:00Z");
    expect(orgData?.invite_uid).toBe("from-subscriber");
  });

  it("falls back to profile membership data for group or thread entry", () => {
    const orgData = userInfoMembershipOrgData({
      fromChannel: { channelID: "group-a____thread-1", channelType: 5 } as any,
      channelInfo: {
        orgData: { created_at: "2026-07-19T10:00:00Z", invite_uid: "u2" },
      } as any,
    });

    expect(orgData?.created_at).toBe("2026-07-19T10:00:00Z");
    expect(orgData?.invite_uid).toBe("u2");
  });

  it("does not treat direct person profile data as group membership data", () => {
    const orgData = userInfoMembershipOrgData({
      fromChannel: { channelID: "u1", channelType: 1 } as any,
      channelInfo: {
        orgData: { created_at: "2026-07-19T10:00:00Z" },
      } as any,
    });

    expect(orgData).toBeUndefined();
  });
});

describe("userInfoMembershipCreatedAt", () => {
  it("returns only non-empty string timestamps", () => {
    expect(
      userInfoMembershipCreatedAt({ created_at: "2026-07-19T10:00:00Z" })
    ).toBe("2026-07-19T10:00:00Z");
    expect(userInfoMembershipCreatedAt({ created_at: "" })).toBe("");
    expect(userInfoMembershipCreatedAt({ created_at: 123 })).toBe("");
    expect(userInfoMembershipCreatedAt()).toBe("");
  });
});
