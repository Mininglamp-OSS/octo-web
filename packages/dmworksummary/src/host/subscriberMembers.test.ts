import { afterEach, describe, expect, it, vi } from "vitest";
import { WKSDK } from "wukongimjssdk";
import { summarySubscriber, summarySubscribers } from "../__tests__/fixtures/summarySubscribers";
import { legacySummaryMessagingPort } from "./legacySummaryMessaging";
import { toSummaryConversationMember } from "./subscriberMembers";
import { isActiveSummaryGroupMember } from "./memberPolicy";

afterEach(() => vi.restoreAllMocks());

describe("Summary subscriber DTO", () => {
  it("preserves SDK identity and eligibility fields through the actual host port", async () => {
    const manager = WKSDK.shared().channelManager;
    vi.spyOn(manager, "syncSubscribes").mockResolvedValue(undefined);
    vi.spyOn(manager, "getSubscribes").mockReturnValue(summarySubscribers());
    const members = await legacySummaryMessagingPort.loadConversationMembers({
      channelId: "group", channelType: 2,
    });

    expect(members).toEqual([
      expect.objectContaining({ uid: "human", name: "Remark", role: 2, isBot: false, status: 1, isDeleted: false }),
      expect.objectContaining({ uid: "verified", name: "Verified name", isBot: false }),
      expect.objectContaining({ uid: "app-bot", isBot: true }),
      expect.objectContaining({ uid: "inactive", status: 0 }),
      expect.objectContaining({ uid: "deleted", isDeleted: true }),
    ]);
    expect(members.filter((member) => isActiveSummaryGroupMember(member) && !member.isBot)
      .map((member) => member.uid)).toEqual(["human", "verified"]);
  });

  it.each([true, 1, "1", "true"])("normalizes robot flag %s without a channel-info cache", (robot) => {
    expect(toSummaryConversationMember(summarySubscriber("bot", { orgData: { robot } })).isBot).toBe(true);
  });

  it("uses uid for an empty name and keeps the avatar", () => {
    expect(toSummaryConversationMember(summarySubscriber("user", {
      name: "", avatar: "users/user/avatar",
    }))).toMatchObject({ name: "user", avatar: "users/user/avatar" });
  });

  it("keeps the legacy optional-status contract but rejects inactive/deleted members", () => {
    expect(isActiveSummaryGroupMember({})).toBe(true);
    expect(isActiveSummaryGroupMember({ status: 1 })).toBe(true);
    expect(isActiveSummaryGroupMember({ status: 0 })).toBe(false);
    expect(isActiveSummaryGroupMember({ status: 2 })).toBe(false);
    expect(isActiveSummaryGroupMember({ status: 1, isDeleted: true })).toBe(false);
  });
});
