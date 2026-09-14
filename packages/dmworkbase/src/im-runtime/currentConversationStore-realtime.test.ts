import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => {
  const spaceHandlers = new Set<(payload: any) => void>();
  const messageDeleteListeners: Array<(message: any, preMessage?: any) => void> = [];
  let _spaceRevision = 0;
  let _currentSpaceId = "";
  return {
    _spaceHandlers: spaceHandlers,
    messageDeleteListeners,
    shared: {
      get currentSpaceId() { return _currentSpaceId; },
      set currentSpaceId(value: string) {
        if (value !== _currentSpaceId) _spaceRevision++;
        _currentSpaceId = value;
      },
      get spaceRevision() { return _spaceRevision; },
      channelSpaceMap: new Map<string, string>(),
      channelMySourceSpaceMap: new Map<string, string>(),
      addMessageDeleteListener(listener: (m: any, p?: any) => void) { messageDeleteListeners.push(listener); },
      removeMessageDeleteListener: vi.fn(),
    },
    loginInfo: { uid: "user-a", token: "token-a", sessionRevision: 0 },
    apiClient: { config: { apiURL: "https://api.invalid", originRevision: 0 } },
    menus: { refresh: vi.fn() },
    mittBus: {
      on(ev: string, h: (p: any) => void) { if (ev === "space-changed") spaceHandlers.add(h); },
      off(ev: string, h: (p: any) => void) { if (ev === "space-changed") spaceHandlers.delete(h); },
      emit(ev: string, p?: any) { if (ev === "space-changed") spaceHandlers.forEach(f => f(p)); },
    },
  };
});

const space = vi.hoisted(() => ({
  skipChannel: vi.fn(() => false),
  skipPerson: vi.fn(() => false),
  hasPrefix: vi.fn(() => false),
  pinnedList: vi.fn(() => Promise.resolve([])),
  getSpaceFilteredLastMessage: vi.fn((c: any) => c.lastMessage),
}));

vi.mock("../App", () => ({ default: app }));
vi.mock("../Service/PinnedService", () => ({ default: { list: space.pinnedList } }));
vi.mock("../Service/SpaceService", () => ({
  shouldSkipChannelForSpace: space.skipChannel,
  shouldSkipPersonConversationForSpace: space.skipPerson,
  hasSpacePrefix: space.hasPrefix,
  getSpaceFilteredLastMessage: space.getSpaceFilteredLastMessage,
}));
vi.mock("../Service/ProhibitwordsService", () => ({
  ProhibitwordsService: { shared: { filter: (t: string) => t } },
}));
vi.mock("../Service/Thread", () => ({
  parseThreadChannelId: (id: string) => {
    const parts = id.split("____");
    return parts.length === 2 ? { groupNo: parts[0], shortId: parts[1] } : null;
  },
}));

import WKSDK, { Channel, ConnectStatus, Conversation, ConversationAction, Message } from "wukongimjssdk";
import { getCurrentImConversationStore } from "./currentConversationStore";
import { ConversationWrap } from "../Service/Model";

const sdk = WKSDK.shared();

function channel(id: string, type = 2): Channel { return new Channel(id, type); }
function conv(id: string, type = 2, extra: any = {}, ts = 100): Conversation {
  const item = new Conversation(); item.channel = channel(id, type); item.timestamp = ts; item.extra = extra; return item;
}
function wrap(c: Conversation): ConversationWrap { return new ConversationWrap(c); }

beforeEach(() => {
  app.shared.currentSpaceId = "";
  app.shared.spaceRevision;
  app.shared.channelSpaceMap.clear();
  app.shared.channelMySourceSpaceMap.clear();
  app.messageDeleteListeners.length = 0;
  app._spaceHandlers.clear();
  app.loginInfo.uid = "user-a";
  app.loginInfo.token = "token-a";
  app.loginInfo.sessionRevision++;
  app.apiClient.config.apiURL = "https://api.invalid";
  app.apiClient.config.originRevision++;
  app.menus.refresh = vi.fn();
  app.shared.removeMessageDeleteListener = vi.fn();
  space.skipChannel.mockReset().mockReturnValue(false);
  space.skipPerson.mockReset().mockReturnValue(false);
  space.hasPrefix.mockReset().mockReturnValue(false);
  space.pinnedList.mockReset().mockResolvedValue([]);
  space.getSpaceFilteredLastMessage.mockImplementation((c: any) => c.lastMessage);
  sdk.config.provider.syncConversationsCallback = async () => [];
  sdk.conversationManager.conversations = [];
  sdk.conversationManager.maxExtraVersion = 0;
  sdk.connectManager.status = ConnectStatus.Disconnect;
  vi.spyOn(sdk.channelManager, "getChannelInfo").mockReturnValue(undefined);
  vi.spyOn(sdk.channelManager, "fetchChannelInfo").mockResolvedValue(undefined);
  vi.spyOn(sdk.reminderManager, "sync").mockResolvedValue(undefined);
});

afterEach(() => {
  const s = getCurrentImConversationStore();
  if (!s.disposed) s.dispose();
  vi.restoreAllMocks();
});

