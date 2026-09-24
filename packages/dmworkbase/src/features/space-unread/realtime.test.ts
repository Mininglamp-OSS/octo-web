import { beforeEach, describe, expect, it, vi } from "vitest";
import { Channel, ChannelInfo, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import { ChannelTypeCommunityTopic, MessageContentTypeConst } from "../../Service/Const";
import { ThreadStatus } from "../../Service/Thread";

const state = vi.hoisted(() => ({
  app: {
    shared: {
      currentSpaceId: "space-a",
      channelSpaceMap: new Map<string, string>(),
      channelMySourceSpaceMap: new Map<string, string>(),
    },
    loginInfo: { uid: "me" },
  },
  channelInfo: new Map<string, any>(),
}));

vi.mock("../../App", () => ({ default: state.app }));
vi.mock("../../im-runtime/channelRuntime", () => ({
  getImChannelInfo: (_sdk: unknown, channel: Channel) => state.channelInfo.get(channel.getChannelKey()),
}));
import { recordIncomingSpaceUnread, resolveIncomingMessageSpaceId } from "./realtime";
import { spaceUnreadStore } from "./store";

function message(channel: Channel, id: string, spaceId?: string): any {
  return {
    channel,
    messageID: id,
    messageSeq: 1,
    fromUID: "other",
    send: false,
    header: { reddot: true, noPersist: false },
    content: { contentObj: spaceId ? { space_id: spaceId } : {} },
  };
}

function cacheChannelInfo(channel: Channel, mute: boolean, orgData: Record<string, unknown> = {}) {
  const info = new ChannelInfo();
  info.channel = channel;
  info.mute = mute;
  info.orgData = orgData;
  state.channelInfo.set(channel.getChannelKey(), info);
}

beforeEach(() => {
  spaceUnreadStore.reset();
  state.app.shared.currentSpaceId = "space-a";
  state.app.shared.channelSpaceMap.clear();
  state.app.shared.channelMySourceSpaceMap.clear();
  state.channelInfo.clear();
});

describe("cross-Space realtime unread", () => {
  it("resolves person, external group and thread messages to their effective Space", () => {
    expect(resolveIncomingMessageSpaceId(message(new Channel("peer", ChannelTypePerson), "p1", "space-b")))
      .toBe("space-b");

    spaceUnreadStore.replaceMemberships([{
      channel_id: "group",
      space_id: "space-remote",
      my_source_space_id: "space-b",
    }]);
    expect(resolveIncomingMessageSpaceId(message(new Channel("group", ChannelTypeGroup), "g1")))
      .toBe("space-b");
    expect(resolveIncomingMessageSpaceId(message(new Channel("group____topic", ChannelTypeCommunityTopic), "t1")))
      .toBe("space-b");
  });

  it("uses the existing external-group source mapping when the membership sideband is absent", () => {
    const parent = new Channel("external-group", ChannelTypeGroup);
    const thread = new Channel("external-group____topic", ChannelTypeCommunityTopic);
    state.app.shared.channelMySourceSpaceMap.set(
      `external-group_${ChannelTypeGroup}`,
      "space-a",
    );
    cacheChannelInfo(parent, false, { space_id: "space-remote" });

    expect(spaceUnreadStore.getGroupSpaceId("external-group")).toBeUndefined();
    expect(resolveIncomingMessageSpaceId(message(parent, "external-group-message"))).toBe("space-a");
    expect(resolveIncomingMessageSpaceId(message(thread, "external-thread-message"))).toBe("space-a");
    expect(recordIncomingSpaceUnread(message(parent, "external-group-message"))).toBe(false);
    expect(recordIncomingSpaceUnread(message(thread, "external-thread-message"))).toBe(false);
    expect(spaceUnreadStore.getSnapshot().newBySpace).toEqual({});
  });

  it("uses a channel Space prefix when the message payload omits space_id", () => {
    const spaceId = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const channel = new Channel(`s${spaceId}_peer`, ChannelTypePerson);
    cacheChannelInfo(channel, false);

    const incoming = message(channel, "prefixed-person");
    expect(resolveIncomingMessageSpaceId(incoming)).toBe(spaceId);
    expect(recordIncomingSpaceUnread(incoming)).toBe(true);
    expect(spaceUnreadStore.getSnapshot().newBySpace).toEqual({ [spaceId]: 1 });
  });

  it("counts only unread, non-current and non-muted messages once", () => {
    const foreign = message(new Channel("peer", ChannelTypePerson), "m1", "space-b");
    cacheChannelInfo(foreign.channel, false);
    expect(recordIncomingSpaceUnread(foreign)).toBe(true);
    expect(recordIncomingSpaceUnread(foreign)).toBe(false);

    const current = message(new Channel("peer", ChannelTypePerson), "m2", "space-a");
    expect(recordIncomingSpaceUnread(current)).toBe(false);

    const noRedDot = message(new Channel("peer", ChannelTypePerson), "m3", "space-b");
    noRedDot.header.reddot = false;
    expect(recordIncomingSpaceUnread(noRedDot)).toBe(false);

    const muted = message(new Channel("muted-peer", ChannelTypePerson), "m4", "space-b");
    cacheChannelInfo(muted.channel, true);
    expect(recordIncomingSpaceUnread(muted)).toBe(false);

    expect(spaceUnreadStore.getSnapshot().totalBySpace).toEqual({ "space-b": 1 });
    expect(spaceUnreadStore.getSnapshot().newBySpace).toEqual({ "space-b": 1 });
  });

  it("does not guess that a channel is unmuted when its metadata is missing", () => {
    const unknown = message(new Channel("unknown", ChannelTypeGroup), "m1");
    spaceUnreadStore.replaceMemberships([{ channel_id: "unknown", space_id: "space-b" }]);

    expect(recordIncomingSpaceUnread(unknown)).toBe(false);
    expect(spaceUnreadStore.getSnapshot().newBySpace).toEqual({});
  });

  it("excludes RTC signalling and known non-active threads", () => {
    const peer = new Channel("peer", ChannelTypePerson);
    cacheChannelInfo(peer, false);
    const rtc = message(peer, "rtc", "space-b");
    rtc.contentType = MessageContentTypeConst.rtcData;
    expect(recordIncomingSpaceUnread(rtc)).toBe(false);

    const parent = new Channel("group", ChannelTypeGroup);
    const thread = new Channel("group____topic", ChannelTypeCommunityTopic);
    cacheChannelInfo(parent, false);
    cacheChannelInfo(thread, false, { thread: { status: ThreadStatus.Archived } });
    spaceUnreadStore.replaceMemberships([{ channel_id: "group", space_id: "space-b" }]);
    expect(recordIncomingSpaceUnread(message(thread, "archived-thread"))).toBe(false);

    cacheChannelInfo(thread, false, { thread: { status: ThreadStatus.Deleted } });
    expect(recordIncomingSpaceUnread(message(thread, "deleted-thread"))).toBe(false);
    expect(spaceUnreadStore.getSnapshot().newBySpace).toEqual({});
  });

  it("uses the parent mute state for a thread even when thread metadata is not cached", () => {
    const parent = new Channel("group", ChannelTypeGroup);
    cacheChannelInfo(parent, false);
    spaceUnreadStore.replaceMemberships([{ channel_id: "group", space_id: "space-b" }]);

    expect(recordIncomingSpaceUnread(
      message(new Channel("group____topic", ChannelTypeCommunityTopic), "thread-message"),
    )).toBe(true);
    expect(spaceUnreadStore.getSnapshot().newBySpace).toEqual({ "space-b": 1 });

    cacheChannelInfo(parent, true);
    expect(recordIncomingSpaceUnread(
      message(new Channel("group____other", ChannelTypeCommunityTopic), "muted-thread-message"),
    )).toBe(false);
  });
});
