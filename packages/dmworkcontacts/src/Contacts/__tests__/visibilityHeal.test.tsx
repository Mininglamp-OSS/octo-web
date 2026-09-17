import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Reproduces the tester scenario for the AI online green dot on the Contacts page:
// the server marks an AI online but sends NO onlineStatus CMD, the user switches
// away and back to the tab, and the dot must self-heal (appear) on visibilitychange
// without a full page reload.
//
// Root cause the fix addresses: fetchChannelInfo rebuilds channelInfo.channel from the
// server response's channel_id (the space prefix `s<spaceId>_` is stripped by the
// backend), so the ChannelInfoListener fires with the stripped uid, which never matches
// the prefixed uid stored in prefetchedUids — the re-render is therefore never triggered.
// refreshTrackedOnlineStatus must force its own re-render after the refetch resolves.

const SPACE_PREFIX = "s" + "a".repeat(32) + "_";
const STRIPPED_UID = "bot1";
const PREFIXED_UID = SPACE_PREFIX + STRIPPED_UID; // uid the contacts list actually holds

class MockChannel {
  channelID: string;
  channelType: number;
  constructor(channelID: string, channelType: number) {
    this.channelID = channelID;
    this.channelType = channelType;
  }
  getChannelKey() {
    return `${this.channelID}_${this.channelType}`;
  }
}

// Stateful SDK mock: real listener list + cache, and a fetchChannelInfo that reconstructs
// the channel from the (stripped) server id, exactly like the production channelInfoCallback.
const sdkState = {
  listeners: [] as ((ci: any) => void)[],
  cache: new Map<string, any>(),
  server: new Map<string, { online: boolean; last_offline: number }>(),
};

function extractUID(id: string): string {
  return /^s[0-9a-f]{32}_/.test(id) ? id.slice(id.indexOf("_") + 1) : id;
}

const channelManager = {
  addListener: (l: (ci: any) => void) => sdkState.listeners.push(l),
  removeListener: (l: (ci: any) => void) => {
    const i = sdkState.listeners.indexOf(l);
    if (i >= 0) sdkState.listeners.splice(i, 1);
  },
  getChannelInfo: (ch: MockChannel) => sdkState.cache.get(ch.getChannelKey()),
  notifyListeners: (ci: any) => sdkState.listeners.forEach((l) => l(ci)),
  fetchChannelInfo: async (ch: MockChannel) => {
    const requestedKey = ch.getChannelKey();
    const realUID = extractUID(ch.channelID);
    const s = sdkState.server.get(realUID) || { online: false, last_offline: 0 };
    // 服务端回包用去前缀的 channel_id 重建 channel（复现前缀不一致的关键）
    const ci = {
      channel: new MockChannel(realUID, ch.channelType),
      title: "AI Bot",
      online: s.online,
      lastOffline: s.last_offline,
    };
    sdkState.cache.set(requestedKey, ci); // 写回「请求 uid」对应 key
    channelManager.notifyListeners(ci); // 用去前缀 channel 通知（listener 命中会失败）
  },
};

let ContactsList: typeof import("../index").default;
let container: HTMLDivElement;
const appListeners = new Map<string, Set<(event: any) => void>>();

