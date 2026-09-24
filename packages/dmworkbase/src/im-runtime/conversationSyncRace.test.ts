import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKSDK, { Channel, ChannelInfo, Conversation, ConversationAction, ConnectStatus } from "wukongimjssdk";

const state = vi.hoisted(() => ({
  app: {
    shared: {
      currentSpaceId: "space-a", spaceRevision: 0,
      channelSpaceMap: new Map<string, string>(), channelMySourceSpaceMap: new Map<string, string>(),
      addMessageDeleteListener: vi.fn(), removeMessageDeleteListener: vi.fn(),
    },
    loginInfo: { uid: "user-a", token: "token", sessionRevision: 0 },
    apiClient: { config: { apiURL: "https://api.invalid", originRevision: 0 } },
    mittBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    menus: { refresh: vi.fn() },
  },
  pins: vi.fn(),
}));
vi.mock("../App", () => ({ default: state.app }));
vi.mock("../Service/PinnedService", () => ({ default: { list: state.pins } }));
vi.mock("../Service/Model", () => ({
  ConversationWrap: class {
    constructor(public conversation: Conversation) {}
    get channel() { return this.conversation.channel; }
    get timestamp() { return this.conversation.timestamp; }
    get extra() { return this.conversation.extra || (this.conversation.extra = {}); }
    get lastMessage() { return this.conversation.lastMessage; }
  },
}));
vi.mock("../Service/SpaceService", () => ({
  shouldSkipChannelForSpace: (channel: Channel) => (
    channel.channelType === 2 && state.app.shared.channelSpaceMap.get(`${channel.channelID}_2`) !== "space-a"
  ),
  shouldSkipPersonConversationForSpace: () => false,
  hasSpacePrefix: () => false,
}));
vi.mock("../Service/ProhibitwordsService", () => ({
  ProhibitwordsService: { shared: { filter: (text: string) => text } },
}));
vi.mock("../Service/Thread", () => ({ parseThreadChannelId: () => undefined }));

import { getCurrentImConversationStore } from "./currentConversationStore";
import { spaceUnreadStore } from "../features/space-unread/store";

const sdk = WKSDK.shared();
const query = vi.fn<() => Promise<Conversation[]>>();

function conversation(id: string, type = 1): Conversation {
  const item = new Conversation();
  item.channel = new Channel(id, type);
  item.extra = {};
  return item;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => {
  spaceUnreadStore.reset();
  state.app.shared.spaceRevision++;
  state.app.shared.channelSpaceMap.clear();
  state.pins.mockReset().mockResolvedValue([]);
  state.app.mittBus.emit.mockClear();
  query.mockReset().mockResolvedValue([]);
  sdk.config.provider.syncConversationsCallback = query;
  sdk.conversationManager.conversations = [];
  sdk.conversationManager.maxExtraVersion = 0;
  sdk.connectManager.status = ConnectStatus.Disconnect;
  vi.spyOn(sdk.channelManager, "fetchChannelInfo").mockResolvedValue(undefined);
  vi.spyOn(sdk.reminderManager, "sync").mockResolvedValue(undefined);
});
afterEach(() => {
  getCurrentImConversationStore().dispose();
  vi.restoreAllMocks();
});

