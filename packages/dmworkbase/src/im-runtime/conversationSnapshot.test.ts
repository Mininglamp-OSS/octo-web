import { beforeEach, describe, expect, it, vi } from "vitest";
import { Channel, ChannelInfo, Conversation } from "wukongimjssdk";

const mocks = vi.hoisted(() => ({
  channelSpaceMap: new Map<string, string>(),
  channelMySourceSpaceMap: new Map<string, string>(),
  getChannelInfo: vi.fn<(channel: Channel) => ChannelInfo | undefined>(),
  skipChannel: vi.fn<(channel: Channel) => boolean>(),
  skipPerson: vi.fn<(conversation: Conversation) => boolean>(),
  filterText: vi.fn((text: string) => text),
  sdkConversations: [] as Conversation[],
  sync: vi.fn(),
}));

vi.mock("wukongimjssdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wukongimjssdk")>();
  return {
    ...actual,
    default: {
      shared: () => ({
        channelManager: { getChannelInfo: mocks.getChannelInfo },
        conversationManager: { conversations: mocks.sdkConversations, sync: mocks.sync },
      }),
    },
  };
});
vi.mock("../App", () => ({
  default: {
    shared: {
      channelSpaceMap: mocks.channelSpaceMap,
      channelMySourceSpaceMap: mocks.channelMySourceSpaceMap,
    },
  },
}));
vi.mock("../Service/SpaceService", () => ({
  shouldSkipChannelForSpace: mocks.skipChannel,
  shouldSkipPersonConversationForSpace: mocks.skipPerson,
}));
vi.mock("../Service/Thread", () => ({
  parseThreadChannelId: (id: string) => {
    const [groupNo, shortId] = id.split("____");
    return shortId ? { groupNo, shortId } : null;
  },
}));
vi.mock("../Service/ProhibitwordsService", () => ({
  ProhibitwordsService: { shared: { filter: mocks.filterText } },
}));

import { applyPinnedThreadSnapshot, prepareCurrentImConversationSnapshot } from "./conversationSnapshot";

function conversation(id: string, type = 2, extra = {}): Conversation {
  const item = new Conversation();
  item.channel = new Channel(id, type);
  item.extra = extra;
  return item;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.channelSpaceMap.clear();
  mocks.channelMySourceSpaceMap.clear();
  mocks.sdkConversations.length = 0;
  mocks.skipChannel.mockReturnValue(false);
  mocks.skipPerson.mockReturnValue(false);
});

describe("conversation snapshot preparation without a ChatVM", () => {
  it("accepts missing or empty sync data without cache side effects", () => {
    expect(prepareCurrentImConversationSnapshot(undefined, undefined)).toEqual([]);
    expect(prepareCurrentImConversationSnapshot([], [])).toEqual([]);
    expect(mocks.getChannelInfo).not.toHaveBeenCalled();
    expect(mocks.channelSpaceMap.size).toBe(0);
  });

  it("applies authoritative pin state only to threads and preserves unavailable snapshots", () => {
    const group = conversation("group", 2, { top: 1 });
    const thread = conversation("group____thread", 5, { top: 1 });
    applyPinnedThreadSnapshot([group, thread], undefined);
    expect(thread.extra.top).toBe(1);
    applyPinnedThreadSnapshot([group, thread], []);
    expect(group.extra.top).toBe(1);
    expect(thread.extra.top).toBe(0);
    applyPinnedThreadSnapshot([thread], [{ channel_id: thread.channel.channelID, channel_type: 5, sort_order: 1 }]);
    expect(thread.extra.top).toBe(1);
  });

  it("fills group Space mappings before shared filters run", () => {
    const group = conversation("group", 2, { spaceId: "space", mySourceSpaceId: "source" });
    mocks.skipChannel.mockImplementation(() => {
      expect(mocks.channelSpaceMap.get("group_2")).toBe("space");
      expect(mocks.channelMySourceSpaceMap.get("group_2")).toBe("source");
      return false;
    });

    expect(prepareCurrentImConversationSnapshot([group], undefined)).toEqual([group]);
  });

  it("fills missing parent mappings from thread sync data", () => {
    const thread = conversation("group____thread", 5, { spaceId: "space", mySourceSpaceId: "source" });
    prepareCurrentImConversationSnapshot([thread], []);

    expect(mocks.channelSpaceMap.get("group_2")).toBe("space");
    expect(mocks.channelMySourceSpaceMap.get("group_2")).toBe("source");
    expect(mocks.channelSpaceMap.has("group____thread_5")).toBe(false);
  });

  it("does not overwrite known parent mappings with thread data", () => {
    mocks.channelSpaceMap.set("group_2", "known");
    mocks.channelMySourceSpaceMap.set("group_2", "known-source");
    const thread = conversation("group____thread", 5, { spaceId: "other", mySourceSpaceId: "other-source" });
    prepareCurrentImConversationSnapshot([thread], []);

    expect(mocks.channelSpaceMap.get("group_2")).toBe("known");
    expect(mocks.channelMySourceSpaceMap.get("group_2")).toBe("known-source");
  });

  it("uses channel-info fallback for legacy group sync without Space fields", () => {
    const group = conversation("legacy-group");
    const info = new ChannelInfo();
    info.channel = group.channel;
    info.orgData = { space_id: "legacy-space" };
    mocks.getChannelInfo.mockReturnValue(info);
    prepareCurrentImConversationSnapshot([group], undefined);

    expect(mocks.channelSpaceMap.get("legacy-group_2")).toBe("legacy-space");
    expect(mocks.channelMySourceSpaceMap.size).toBe(0);
  });

  it("filters rejected groups and people without cloning accepted SDK models", () => {
    const group = conversation("rejected-group");
    const person = conversation("rejected-person", 1);
    const accepted = conversation("accepted");
    mocks.skipChannel.mockImplementation((channel) => channel === group.channel);
    mocks.skipPerson.mockImplementation((item) => item === person);

    const snapshot = prepareCurrentImConversationSnapshot([group, person, accepted], []);

    expect(snapshot).toEqual([accepted]);
    expect(snapshot[0]).toBe(accepted);
    expect(mocks.skipPerson).not.toHaveBeenCalledWith(group);
  });

  it("leaves SDK sync and cache commit under caller ownership", () => {
    const existing = conversation("existing");
    mocks.sdkConversations.push(existing);
    const next = conversation("next");

    expect(prepareCurrentImConversationSnapshot([next], [])).toEqual([next]);
    expect(mocks.sdkConversations).toEqual([existing]);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
