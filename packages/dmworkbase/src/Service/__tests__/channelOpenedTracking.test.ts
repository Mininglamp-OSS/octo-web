import { describe, expect, it } from "vitest";
import { ChannelTypePerson, ChannelTypeGroup } from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../Const";
import { channelOpenedTrackPayload } from "../channelOpenedTracking";

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