beforeAll(async () => {
  vi.doMock("wukongimjssdk", () => {
    const sdk = {
      shared: () => ({ channelManager, chatManager: { send: vi.fn() } }),
    };
    return {
      default: sdk,
      WKSDK: sdk,
      Channel: MockChannel,
      ChannelTypePerson: 1,
      ChannelTypeGroup: 2,
    };
  });

  const Passthrough = ({ children }: any) => <>{children}</>;
  const RenderProp = ({ onContext, children }: any) => {
    if (onContext) onContext({});
    return <>{children}</>;
  };

  vi.doMock("@octo/base", () => ({
    Contacts: class {},
    ContextMenus: () => null,
    ContextMenusContext: class {},
    WKApp: {
      currentMenuId: "contacts",
      mittBus: {
        on: (name: string, fn: (event: any) => void) => {
          if (!appListeners.has(name)) appListeners.set(name, new Set());
          appListeners.get(name)!.add(fn);
        },
        off: (name: string, fn: (event: any) => void) => appListeners.get(name)?.delete(fn),
        emit: (name: string, event: any) => appListeners.get(name)?.forEach(fn => fn(event)),
      },
      shared: { currentSpaceId: undefined, openChannel: undefined },
      loginInfo: { uid: "me" },
      apiClient: { get: vi.fn(() => Promise.resolve([])) },
      endpoints: { showConversation: vi.fn() },
    },
    WKBase: RenderProp,
    WKBaseContext: class {},
    ErrorBoundary: Passthrough,
    WKModal: () => null,
    I18nContext: React.createContext({}),
    t: (k: string) => k,
    toSimplized: (s: string) => s,
    getPinyin: () => "#",
    Dap: { shared: { track: vi.fn() } },
    addCurrentImChannelInfoListener: (listener: any) => {
      channelManager.addListener(listener);
      return () => channelManager.removeListener(listener);
    },
    fetchCurrentImChannelInfo: (channel: any) =>
      channelManager.fetchChannelInfo(channel),
    getCurrentImChannelInfo: (channel: any) =>
      channelManager.getChannelInfo(channel),
  }));

  vi.doMock("@octo/base/src/App", async () => ({ default: (await import("@octo/base")).WKApp }));
  vi.doMock("@octo/base/src/Messages/Card", () => ({ Card: class {} }));
  vi.doMock("@octo/base/src/Components/WKAvatar", () => ({
    default: ({ channel }: any) => <div className="wk-avatar" data-cid={channel.channelID} />,
  }));
  vi.doMock("@octo/base/src/Components/AiBadge", () => ({ default: () => <span className="ai-badge" /> }));
  vi.doMock("@octo/base/src/Components/BotDetailModal", () => ({ default: () => null }));
  vi.doMock("@octo/base/src/Components/UserInfo", () => ({ default: () => null }));
  vi.doMock("@octo/base/src/Components/GroupCard", () => ({ default: () => null }));
  vi.doMock("@octo/base/src/Service/SpaceService", () => ({
    SpaceService: { shared: { getMySpaces: vi.fn(() => Promise.resolve([])), getMembers: vi.fn(() => Promise.resolve([])) } },
    // real prefix helper: the component normalizes online-status uids through this
    hasSpacePrefix: (id: string) => /^s[0-9a-f]{32}_/.test(id),
  }));
  vi.doMock("@octo/base/src/Utils/rateLimit", () => ({
    debounce: (fn: any) => Object.assign(fn, { cancel: vi.fn() }),
  }));
  // 复用真实在线态判定；badge 渲染成一个可断言的标记
  vi.doMock("@octo/base/src/Components/ConversationList", () => ({
    OnlineStatusBadge: () => <span data-testid="online-badge" />,
    needShowOnlineStatus: (ci?: any) => !!ci && !!ci.online,
    getOnlineTip: () => undefined,
  }));

  vi.doMock("@douyinfe/semi-ui", () => ({
    Toast: { success: vi.fn(), error: vi.fn() },
    Tooltip: ({ children }: any) => <>{children}</>,
  }));
  vi.doMock("@tanstack/react-virtual", () => ({ useVirtualizer: () => ({ getVirtualItems: () => [], getTotalSize: () => 0, scrollToOffset: vi.fn() }) }));
  vi.doMock("../Service/ContactsListManager", () => ({ ContactsListManager: { shared: {} } }));

  ContactsList = (await import("../index")).default;
});

