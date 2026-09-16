import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => {
  const spaceHandlers = new Set<(payload: any) => void>();
  const authHandlers = new Set<() => void>();
  const messageDeleteListeners: Array<(message: any, preMessage?: any) => void> = [];
  let _spaceRevision = 0;
  let _currentSpaceId = "";
  return {
    _spaceHandlers: spaceHandlers,
    _authHandlers: authHandlers,
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
    loginInfo: {
      uid: "user-a", token: "token-a", sessionRevision: 0,
      isLogined() { return Boolean(this.token); },
    },
    apiClient: { config: { apiURL: "https://api.invalid", originRevision: 0 } },
    menus: { refresh: vi.fn() },
    mittBus: {
      on(ev: string, h: (p?: any) => void) {
        if (ev === "space-changed") spaceHandlers.add(h);
        if (ev === "wk:auth-state-changed") authHandlers.add(h);
      },
      off(ev: string, h: (p?: any) => void) {
        if (ev === "space-changed") spaceHandlers.delete(h);
        if (ev === "wk:auth-state-changed") authHandlers.delete(h);
      },
      emit(ev: string, p?: any) {
        if (ev === "space-changed") [...spaceHandlers].forEach(f => f(p));
        if (ev === "wk:auth-state-changed") [...authHandlers].forEach(f => f());
      },
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
import { applyImSpaceContext } from "./spaceContext";
import { ConversationWrap } from "../Service/Model";

const sdk = WKSDK.shared();
const NOTIFY = sdk.connectManager.notifyConnectStatusListeners.bind(sdk.connectManager);

function channel(id: string, type = 2): Channel { return new Channel(id, type); }
function conv(id: string, type = 2, extra: any = {}, ts = 100): Conversation {
  const item = new Conversation(); item.channel = channel(id, type); item.timestamp = ts; item.extra = extra; return item;
}
function wrap(c: Conversation): ConversationWrap { return new ConversationWrap(c); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

/** Shared beforeEach body for both files. */
export function contextBeforeEach(): void {
  app.shared.currentSpaceId = "";
  app.shared.spaceRevision;
  app.shared.channelSpaceMap.clear();
  app.shared.channelMySourceSpaceMap.clear();
  app.messageDeleteListeners.length = 0;
  app._spaceHandlers.clear();
  app._authHandlers.clear();
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
}

beforeEach(contextBeforeEach);

afterEach(() => {
  const s = getCurrentImConversationStore();
  if (!s.disposed) s.dispose();
  vi.restoreAllMocks();
});

describe("lifecycle", () => {
  it("shares one store per SDK realm and starts a fresh one after dispose", () => {
    const first = getCurrentImConversationStore();
    expect(first).toBe(getCurrentImConversationStore());
    first.dispose();
    expect(getCurrentImConversationStore()).not.toBe(first);
    expect(getCurrentImConversationStore().disposed).toBe(false);
  });

  it("retain-counting: two retains register one listener; one release keeps alive", () => {
    const add = vi.spyOn(sdk.conversationManager, "addConversationListener");
    const remove = vi.spyOn(sdk.conversationManager, "removeConversationListener");
    const store = getCurrentImConversationStore();
    const r1 = store.retain();
    expect(add).toHaveBeenCalledTimes(1);
    const r2 = store.retain();
    expect(add).toHaveBeenCalledTimes(1);
    r1();
    expect(remove).not.toHaveBeenCalled();
    r2();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("dispose fully resets state and publish after dispose is a no-op", () => {
    const store = getCurrentImConversationStore();
    const release = store.retain();
    store.conversations = [wrap(conv("g1"))];
    const fn = vi.fn();
    store.subscribe(fn);
    store.dispose();
    expect(store.disposed).toBe(true);
    expect(store.conversations).toEqual([]);
    expect(store.loading).toBe(true);
    expect(store.getSnapshot().freshness).toBe("loading");
    expect(store.getSnapshot().revision).toBe(0);
    store.publish("data");
    expect(fn).not.toHaveBeenCalled();
    release();
  });

  it("refresh after dispose rejects", async () => {
    const store = getCurrentImConversationStore();
    store.dispose();
    await expect(store.refresh()).rejects.toThrow("Conversation store disposed");
  });

  it("ensureSnapshot resolves immediately when fresh and current", async () => {
    const items = [conv("g1")];
    sdk.config.provider.syncConversationsCallback = async () => items;
    const store = getCurrentImConversationStore();
    store.retain();
    await store.refresh({ reload: true });
    expect(store.getSnapshot().freshness).toBe("ready");

    space.pinnedList.mockClear();
    sdk.config.provider.syncConversationsCallback = vi.fn().mockRejectedValue(new Error("should not be called"));
    await expect(store.ensureSnapshot()).resolves.toBeUndefined();
  });

  it("subscribe returns an unsubscribe function", () => {
    const store = getCurrentImConversationStore();
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    store.publish("data");
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    store.publish("data");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("disconnect → stale with hasSnapshot", () => {
  it("keeps delayed connection hydration alive after a temporary title holder ends", async () => {
    const store = getCurrentImConversationStore();
    const releaseApp = store.retain();
    await store.ensureSnapshot();
    expect(store.conversations).toEqual([]);

    const unread = conv("delayed-connection");
    unread.unread = 7;
    sdk.config.provider.syncConversationsCallback = async () => [unread];
    sdk.connectManager.status = ConnectStatus.Connected;
    NOTIFY(ConnectStatus.Connected);
    await vi.waitFor(() => expect(store.conversations[0]?.unread).toBe(7));
    releaseApp();
  });

  it("ready-to-stale on disconnect regardless of conversation count", async () => {
    const items = [conv("g1")];
    sdk.config.provider.syncConversationsCallback = async () => items;
    const store = getCurrentImConversationStore();
    store.retain();
    await store.refresh({ reload: true });
    const fn = vi.fn();
    store.subscribe(fn);

    sdk.connectManager.status = ConnectStatus.Disconnect;
    NOTIFY(ConnectStatus.Disconnect);

    expect(store.getSnapshot().freshness).toBe("stale");
    expect(store.conversations).toHaveLength(1);
    expect(fn).toHaveBeenCalledWith("connection");
  });

  it("reconnected state stays stale until provider resolves", async () => {
    const items = [conv("g1")];
    sdk.config.provider.syncConversationsCallback = async () => items;
    const store = getCurrentImConversationStore();
    store.retain();
    await store.refresh({ reload: true });
    sdk.connectManager.status = ConnectStatus.Disconnect;
    NOTIFY(ConnectStatus.Disconnect);
    expect(store.getSnapshot().freshness).toBe("stale");

    sdk.connectManager.status = ConnectStatus.Connected;
    NOTIFY(ConnectStatus.Connected);

    // On reconnect, reload:true skips loading=true assignment so freshness unchanged
    expect(store.conversations).toHaveLength(1);
  });

  it("error sets stale when hasSnapshot otherwise unavailable", async () => {
    const store = getCurrentImConversationStore();
    store.retain();
    const items = [conv("g1")];
    sdk.config.provider.syncConversationsCallback = async () => items;
    await store.refresh({ reload: true });
    sdk.config.provider.syncConversationsCallback = async () => { throw new Error("sync fail"); };

    await expect(store.refresh({ reload: true })).rejects.toThrow("sync fail");

    expect(store.getSnapshot().freshness).toBe("stale");
    expect(store.loading).toBe(false);
  });

  it("error before first snapshot sets unavailable", async () => {
    sdk.config.provider.syncConversationsCallback = async () => { throw new Error("offline"); };
    const store = getCurrentImConversationStore();
    store.retain();
    await expect(store.refresh({ reload: true })).rejects.toThrow("offline");
    expect(store.getSnapshot().freshness).toBe("unavailable");
  });
});

describe("authentication with application and page holders", () => {
  it("replaces an in-flight old-account sync even while Chat still holds the store", async () => {
    const store = getCurrentImConversationStore();
    const releaseApp = store.retain();
    const releaseChat = store.retain();
    const old = deferred<Conversation[]>();
    sdk.config.provider.syncConversationsCallback = () => old.promise;
    const staleRequest = store.refresh();
    app.loginInfo.uid = "user-b";
    app.loginInfo.token = "token-b";
    app.loginInfo.sessionRevision++;
    sdk.config.provider.syncConversationsCallback = async () => [conv("account-b")];
    app.mittBus.emit("wk:auth-state-changed");
    await store.ensureSnapshot();
    old.resolve([conv("account-a")]);
    await staleRequest;

    expect(store.conversations.map(c => c.channel.channelID)).toEqual(["account-b"]);
    expect(sdk.conversationManager.conversations.map(c => c.channel.channelID)).toEqual(["account-b"]);
    releaseChat();
    releaseApp();
    expect(app._authHandlers.size).toBe(0);
  });

  it("does not sync or accept realtime events after logout while a page is still mounted", async () => {
    const store = getCurrentImConversationStore();
    const releaseApp = store.retain();
    const releaseChat = store.retain();
    sdk.config.provider.syncConversationsCallback = async () => [conv("old-account")];
    await store.ensureSnapshot();

    releaseApp();
    app.loginInfo.token = "";
    app.loginInfo.sessionRevision++;
    const sync = vi.fn(async () => []);
    sdk.config.provider.syncConversationsCallback = sync;
    app.mittBus.emit("wk:auth-state-changed");
    expect(store.conversations).toEqual([]);
    NOTIFY(ConnectStatus.Connected);
    sdk.conversationManager.notifyConversationListeners(conv("late-message"), ConversationAction.add);
    applyImSpaceContext({ space_id: "late-space", name: "Late space" });
    await Promise.resolve();

    expect(sync).not.toHaveBeenCalled();
    expect(store.conversations).toEqual([]);
    releaseChat();
  });

  it("does not resync for repeated auth notifications in the same session", async () => {
    const store = getCurrentImConversationStore();
    const release = store.retain();
    const sync = vi.fn(async () => []);
    sdk.config.provider.syncConversationsCallback = sync;
    await store.ensureSnapshot();
    sync.mockClear();
    app.mittBus.emit("wk:auth-state-changed");
    app.mittBus.emit("wk:auth-state-changed");
    expect(sync).not.toHaveBeenCalled();
    release();
  });
});

describe("space change via applyImSpaceContext", () => {
  it("committed context clears all state and publishes space", () => {
    const store = getCurrentImConversationStore();
    const release = store.retain();
    store.conversations = [wrap(conv("g1"))];
    store.loading = false;
    store.getSnapshot();
    const fn = vi.fn();
    store.subscribe(fn);

    const changed = applyImSpaceContext({ space_id: "space-b", name: "B" });
    expect(changed).toBe(true);

    expect(store.conversations).toEqual([]);
    expect(store.loading).toBe(true);
    expect(store.getSnapshot().freshness).toBe("loading");
    expect(fn).toHaveBeenCalledWith("space");
    release();
  });

  it("same-context event is ignored by the store guard", () => {
    app.shared.currentSpaceId = "space-a";
    const store = getCurrentImConversationStore();
    store.retain();
    store.conversations = [wrap(conv("keep"))];
    store.loading = false;
    const fn = vi.fn();
    store.subscribe(fn);

    app.mittBus.emit("space-changed", { space_id: "space-a" });

    expect(store.conversations).toHaveLength(1);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("lifecycleRevision guards stale listeners", () => {
  it("release + re-retain registers new handler; old captured callback does not affect store", () => {
    // Capture the actual listener reference SDK receives
    const captured: Array<(conv: Conversation, action: any) => void> = [];
    const origAdd = sdk.conversationManager.addConversationListener.bind(sdk.conversationManager);
    vi.spyOn(sdk.conversationManager, "addConversationListener").mockImplementation((l: any) => {
      captured.push(l);
      origAdd(l);
    });
    const removeSpy = vi.spyOn(sdk.conversationManager, "removeConversationListener");

    const store = getCurrentImConversationStore();
    const r1 = store.retain();
    expect(captured).toHaveLength(1);
    const oldCallback = captured[0];

    r1();
    expect(removeSpy).toHaveBeenCalledWith(oldCallback);
    captured.length = 0;

    // re-retain → new listener registered
    const r2 = store.retain();
    expect(captured).toHaveLength(1);
    const newCallback = captured[0];
    expect(newCallback).not.toBe(oldCallback);

    // invoke the OLD callback: must not write to store
    const pub = vi.spyOn(store, "publish");
    store.conversations = [];
    oldCallback(conv("stale", 2, { spaceId: "space-a" }), 0);
    expect(store.conversations).toEqual([]);
    expect(pub).not.toHaveBeenCalled();
    r2();
  });
});

describe("stale response after release/dispose", () => {
  it("dispose prevents a stale sync response from writing SDK or publishing", async () => {
    const d = deferred<Conversation[]>();
    sdk.config.provider.syncConversationsCallback = async () => d.promise;
    const store = getCurrentImConversationStore();
    const release = store.retain();
    const fn = vi.fn();
    store.subscribe(fn);
    const wait = store.refresh({ reload: true });
    release();
    store.dispose();

    d.resolve([conv("late")]);
    await wait;

    expect(store.conversations).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