describe("conversation sync / realtime ordering", () => {
  it("commits the Space unread sideband with the accepted conversation snapshot", async () => {
    const synced = [conversation("seeded")] as Conversation[] & { spaceUnreads?: Record<string, number> };
    synced.spaceUnreads = { "space-b": 7 };
    query.mockResolvedValue(synced);
    const store = getCurrentImConversationStore();
    store.retain();

    await store.refresh({ reload: true });

    expect(spaceUnreadStore.getSnapshot().totalBySpace).toEqual({ "space-b": 7 });
  });

  it("commits conversations once while preserving a Space changed by realtime", async () => {
    const response = deferred<Conversation[]>();
    query.mockReturnValueOnce(response.promise);
    const store = getCurrentImConversationStore();
    store.retain();
    const waiting = store.refresh({ reload: true });

    spaceUnreadStore.recordIncoming("space-b", "live-message");
    const synced = [conversation("accepted")] as Conversation[] & {
      spaceUnreads?: Record<string, number>;
    };
    Object.defineProperty(synced, "spaceUnreads", {
      value: { "space-b": 7 },
      enumerable: false,
    });
    response.resolve(synced);
    await waiting;

    expect(query).toHaveBeenCalledTimes(1);
    expect(sdk.conversationManager.conversations).toEqual(synced);
    expect(store.conversations.map(({ channel }) => channel.channelID)).toEqual(["accepted"]);
    expect(store.loading).toBe(false);
    expect(store.freshness).toBe("ready");
    expect(spaceUnreadStore.getSnapshot().totalBySpace).toEqual({ "space-b": 7 });
    expect(spaceUnreadStore.getSnapshot().newBySpace).toEqual({ "space-b": 1 });
  });

  it("applies other Space totals when current-Space calibration races the sync", async () => {
    const response = deferred<Conversation[]>();
    query.mockReturnValueOnce(response.promise);
    const store = getCurrentImConversationStore();
    store.retain();
    const waiting = store.refresh({ reload: true });

    spaceUnreadStore.setTotal("space-a", 4);
    const synced = [conversation("accepted")] as Conversation[] & {
      spaceUnreads?: Record<string, number>;
    };
    Object.defineProperty(synced, "spaceUnreads", {
      value: { "space-a": 2, "space-b": 7 },
      enumerable: false,
    });
    response.resolve(synced);
    await waiting;

    expect(query).toHaveBeenCalledTimes(1);
    expect(store.conversations.map(({ channel }) => channel.channelID)).toEqual(["accepted"]);
    expect(spaceUnreadStore.getSnapshot().totalBySpace).toEqual({
      "space-a": 4,
      "space-b": 7,
    });
  });

  it("does not overwrite live additions, updates or deletions with an older HTTP snapshot", async () => {
    const response = deferred<Conversation[]>();
    const reconciled = deferred<Conversation[]>();
    const pins = deferred<never[]>();
    query.mockReturnValueOnce(response.promise).mockReturnValueOnce(reconciled.promise);
    state.pins.mockReturnValueOnce(pins.promise);
    const store = getCurrentImConversationStore();
    store.retain();
    const before = [conversation("before")];
    sdk.conversationManager.conversations = before;
    const waiting = store.refresh({ reload: true });

    const newer = conversation("updated");
    newer.unread = 7;
    const added = conversation("added");
    const removed = conversation("removed");
    sdk.conversationManager.notifyConversationListeners(newer, ConversationAction.update);
    sdk.conversationManager.notifyConversationListeners(added, ConversationAction.add);
    sdk.conversationManager.notifyConversationListeners(removed, ConversationAction.remove);
    response.resolve([conversation("updated"), removed]);
    await Promise.resolve();
    await Promise.resolve();
    expect(sdk.conversationManager.conversations).toBe(before);
    expect(sdk.reminderManager.sync).not.toHaveBeenCalled();

    pins.resolve([]);
    reconciled.resolve([newer, added]);
    await waiting;
    expect(sdk.conversationManager.conversations).toEqual([newer, added]);
    expect(store.conversations.map(({ channel }) => channel.channelID).sort()).toEqual(["added", "updated"]);
    expect(sdk.reminderManager.sync).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("retains a new unresolved group until channel info arrives after sync", async () => {
    const response = deferred<Conversation[]>();
    query.mockReturnValueOnce(response.promise);
    const store = getCurrentImConversationStore();
    store.retain();
    const waiting = store.refresh({ reload: true });
    const pending = conversation("new-group", 2);
    sdk.conversationManager.notifyConversationListeners(pending, ConversationAction.add);
    response.resolve([]);
    await waiting;
    expect(store.conversations).toEqual([]);
    expect(store.pendingSpaceConversations.get("new-group_2")).toBe(pending);

    const info = new ChannelInfo();
    info.channel = pending.channel;
    info.orgData = { space_id: "space-a" };
    sdk.channelManager.setChannleInfoForCache(info);
    sdk.channelManager.notifyListeners(info);
    expect(store.pendingSpaceConversations.size).toBe(0);
    expect(store.conversations[0].conversation).toBe(pending);
    expect(sdk.conversationManager.findConversation(pending.channel)).toBe(pending);
  });

  it("does not resurrect a pending group removed before its metadata arrives", async () => {
    const response = deferred<Conversation[]>();
    query.mockReturnValueOnce(response.promise);
    const store = getCurrentImConversationStore();
    store.retain();
    const waiting = store.refresh({ reload: true });
    const pending = conversation("removed-pending", 2);
    sdk.conversationManager.notifyConversationListeners(pending, ConversationAction.add);
    sdk.conversationManager.notifyConversationListeners(pending, ConversationAction.remove);
    response.resolve([]);
    await waiting;
    const info = new ChannelInfo();
    info.channel = pending.channel;
    info.orgData = { space_id: "space-a" };
    sdk.channelManager.notifyListeners(info);
    expect(store.pendingSpaceConversations.size).toBe(0);
    expect(store.conversations).toEqual([]);
  });

  it("rejects stale channel conversion and re-reads authoritative state", async () => {
    const response = deferred<Conversation[]>();
    query.mockReturnValueOnce(response.promise);
    const store = getCurrentImConversationStore();
    store.retain();
    const waiting = store.refresh({ reload: true });
    const group = conversation("muted-group", 2);
    const newer = new ChannelInfo();
    newer.channel = group.channel;
    newer.orgData = { space_id: "space-a" };
    newer.mute = true;
    newer.top = true;
    sdk.channelManager.setChannleInfoForCache(newer);
    sdk.channelManager.notifyListeners(newer);
    // The real datasource checks canCommit before its conversion/cache writes.
    // A conflicting response must be retried, not merged with a stale SDK object.
    const authoritative = conversation("muted-group", 2);
    authoritative.extra.top = 1;
    query.mockResolvedValue([authoritative]);
    response.resolve([group]);
    await waiting;
    expect(sdk.channelManager.getChannelInfo(group.channel)).toBe(newer);
    expect(state.app.shared.channelSpaceMap.get("muted-group_2")).toBe("space-a");
    expect(store.conversations[0].extra.top).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not commit a prepared snapshot when the last owner leaves while waiting for pins", async () => {
    const pins = deferred<never[]>();
    state.pins.mockReturnValueOnce(pins.promise);
    query.mockResolvedValueOnce([conversation("late")]);
    const store = getCurrentImConversationStore();
    const release = store.retain();
    const waiting = store.refresh({ reload: true });
    await Promise.resolve();
    await Promise.resolve();
    release();
    pins.resolve([]);
    await waiting;
    expect(sdk.conversationManager.conversations).toEqual([]);
    expect(store.conversations).toEqual([]);
    expect(sdk.reminderManager.sync).not.toHaveBeenCalled();
    expect(state.app.mittBus.emit).not.toHaveBeenCalledWith("conversation-list-refreshed");
  });
});
