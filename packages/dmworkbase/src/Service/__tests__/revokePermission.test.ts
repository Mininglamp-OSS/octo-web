import { describe, expect, it } from "vitest";
import { ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import { ChannelTypeCommunityTopic, GroupRole } from "../Const";
import { canShowRevokeMenu } from "../revokePermission";

const base = {
  messageID: "msg-1",
  messageTimestamp: 1000,
  nowSeconds: 1100,
  revokeSecond: 120,
};

describe("canShowRevokeMenu", () => {
  it("rejects messages without a server id", () => {
    expect(
      canShowRevokeMenu({
        ...base,
        messageID: "",
        messageSend: true,
      })
    ).toBe(false);
  });

  it("allows bot owners to revoke their own bot messages without the time window", () => {
    expect(
      canShowRevokeMenu({
        ...base,
        isBotOwner: true,
        messageSend: false,
        messageTimestamp: 1,
      })
    ).toBe(true);
  });

  it("allows own messages inside the revoke window and hides expired own messages", () => {
    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypePerson,
        messageSend: true,
      })
    ).toBe(true);

    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypePerson,
        messageSend: true,
        messageTimestamp: 900,
      })
    ).toBe(false);
  });

  it("hides other people's direct messages", () => {
    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypePerson,
        messageSend: false,
      })
    ).toBe(false);
  });

  it("allows group owners to revoke anyone's messages", () => {
    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypeGroup,
        messageSend: false,
        myRole: GroupRole.owner,
      })
    ).toBe(true);
  });

  it("allows group managers to revoke normal members, but not owners or managers", () => {
    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypeGroup,
        messageSend: false,
        myRole: GroupRole.manager,
        targetRole: GroupRole.normal,
      })
    ).toBe(true);

    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypeGroup,
        messageSend: false,
        myRole: GroupRole.manager,
        targetRole: GroupRole.manager,
      })
    ).toBe(false);

    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypeGroup,
        messageSend: false,
        myRole: GroupRole.manager,
        targetRole: GroupRole.owner,
      })
    ).toBe(false);
  });

  it("hides manager revoke when the sender role is unknown", () => {
    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypeGroup,
        messageSend: false,
        myRole: GroupRole.manager,
      })
    ).toBe(false);
  });

  it("applies the same role matrix to thread channels", () => {
    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypeCommunityTopic,
        messageSend: false,
        myRole: GroupRole.manager,
        targetRole: GroupRole.normal,
      })
    ).toBe(true);

    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypeCommunityTopic,
        messageSend: false,
        myRole: GroupRole.normal,
        targetRole: GroupRole.normal,
      })
    ).toBe(false);
  });

  it("keeps manager's own messages time-limited in group channels", () => {
    expect(
      canShowRevokeMenu({
        ...base,
        channelType: ChannelTypeGroup,
        messageSend: true,
        myRole: GroupRole.manager,
        messageTimestamp: 900,
      })
    ).toBe(false);
  });
});
