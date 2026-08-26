import { describe, expect, it, vi } from "vitest";
import { ChannelTypePerson, ChannelTypeGroup } from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../Const";
import { channelOpenedTrackPayload, resolveAiPeer } from "../channelOpenedTracking";

describe("channelOpenedTrackPayload", () => {
  it("私聊行:channel_type=person + is_ai=true(对端为 AI/bot)", () => {
    expect(
      channelOpenedTrackPayload(
        { channelType: ChannelTypePerson, channelID: "peer-uid" },
        true
      )
    ).toEqual({ object_id: "peer-uid", channel_type: "person", is_ai: true });
  });

  it("私聊行:对端非 AI → is_ai=false(携带,非省略,浓度分母需要)", () => {
    expect(
      channelOpenedTrackPayload(
        { channelType: ChannelTypePerson, channelID: "human-uid" },
        false
      )
    ).toEqual({ object_id: "human-uid", channel_type: "person", is_ai: false });
  });

  it("群聊行:channel_type=group,不带 is_ai(群无对端 AI 语义,空值非 false)", () => {
    const payload = channelOpenedTrackPayload(
      { channelType: ChannelTypeGroup, channelID: "group-a" },
      // 群路径 isAiPeer 恒 false,不应影响输出(不携带该字段)
      false
    );
    expect(payload).toEqual({ object_id: "group-a", channel_type: "group" });
    expect(payload).not.toHaveProperty("is_ai");
  });

  it("其他频道(如客服 3):channel_type=other,不带 is_ai", () => {
    const payload = channelOpenedTrackPayload(
      { channelType: 3, channelID: "cs-1" },
      false
    );
    expect(payload).toEqual({ object_id: "cs-1", channel_type: "other" });
    expect(payload).not.toHaveProperty("is_ai");
  });

  it("子区行(ChannelTypeCommunityTopic)返回 null(→ subchannel_opened 覆盖,不发 channel_opened)", () => {
    expect(
      channelOpenedTrackPayload(
        { channelType: ChannelTypeCommunityTopic, channelID: "group-a____t1" },
        false
      )
    ).toBeNull();
  });

  it("object_id 保持原始 channelID(不 stripSpacePrefix,遗留口径)", () => {
    expect(
      channelOpenedTrackPayload(
        {
          channelType: ChannelTypePerson,
          channelID: "sa1b2c3d4e5f60718293a4b5c6d7e8f90_peer-uid",
        },
        true
      )
    ).toEqual({
      object_id: "sa1b2c3d4e5f60718293a4b5c6d7e8f90_peer-uid",
      channel_type: "person",
      is_ai: true,
    });
  });
});

// review P1-1/P2-1:is_ai 的运行时派生(原先内联在 ConversationList,恰是有 bug 且没被测的那段)。
describe("resolveAiPeer", () => {
  it("非私聊(群)→ false,且不查 isAiUid", () => {
    const isAiUid = vi.fn(() => true);
    expect(
      resolveAiPeer({ channelType: ChannelTypeGroup, channelID: "g1" }, undefined, isAiUid)
    ).toBe(false);
    expect(isAiUid).not.toHaveBeenCalled();
  });

  it("私聊 + channelInfo.robot===1 → true(用带前缀 channelInfo,短路不查 uid-list)", () => {
    const isAiUid = vi.fn(() => false);
    expect(
      resolveAiPeer(
        { channelType: ChannelTypePerson, channelID: "sa1b2c3d4e5f60718293a4b5c6d7e8f90_bot" },
        { orgData: { robot: 1 } },
        isAiUid
      )
    ).toBe(true);
    expect(isAiUid).not.toHaveBeenCalled();
  });

  it("私聊 + 无 robot flag + Space 前缀 channelID → 以 stripSpacePrefix 后的裸 uid 查 isAiUid(修 P1-1)", () => {
    const isAiUid = vi.fn((uid: string) => uid === "assistant-uid");
    const got = resolveAiPeer(
      { channelType: ChannelTypePerson, channelID: "sa1b2c3d4e5f60718293a4b5c6d7e8f90_assistant-uid" },
      undefined,
      isAiUid
    );
    // 关键:传给判据的是裸 uid,而非带前缀的 channelID(否则 octoAssistantUids.includes 恒 false)
    expect(isAiUid).toHaveBeenCalledWith("assistant-uid");
    expect(got).toBe(true);
  });

  it("私聊 + 无 robot + isAiUid 判否 → false", () => {
    const isAiUid = vi.fn(() => false);
    expect(
      resolveAiPeer({ channelType: ChannelTypePerson, channelID: "human-uid" }, undefined, isAiUid)
    ).toBe(false);
    expect(isAiUid).toHaveBeenCalledWith("human-uid");
  });
});