describe("sync and realtime without a ChatVM", () => {
  it("syncs conversations through the provider", async () => {
    const items = [conv("g1"), conv("g2")];
    sdk.config.provider.syncConversationsCallback = async () => items;
    const store = getCurrentImConversationStore();
    store.retain();
    await store.refresh({ reload: true });

    expect(store.getSnapshot().freshness).toBe("ready");
    expect(store.loading).toBe(false);
    expect(store.conversations.map(c => c.channel.channelID).sort()).toEqual(["g1", "g2"]);
  });

  it("real-time add routes through the SDK listener into the store", () => {
    const store = getCurrentImConversationStore();
    store.retain();
    const added = conv("live-group", 2, { spaceId: "space-a" });
    app.shared.channelSpaceMap.set("live-group_2", "space-a");
    sdk.conversationManager.notifyConversationListeners(added, ConversationAction.add);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].channel.channelID).toBe("live-group");
  });

  it("keeps an added group pending until channelInfo resolves its Space", () => {
    app.shared.currentSpaceId = "space-a";
    const store = getCurrentImConversationStore();
    store.retain();
    const added = conv("new-group", 2, {});
    sdk.conversationManager.notifyConversationListeners(added, ConversationAction.add);
    expect(store.conversations).toHaveLength(0);
    const found = store.pendingSpaceConversations.get("new-group_2");
    expect(found).toBeTypeOf("object");
    expect(found).toBe(added);

    const info: any = { channel: channel("new-group"), orgData: { space_id: "space-a" } };
    sdk.channelManager.notifyListeners(info);
    expect(store.pendingSpaceConversations.size).toBe(0);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].channel.channelID).toBe("new-group");
  });
});


describe("realtime conversation handling", () => {
  it("removes foreign parent group and threads when channelInfo resolves", () => {
    const store = getCurrentImConversationStore();
    store.retain();
    const parent = conv("parent", 2, { spaceId: "space-a" });
    const thread = conv("parent____t1", 5);
    sdk.conversationManager.notifyConversationListeners(parent, ConversationAction.add);
    sdk.conversationManager.notifyConversationListeners(thread, ConversationAction.add);
    expect(store.conversations).toHaveLength(2);
    app.shared.channelSpaceMap.set("parent_2", "space-a");

    space.skipChannel.mockReturnValueOnce(true);
    const info: any = { channel: channel("parent"), orgData: { space_id: "space-other" } };
    sdk.channelManager.notifyListeners(info);

    expect(store.conversations).toEqual([]);
  });

  it("preserves a pinned thread through an ordinary update", () => {
    const store = getCurrentImConversationStore();
    store.retain();
    const thread = conv("parent____t1", 5, { top: 1 });
    sdk.conversationManager.notifyConversationListeners(thread, ConversationAction.add);
    app.shared.channelSpaceMap.set("parent_2", "space-a");

    const update = conv("parent____t1", 5, { top: 0 });
    sdk.conversationManager.notifyConversationListeners(update, ConversationAction.update);

    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].extra.top).toBe(1);
  });

  it("updates preview when last message is deleted", () => {
    const store = getCurrentImConversationStore();
    store.retain();
    const msgCh = channel("del-chan");
    const delConv = conv("del-chan", 2, { spaceId: "space-a" });
    const lastMsg = new Message();
    lastMsg.channel = msgCh;
    lastMsg.clientMsgNo = "delete-me";
    delConv.lastMessage = lastMsg;
    sdk.conversationManager.conversations = [delConv];
    const preMsg = new Message();
    preMsg.channel = msgCh;
    preMsg.clientMsgNo = "preview";

    app.messageDeleteListeners[0](lastMsg, preMsg);

    expect(delConv.lastMessage).toBe(preMsg);
  });
});

describe("utility methods", () => {
  it("findConversation returns matching or undefined", () => {
    const store = getCurrentImConversationStore();
    const items = [wrap(conv("a")), wrap(conv("b"))];
    store.conversations = items;
    expect(store.findConversation(new Channel("a", 2))).toBe(items[0]);
    expect(store.findConversation(new Channel("x", 2))).toBeUndefined();
  });

  it("removeConversation filters matching channel", () => {
    const store = getCurrentImConversationStore();
    const items = [wrap(conv("a")), wrap(conv("b"))];
    store.conversations = items;
    store.removeConversation(new Channel("a", 2));
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].channel.channelID).toBe("b");
  });

  it("sortConversations orders by timestamp descending, pinned first", () => {
    const store = getCurrentImConversationStore();
    const high = wrap(conv("a", 2, { top: 1 }, 200));
    const low = wrap(conv("b", 2, {}, 300));
    const mid = wrap(conv("c", 2, {}, 100));
    store.conversations = [low, mid, high];
    store.sortConversations();
    expect(store.conversations[0]).toBe(high);
    expect(store.conversations[1]).toBe(low);
    expect(store.conversations[2]).toBe(mid);
  });

  it("removeThreadsOfParent removes only matching sub-threads", () => {
    const store = getCurrentImConversationStore();
    const items = [
      wrap(conv("parent", 2)), wrap(conv("other", 2)),
      wrap(conv("parent____t1", 5)), wrap(conv("other____t1", 5)),
    ];
    store.conversations = items;
    store.removeThreadsOfParent("parent");
    expect(store.conversations.map(c => c.channel.channelID).sort()).toEqual([
      "other", "other____t1", "parent",
    ]);
  });

  it("getSnapshot provides current state", () => {
    const store = getCurrentImConversationStore();
    const snap = store.getSnapshot();
    expect(snap.conversations).toBe(store.conversations);
    expect(snap.loading).toBe(true);
    expect(snap.freshness).toBe("loading");
    expect(snap.revision).toBe(0);
  });
});
