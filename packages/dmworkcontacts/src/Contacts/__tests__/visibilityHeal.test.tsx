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
      mittBus: { on: vi.fn(), off: vi.fn() },
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
    addCurrentImChannelInfoListener: (listener: any) => {
      channelManager.addListener(listener);
      return () => channelManager.removeListener(listener);
    },
    fetchCurrentImChannelInfo: (channel: any) =>
      channelManager.fetchChannelInfo(channel),
    getCurrentImChannelInfo: (channel: any) =>
      channelManager.getChannelInfo(channel),
  }));

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

beforeEach(() => {
  sdkState.listeners = [];
  sdkState.cache = new Map();
  sdkState.server = new Map();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("Contacts online badge self-heal on tab focus", () => {
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
