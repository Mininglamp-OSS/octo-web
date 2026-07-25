import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the two remaining AI online green-dot paths on the
// Contacts page (the tab-focus path is covered in visibilityHeal.test.tsx):
//   (a) the dot must appear after the initial prefetch of an AI's channelInfo resolves;
//   (b) the dot must appear after a realtime onlineStatus WS push.
//
// Root cause both paths hit before the fix: the contacts list holds Space-prefixed
// uids (`s<spaceId>_<uid>`), but the channelInfoCallback rebuilds channelInfo.channel
// from the server's stripped channel_id, and the onlineStatus WS handler
// (dmworkbase module.tsx) keys everything off the stripped `cmdContent.param.uid`.
// So prefetch cached under the prefixed key while the listener fired — and the WS
// handler updated — under the stripped key: the membership test never matched and
// renderOnlineBadge read a stale prefixed-key entry, so neither path re-rendered the
// dot until an unrelated render. The fix normalizes the online-status uid to the
// stripped form for prefetch, cache reads and the listener match, unifying all paths.

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
// the channel from the (stripped) server id and caches under the REQUESTED key, exactly
// like the production channelInfoCallback — this is what reproduces the key mismatch.
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
    channelManager.notifyListeners(ci); // 用去前缀 channel 通知
  },
};

// Faithfully mirror the dmworkbase onlineStatus WS handler (module.tsx): it always
// keys off the stripped person uid — getChannelInfo(stripped); if present, flip online
// and notify; otherwise fetchChannelInfo(stripped). No prefixed uid is ever involved.
async function dispatchOnlineStatusPush(strippedUid: string, online: boolean) {
  sdkState.server.set(strippedUid, { online, last_offline: 0 });
  const ch = new MockChannel(strippedUid, 1);
  const ci = channelManager.getChannelInfo(ch);
  if (ci) {
    ci.online = online;
    channelManager.notifyListeners(ci);
  } else {
    await channelManager.fetchChannelInfo(ch);
  }
}

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

const badgeCount = () => container.querySelectorAll('[data-testid="online-badge"]').length;

// Render the Contacts page with a single AI in "已添加 AI", holding a Space-prefixed uid.
async function mountWithBot(ref: React.RefObject<any>) {
  await act(async () => {
    ReactDOM.render(<ContactsList ref={ref} />, container);
  });
  await act(async () => {
    ref.current.setState({ myBots: [{ uid: PREFIXED_UID, name: "AI Bot" }], expandedSection: "myBots", loading: false });
  });
  await flush();
}

describe("Contacts online badge sync for Space-prefixed AI uids", () => {
  it("shows the green dot after the initial prefetch resolves with the AI already online", async () => {
    const ref = React.createRef<any>();
    // 预取发生时服务端已在线，但列表持有的是带前缀 uid
    sdkState.server.set(STRIPPED_UID, { online: true, last_offline: 0 });

    await mountWithBot(ref);
    // 预取前缓存为空，尚无绿点
    expect(badgeCount()).toBe(0);

    // 初次预取该 AI 的在线态（uid 带 Space 前缀）
    await act(async () => {
      ref.current.prefetchOnlineStatus([PREFIXED_UID]);
    });
    await flush();

    // 预取回包后应触发重渲并补出绿点
    expect(badgeCount()).toBe(1);
  });

  it("shows the green dot after a realtime onlineStatus WS push", async () => {
    const ref = React.createRef<any>();
    // 初始离线并完成一次预取（注册该带前缀 uid 为已追踪）
    sdkState.server.set(STRIPPED_UID, { online: false, last_offline: 0 });

    await mountWithBot(ref);
    await act(async () => {
      ref.current.prefetchOnlineStatus([PREFIXED_UID]);
    });
    await flush();
    // 离线时不应有绿点
    expect(badgeCount()).toBe(0);

    // 实时 onlineStatus WS 推送把该 AI 置为在线（handler 用去前缀 uid）
    await act(async () => {
      await dispatchOnlineStatusPush(STRIPPED_UID, true);
    });
    await flush();

    // 实时推送后应触发重渲并补出绿点
    expect(badgeCount()).toBe(1);
  });
});