beforeEach(async () => {
  sdkState.listeners = [];
  sdkState.cache = new Map();
  sdkState.server = new Map();
  appListeners.clear();
  const { WKApp } = await import("@octo/base");
  const { SpaceService } = await import("@octo/base/src/Service/SpaceService");
  WKApp.currentMenuId = "contacts";
  WKApp.shared.currentSpaceId = "";
  vi.mocked(WKApp.apiClient.get).mockReset().mockResolvedValue([]);
  vi.mocked(SpaceService.shared.getMySpaces).mockReset().mockResolvedValue([]);
  vi.mocked(SpaceService.shared.getMembers).mockReset().mockResolvedValue([]);
  delete document.documentElement.dataset.hostVisibility;
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
  vi.restoreAllMocks();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

describe("Contacts online badge self-heal on tab focus", () => {
  it("coalesces tracked online refreshes, bounds concurrency and expires successful results", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(10000);
    const ref = React.createRef<any>();
    await act(async () => { ReactDOM.render(<ContactsList ref={ref} />, container); });
    ref.current.prefetchedUids = new Set(Array.from({ length: 10 }, (_, i) => `bot-${i}`));
    const requests: ReturnType<typeof deferred<void>>[] = [];
    const fetch = vi.spyOn(channelManager, "fetchChannelInfo").mockImplementation(() => {
      const request = deferred<void>();
      requests.push(request);
      return request.promise;
    });
    act(() => { void ref.current.refreshTrackedOnlineStatus(); });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(6);
    act(() => { void ref.current.refreshTrackedOnlineStatus(); });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(6);
    await act(async () => { requests.slice(0, 6).forEach(request => request.resolve()); });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(10);
    await act(async () => { requests.slice(6).forEach(request => request.resolve()); });
    await flush();
    await act(async () => { await ref.current.refreshTrackedOnlineStatus(); });
    expect(fetch).toHaveBeenCalledTimes(10);
    clock.mockReturnValue(11000);
    fetch.mockResolvedValue(undefined);
    await act(async () => { await ref.current.refreshTrackedOnlineStatus(); });
    expect(fetch).toHaveBeenCalledTimes(20);
  });

  it("allows an immediate retry after online refresh failure", async () => {
    const ref = React.createRef<any>();
    await act(async () => { ReactDOM.render(<ContactsList ref={ref} />, container); });
    ref.current.prefetchedUids.add("bot");
    const fetch = vi.spyOn(channelManager, "fetchChannelInfo").mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await ref.current.refreshTrackedOnlineStatus(); });
    fetch.mockResolvedValue(undefined);
    await act(async () => { await ref.current.refreshTrackedOnlineStatus(); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["space", "unmount"])("stops queued online work after %s", async (change) => {
    const { WKApp } = await import("@octo/base");
    const ref = React.createRef<any>();
    await act(async () => { ReactDOM.render(<ContactsList ref={ref} />, container); });
    ref.current.prefetchedUids = new Set(Array.from({ length: 10 }, (_, i) => `bot-${i}`));
    const pending = deferred<void>();
    const fetch = vi.spyOn(channelManager, "fetchChannelInfo").mockReturnValue(pending.promise);
    act(() => { void ref.current.refreshTrackedOnlineStatus(); });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(6);
    act(() => {
      if (change === "unmount") ReactDOM.unmountComponentAtNode(container);
      else {
        WKApp.shared.currentSpaceId = "space-b";
        WKApp.mittBus.emit("space-changed", { space_id: "space-b" } as any);
      }
    });
    await act(async () => { pending.resolve(); });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("shows the AI green dot after visibilitychange when the server went online without a CMD", async () => {
    const ref = React.createRef<any>();

    // 初始：AI 离线，服务端未置在线
    sdkState.server.set(STRIPPED_UID, { online: false, last_offline: 0 });

    await act(async () => {
      ReactDOM.render(<ContactsList ref={ref} />, container);
    });

    // 加载「已添加 AI」并预取其在线态（uid 带 space 前缀）
    await act(async () => {
      ref.current.setState({ myBots: [{ uid: PREFIXED_UID, name: "AI Bot" }], expandedSection: "myBots", loading: false });
      ref.current.prefetchOnlineStatus([PREFIXED_UID]);
    });
    await flush();

    // 离线时不应有绿点
    expect(container.querySelectorAll('[data-testid="online-badge"]').length).toBe(0);

    // 服务端把该 AI 置为在线，但不发 onlineStatus CMD
    sdkState.server.set(STRIPPED_UID, { online: true, last_offline: 0 });

    // 用户切走再切回标签页
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();

    // 绿点应自愈补出，无需整页刷新
    expect(container.querySelectorAll('[data-testid="online-badge"]').length).toBe(1);
  });
});

describe("Contacts roster revalidation", () => {
  async function mountRoster() {
    const { WKApp } = await import("@octo/base");
    const { SpaceService } = await import("@octo/base/src/Service/SpaceService");
    WKApp.shared.currentSpaceId = "space-a";
    vi.mocked(SpaceService.shared.getMySpaces).mockResolvedValue([{ space_id: "space-a", name: "Alpha" }] as any);
    vi.mocked(SpaceService.shared.getMembers).mockResolvedValue([{ uid: "old", name: "Old contact" }] as any);
    const ref = React.createRef<any>();
    await act(async () => { ReactDOM.render(<ContactsList ref={ref} />, container); });
    await flush();
    return { ref, WKApp, SpaceService };
  }

  async function mountPendingRoster() {
    const { WKApp } = await import("@octo/base");
    const { SpaceService } = await import("@octo/base/src/Service/SpaceService");
    const initialMembers = deferred<any[]>();
    const initialRoster = {
      spaceMembers: [{ uid: "initial-member", name: "Initial member" }],
      myBots: [{ uid: "initial-bot", name: "Initial bot" }],
      spaceBots: [{ uid: "initial-space-bot", name: "Initial Space bot" }],
      myGroups: [{ group_no: "initial-group", name: "Initial group" }],
    };
    WKApp.shared.currentSpaceId = "space-a";
    vi.mocked(SpaceService.shared.getMySpaces).mockResolvedValue([{ space_id: "space-a", name: "Alpha" }] as any);
    vi.mocked(SpaceService.shared.getMembers).mockReturnValueOnce(initialMembers.promise);
    vi.mocked(WKApp.apiClient.get).mockImplementation(async (path) => {
      if (path === "/robot/my_bots") return initialRoster.myBots;
      if (path === "/robot/space_bots") return initialRoster.spaceBots;
      return initialRoster.myGroups;
    });
    const ref = React.createRef<any>();
    await act(async () => { ReactDOM.render(<ContactsList ref={ref} />, container); });
    await flush();
    return {
      ref, WKApp, SpaceService, initialRoster,
      finishInitial: async () => {
        await act(async () => { initialMembers.resolve(initialRoster.spaceMembers); });
        await flush();
      },
    };
  }

  it("coalesces cross-task activation events and expires only successful roster refreshes", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(10000);
    const { SpaceService } = await mountRoster();
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(SpaceService.shared.getMembers).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(11000);
    vi.mocked(SpaceService.shared.getMembers).mockRejectedValueOnce(new Error("offline"));
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(SpaceService.shared.getMembers).toHaveBeenCalledTimes(4);
  });

  it("shares an in-flight activation roster request across separate events", async () => {
    const { ref, SpaceService } = await mountRoster();
    const pending = deferred<any[]>();
    vi.mocked(SpaceService.shared.getMembers).mockReturnValueOnce(pending.promise);
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(SpaceService.shared.getMembers).toHaveBeenCalledTimes(2);
    await act(async () => { pending.resolve([{ uid: "updated", name: "Updated" }]); });
    await flush();
    expect(ref.current.state.spaceMembers[0].uid).toBe("updated");
  });

  it("holds the activation guard until all requests settle after a partial failure", async () => {
    const { ref, WKApp, SpaceService } = await mountRoster();
    const pending = deferred<any[]>();
    vi.mocked(SpaceService.shared.getMembers).mockReturnValueOnce(pending.promise);
    vi.mocked(WKApp.apiClient.get).mockRejectedValueOnce(new Error("offline"));
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(SpaceService.shared.getMembers).toHaveBeenCalledTimes(2);
    await act(async () => { pending.resolve([{ uid: "partial", name: "Partial" }]); });
    await flush();
    expect(ref.current.state.spaceMembers[0].uid).toBe("old");
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    expect(SpaceService.shared.getMembers).toHaveBeenCalledTimes(3);
  });

  it("clears activation TTL on a Space switch and releases departed online UIDs", async () => {
    const { ref, WKApp, SpaceService } = await mountRoster();
    ref.current.prefetchedUids.add("departed");
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    expect(ref.current.prefetchedUids.has("departed")).toBe(false);
    await act(async () => {
      WKApp.shared.currentSpaceId = "space-b";
      WKApp.mittBus.emit("space-changed", { space_id: "space-b" } as any);
    });
    await flush();
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    expect(SpaceService.shared.getMembers).toHaveBeenCalledTimes(4);
  });

  it("refreshes all directories and search on resume while retaining filter, section and scroll", async () => {
    const { ref, WKApp, SpaceService } = await mountRoster();
    await act(async () => {
      ref.current.setState({ keyword: "New", filterMode: "humans", expandedSection: "groups" });
      ref.current.filterScrollTops.humans = 220;
    });
    vi.mocked(SpaceService.shared.getMembers).mockResolvedValue([{ uid: "new", name: "New contact" }] as any);
    vi.mocked(WKApp.apiClient.get).mockImplementation(async (path) => {
      if (path === "/robot/my_bots") return [{ uid: "my-new", name: "My new bot" }];
      if (path === "/robot/space_bots") return [{ uid: "space-new", name: "Space new bot" }];
      return [{ group_no: "new-group", name: "New group" }];
    });
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    expect(ref.current.state.spaceMembers[0].uid).toBe("new");
    expect(ref.current.state.myBots[0].uid).toBe("my-new");
    expect(ref.current.state.spaceBots[0].uid).toBe("space-new");
    expect(ref.current.state.myGroups[0].group_no).toBe("new-group");
    expect(ref.current.state.searchContacts.some((item: any) => item.uid === "new")).toBe(true);
    expect(ref.current.state.keyword).toBe("New");
    expect(ref.current.state.filterMode).toBe("humans");
    expect(ref.current.state.expandedSection).toBe("groups");
    expect(ref.current.filterScrollTops.humans).toBe(220);
    expect(ref.current.state.loading).toBe(false);
  });

  it("refreshes on chat-to-contacts activation without requiring a resume command", async () => {
    const { ref, WKApp, SpaceService } = await mountRoster();
    await act(async () => {
      WKApp.currentMenuId = "chat";
      WKApp.mittBus.emit("wk:active-menu-changed", { menuId: "chat" });
    });
    vi.mocked(SpaceService.shared.getMembers).mockResolvedValue([{ uid: "returned", name: "Returned" }] as any);
    await act(async () => {
      WKApp.currentMenuId = "contacts";
      WKApp.mittBus.emit("wk:active-menu-changed", { menuId: "contacts" });
    });
    await flush();
    expect(ref.current.state.spaceMembers[0].uid).toBe("returned");
    act(() => ReactDOM.unmountComponentAtNode(container));
    expect(appListeners.get("wk:active-menu-changed")?.size).toBe(0);
    const count = vi.mocked(SpaceService.shared.getMembers).mock.calls.length;
    window.dispatchEvent(new Event("octobuddy:resume"));
    await flush();
    expect(SpaceService.shared.getMembers).toHaveBeenCalledTimes(count);
  });

  it("does not invalidate unfinished initial Space setup on early resume", async () => {
    const { WKApp } = await import("@octo/base");
    const { SpaceService } = await import("@octo/base/src/Service/SpaceService");
    WKApp.shared.currentSpaceId = "space-a";
    let finish!: (spaces: any[]) => void;
    vi.mocked(SpaceService.shared.getMySpaces).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    vi.mocked(SpaceService.shared.getMembers).mockResolvedValue([{ uid: "ready", name: "Ready" }] as any);
    const ref = React.createRef<any>();
    await act(async () => { ReactDOM.render(<ContactsList ref={ref} />, container); });
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await act(async () => { finish([{ space_id: "space-a", name: "Alpha" }]); });
    await flush();
    expect(ref.current.state.currentSpace.space_id).toBe("space-a");
    expect(ref.current.state.spaceMembers[0].uid).toBe("ready");
    expect(ref.current.state.loading).toBe(false);
  });

  it("keeps the foreground roster load alive when a silent activation refresh fails", async () => {
    const { WKApp } = await import("@octo/base");
    const { SpaceService } = await import("@octo/base/src/Service/SpaceService");
    WKApp.shared.currentSpaceId = "space-a";
    vi.mocked(SpaceService.shared.getMySpaces).mockResolvedValue([{ space_id: "space-a", name: "Alpha" }] as any);
    const initialMembers = deferred<any[]>();
    vi.mocked(SpaceService.shared.getMembers)
      .mockReturnValueOnce(initialMembers.promise)
      .mockRejectedValueOnce(new Error("offline"));
    const ref = React.createRef<any>();
    await act(async () => { ReactDOM.render(<ContactsList ref={ref} />, container); });
    await flush();
    expect(ref.current.state.currentSpace.space_id).toBe("space-a");
    expect(ref.current.state.loading).toBe(true);
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    expect(ref.current.state.loading).toBe(true);
    expect(ref.current.state.spaceMembers).toEqual([]);
    await act(async () => { initialMembers.resolve([{ uid: "ready", name: "Ready" }]); });
    await flush();
    expect(ref.current.state.loading).toBe(false);
    expect(ref.current.state.spaceMembers[0].uid).toBe("ready");
  });

  it.each(["/robot/my_bots", "/robot/space_bots", "/group/my?space_id=space-a"])(
    "keeps the complete foreground roster when silent %s fails",
    async (failedPath) => {
      const { ref, WKApp, SpaceService, initialRoster, finishInitial } = await mountPendingRoster();
      expect(ref.current.state.loading).toBe(true);
      vi.mocked(SpaceService.shared.getMembers).mockResolvedValue([{ uid: "silent-member", name: "Silent member" }] as any);
      vi.mocked(WKApp.apiClient.get).mockImplementation(async (path) => {
        if (path === failedPath) throw new Error("offline");
        return [];
      });
      await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
      await flush();
      const afterSilent = ref.current.state;
      await finishInitial();
      expect(ref.current.state).toMatchObject({ ...initialRoster, loading: false });
      expect(afterSilent).toMatchObject({
        spaceMembers: [], myBots: [], spaceBots: [], myGroups: [], loading: true,
      });
    },
  );

  it("preserves the cached roster when a silent directory request fails", async () => {
    const { ref, WKApp, SpaceService } = await mountRoster();
    const cachedRoster = ref.current.state;
    vi.mocked(SpaceService.shared.getMembers).mockResolvedValue([{ uid: "partial", name: "Partial snapshot" }] as any);
    vi.mocked(WKApp.apiClient.get).mockRejectedValueOnce(new Error("offline"));
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    expect(ref.current.state.spaceMembers).toEqual(cachedRoster.spaceMembers);
    expect(ref.current.state.myBots).toEqual(cachedRoster.myBots);
    expect(ref.current.state.spaceBots).toEqual(cachedRoster.spaceBots);
    expect(ref.current.state.myGroups).toEqual(cachedRoster.myGroups);
    expect(ref.current.state.loading).toBe(false);
  });

  it.each(["/robot/my_bots", "/robot/space_bots", "/group/my?space_id=space-a"])(
    "preserves the foreground empty-directory fallback when %s fails",
    async (failedPath) => {
      const { WKApp } = await import("@octo/base");
      vi.mocked(WKApp.apiClient.get).mockImplementation(async (path) => {
        if (path === failedPath) throw new Error("offline");
        return [];
      });
      const { ref } = await mountRoster();
      expect(ref.current.state).toMatchObject({
        spaceMembers: [{ uid: "old", name: "Old contact" }],
        myBots: [], spaceBots: [], myGroups: [], loading: false,
      });
    },
  );

  it("keeps a complete silent snapshot after the older foreground roster resolves", async () => {
    const { ref, WKApp, SpaceService, finishInitial } = await mountPendingRoster();
    const latestRoster = {
      spaceMembers: [{ uid: "latest-member", name: "Latest member" }],
      myBots: [], spaceBots: [], myGroups: [], loading: false,
    };
    vi.mocked(SpaceService.shared.getMembers).mockResolvedValue(latestRoster.spaceMembers as any);
    vi.mocked(WKApp.apiClient.get).mockResolvedValue([]);
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    await flush();
    expect(ref.current.state).toMatchObject(latestRoster);
    await finishInitial();
    expect(ref.current.state).toMatchObject(latestRoster);
  });

  it("ignores a late roster response after switching Space", async () => {
    const { ref, WKApp, SpaceService } = await mountRoster();
    let finish!: (members: any[]) => void;
    vi.mocked(SpaceService.shared.getMembers).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await act(async () => { window.dispatchEvent(new Event("octobuddy:resume")); });
    vi.mocked(SpaceService.shared.getMembers).mockResolvedValue([{ uid: "beta", name: "Beta member" }] as any);
    await act(async () => {
      WKApp.shared.currentSpaceId = "space-b";
      WKApp.mittBus.emit("space-changed", { space_id: "space-b", name: "Beta" } as any);
    });
    await flush();
    await act(async () => { finish([{ uid: "stale", name: "Old space" }]); });
    await flush();
    expect(ref.current.state.spaceMembers[0].uid).toBe("beta");
  });
});
