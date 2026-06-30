import { beforeEach, describe, expect, it, vi } from "vitest";

const channelManager = vi.hoisted(() => ({
  getChannelInfo: vi.fn(),
  setChannleInfoForCache: vi.fn(),
  notifyListeners: vi.fn(),
  fetchChannelInfo: vi.fn(),
}));

vi.mock("wukongimjssdk", () => {
  const ChannelTypePerson = 1;
  const ChannelTypeGroup = 2;
  class Channel {
    channelID: string;
    channelType: number;
    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  }
  class ChannelInfo {}
  const sdk = { shared: () => ({ channelManager }) };
  return {
    default: sdk,
    WKSDK: sdk,
    Channel,
    ChannelInfo,
    ChannelTypePerson,
    ChannelTypeGroup,
  };
});

import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { buildThreadChannelId } from "../../Service/Thread";
import {
  GroupStatusDisband,
  GroupStatusNormal,
  isGroupDisbanded,
  isChannelDisbanded,
  isConversationDisbanded,
  syncGroupDisbandState,
} from "../groupDisband";

function infoWithStatus(status?: number) {
  return { orgData: status === undefined ? {} : { status } } as any;
}

describe("groupDisband helpers", () => {
  beforeEach(() => {
    channelManager.getChannelInfo.mockReset();
    channelManager.setChannleInfoForCache.mockReset();
    channelManager.notifyListeners.mockReset();
    channelManager.fetchChannelInfo.mockReset();
  });

  describe("isGroupDisbanded", () => {
    it("true only when status === Disband(2)", () => {
      expect(isGroupDisbanded(infoWithStatus(GroupStatusDisband))).toBe(true);
      expect(isGroupDisbanded(infoWithStatus(GroupStatusNormal))).toBe(false);
      expect(isGroupDisbanded(infoWithStatus(undefined))).toBe(false);
      expect(isGroupDisbanded(null)).toBe(false);
      expect(isGroupDisbanded(undefined)).toBe(false);
    });
  });

  describe("isChannelDisbanded", () => {
    it("true for disbanded group channel", () => {
      channelManager.getChannelInfo.mockReturnValue(
        infoWithStatus(GroupStatusDisband)
      );
      const ch = new Channel("g1", ChannelTypeGroup);
      expect(isChannelDisbanded(ch)).toBe(true);
    });

    it("false for normal group / non-group / null", () => {
      channelManager.getChannelInfo.mockReturnValue(
        infoWithStatus(GroupStatusNormal)
      );
      expect(isChannelDisbanded(new Channel("g1", ChannelTypeGroup))).toBe(
        false
      );
      // person channel: never disbanded, must not even query
      expect(isChannelDisbanded(new Channel("u1", 1))).toBe(false);
      expect(isChannelDisbanded(null)).toBe(false);
    });

    it("fail-open when cache misses (returns false, does not lock)", () => {
      channelManager.getChannelInfo.mockReturnValue(undefined);
      expect(isChannelDisbanded(new Channel("g1", ChannelTypeGroup))).toBe(
        false
      );
    });
  });

  describe("isConversationDisbanded", () => {
    it("group conversation follows its own status", () => {
      channelManager.getChannelInfo.mockReturnValue(
        infoWithStatus(GroupStatusDisband)
      );
      expect(
        isConversationDisbanded(new Channel("g1", ChannelTypeGroup))
      ).toBe(true);
    });

    it("topic(子区) conversation follows PARENT group status", () => {
      // getChannelInfo is called with the parent group channel; return disbanded
      channelManager.getChannelInfo.mockImplementation((ch: Channel) => {
        if (ch.channelID === "g1" && ch.channelType === ChannelTypeGroup) {
          return infoWithStatus(GroupStatusDisband);
        }
        return undefined;
      });
      const topicId = buildThreadChannelId("g1", "t99");
      const topic = new Channel(topicId, ChannelTypeCommunityTopic);
      expect(isConversationDisbanded(topic)).toBe(true);
      // confirm it resolved the parent group, not the topic channel
      const queried = channelManager.getChannelInfo.mock.calls.map(
        (c: any[]) => c[0].channelID
      );
      expect(queried).toContain("g1");
    });

    it("topic with normal parent → not disbanded", () => {
      channelManager.getChannelInfo.mockReturnValue(
        infoWithStatus(GroupStatusNormal)
      );
      const topic = new Channel(
        buildThreadChannelId("g1", "t99"),
        ChannelTypeCommunityTopic
      );
      expect(isConversationDisbanded(topic)).toBe(false);
    });

    it("null / person channel → false", () => {
      expect(isConversationDisbanded(null)).toBe(false);
      expect(isConversationDisbanded(new Channel("u1", 1))).toBe(false);
    });
  });

  describe("syncGroupDisbandState", () => {
    it("group with live cache: writes status=Disband locally + notifies, no fetch (dodges dedup race)", () => {
      const info = infoWithStatus(GroupStatusNormal);
      channelManager.getChannelInfo.mockReturnValue(info);

      syncGroupDisbandState(new Channel("g1", ChannelTypeGroup));

      expect(info.orgData.status).toBe(GroupStatusDisband);
      expect(channelManager.setChannleInfoForCache).toHaveBeenCalledWith(info);
      expect(channelManager.notifyListeners).toHaveBeenCalledWith(info);
      // 关键：群有缓存时不走 fetchChannelInfo，避免在途旧请求覆盖回 Normal。
      expect(channelManager.fetchChannelInfo).not.toHaveBeenCalled();
    });

    it("group without live cache: falls back to fetchChannelInfo", () => {
      channelManager.getChannelInfo.mockReturnValue(undefined);

      syncGroupDisbandState(new Channel("g1", ChannelTypeGroup));

      expect(channelManager.fetchChannelInfo).toHaveBeenCalledTimes(1);
      expect(channelManager.setChannleInfoForCache).not.toHaveBeenCalled();
    });

    it("non-group channel (person/topic): falls through to fetchChannelInfo, no local write", () => {
      const person = new Channel("u1", 1);
      syncGroupDisbandState(person);
      expect(channelManager.fetchChannelInfo).toHaveBeenCalledWith(person);

      const topic = new Channel(buildThreadChannelId("g1", "t1"), ChannelTypeCommunityTopic);
      syncGroupDisbandState(topic);
      expect(channelManager.fetchChannelInfo).toHaveBeenCalledWith(topic);

      // 非群频道不做本地直写。
      expect(channelManager.setChannleInfoForCache).not.toHaveBeenCalled();
      expect(channelManager.notifyListeners).not.toHaveBeenCalled();
    });

    it("no channelID: no-op", () => {
      syncGroupDisbandState(new Channel("", ChannelTypeGroup));
      expect(channelManager.fetchChannelInfo).not.toHaveBeenCalled();
      expect(channelManager.setChannleInfoForCache).not.toHaveBeenCalled();
    });
  });
});
