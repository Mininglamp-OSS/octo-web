/**
 * module.attentionPoll test —— 兜底轮询与 leader 选举在 module.tsx 里的接线与拆线。
 *
 * 这一层要钉的不是轮询算法本身（那在 utils/__tests__/summaryAttentionPoll.test.ts），
 * 而是【谁在什么时候把它拉起来、谁在什么时候把它拆掉】：
 *   - 轮询只由 leader 拉起（onBecomeLeader），失去身份即停表；
 *   - 可见性、聚焦、切 Space、站内路由切换这四类事件都要把节奏拉回基础档；
 *   - 热更 dispose 必须把定时器与监听全部拆干净。漏一个，一个下午的开发会话
 *     能叠出几十条并行轮询链，而且旧链持有的是旧模块实例——这是真实会发生的 bug，
 *     现有 teardown 已经为 visibility/focus/IM 做了同样的事，这里跟上同一套。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  currentSpaceId: "space-a",
  currentMenuId: "mail",
  mittHandlers: new Map<string, (payload?: unknown) => void>(),
  docHandlers: new Map<string, () => void>(),
  winHandlers: new Map<string, () => void>(),
  visibility: "visible" as DocumentVisibilityState,
}));

// 轮询与 leader 都换成可观测的替身：本文件关心的是调用关系，不是它们的内部逻辑。
const poll = vi.hoisted(() => {
  let started = false;
  let visible = true;
  return {
    start: vi.fn(() => { started = true; }),
    stop: vi.fn(() => { started = false; }),
    notifyActivity: vi.fn(() => { /* real impl guards: if (!started || !visible) return; */ }),
    setVisible: vi.fn((v: boolean) => { visible = v; }),
    getCurrentIntervalMs: () => 15_000,
    isFetching: () => false,
    // helper for tests
    _isStarted: () => started,
  };
});

const leader = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  publish: vi.fn(),
  isLeader: () => true,
  isDegraded: () => false,
  setVisible: vi.fn(),
}));

const captured = vi.hoisted(() => ({
  pollDeps: null as any,
  leaderDeps: null as any,
}));

// 事件驱动刷新的调度器换成替身：本文件关心的是【谁在什么条件下 trigger】，
// 固定窗口本身在 utils/__tests__/summaryAttentionSync.test.ts 里已经钉住了。
const sync = vi.hoisted(() => ({
  trigger: vi.fn(),
  triggerNow: vi.fn(),
  cancel: vi.fn(),
}));

// IM 侧同样换成替身，好把 module.tsx 注册进去的两个 listener 抓在手里。
const im = vi.hoisted(() => ({
  messageListeners: [] as Array<(message: unknown) => void>,
  connectListeners: [] as Array<(status: unknown) => void>,
}));

vi.mock("@octo/base", () => ({
  getSessionSid: () => "sid-test",
  i18n: { registerNamespace: vi.fn() },
  t: (key: string) => key,
  Dap: { shared: { track: vi.fn() } },
  Menus: class {},
  WKApp: {
    get currentMenuId() {
      return state.currentMenuId;
    },
    switchToMenuById: vi.fn(),
    loginInfo: { uid: "u1", token: "t", isLogined: () => true },
    shared: {
      get currentSpaceId() {
        return state.currentSpaceId;
      },
      set currentSpaceId(v: string) {
        state.currentSpaceId = v;
      },
    },
    routeLeft: { popToRoot: vi.fn() },
    routeRight: { replaceToRoot: vi.fn(), push: vi.fn(), popToRoot: vi.fn() },
    route: { register: vi.fn() },
    menus: { register: vi.fn(), refresh: vi.fn() },
    mittBus: {
      on: (event: string, handler: (payload?: unknown) => void) => {
        state.mittHandlers.set(event, handler);
      },
      off: (event: string) => {
        state.mittHandlers.delete(event);
      },
      emit: vi.fn(),
    },
    endpoints: {
      registerChannelHeaderRightItem: vi.fn(),
      registerChatSummaryPanel: vi.fn(),
    },
  },
}));

vi.mock("../pages/SummaryListPage", () => ({ default: () => null }));
vi.mock("../pages/SummaryCreatePage", () => ({ default: () => null }));
vi.mock("../pages/SummaryDetailPage", () => ({ default: () => null }));
vi.mock("../pages/SummaryShareDetailPage", () => ({ default: () => null }));
vi.mock("../features/summaryShare/SummarySharePreviewFeature", () => ({ default: () => null }));
vi.mock("../features/summaryWorkbench/SummaryWorkbenchCreateEntry", () => ({
  default: () => null,
}));
vi.mock("../pages/SummaryConfirmPage", () => ({ default: () => null }));
vi.mock("../pages/ScheduleListPage", () => ({ default: () => null }));
vi.mock("../api/summaryApi", () => ({
  confirmSummaryWorkspaceProposal: vi.fn(),
  getChatCandidates: vi.fn(),
  getSummaryDetail: vi.fn(),
  getSummaryShare: vi.fn(),
  getSummaryWorkspaceCapabilities: vi.fn(),
  getSummaryWorkspaceHistory: vi.fn(),
  postSummaryWorkspaceTurn: vi.fn(),
  saveSummaryWorkspacePreview: vi.fn(),
  streamSummaryWorkspaceTurn: vi.fn(),
}));
vi.mock("../features/summaryShare/navigation", () => ({
  getOriginalSummaryTaskId: vi.fn(),
  shouldOpenOriginalSummary: () => false,
}));
vi.mock("../utils/chatSummaryActions", () => ({ notifyChatSummaryCreated: vi.fn() }));
vi.mock("../utils/summaryAttentionBadge", () => ({
  getSummaryAttentionBadge: () => 0,
  // 返回 { count, sampleAt }：sampleAt 是广播排序用的样本时刻。
  readSummaryAttentionCount: vi.fn().mockResolvedValue({ count: 0, sampleAt: 1_000 }),
  refreshSummaryAttentionBadge: vi.fn(),
  setSummaryAttentionBadge: vi.fn(),
  acceptRemoteAttentionCount: vi.fn(),
  setSummaryAttentionPublisher: vi.fn(),
}));
vi.mock("../utils/summaryAttentionPoll", () => ({
  createAttentionPoll: (deps: unknown) => {
    captured.pollDeps = deps;
    return poll;
  },
}));
vi.mock("../utils/summaryAttentionLeader", () => ({
  createAttentionLeader: (deps: unknown) => {
    captured.leaderDeps = deps;
    return leader;
  },
}));
vi.mock("../utils/summaryAttentionSync", () => ({
  createAttentionSync: () => sync,
  // 只有显式标记的消息才算「值得刷新」，免得把真实的 contentType 区间抄进测试。
  shouldRefreshForMessage: (message: unknown) => (message as { match?: boolean })?.match === true,
}));
vi.mock("wukongimjssdk", () => ({
  default: {
    shared: () => ({
      chatManager: {
        addMessageListener: (h: (message: unknown) => void) => im.messageListeners.push(h),
        removeMessageListener: (h: (message: unknown) => void) => {
          im.messageListeners = im.messageListeners.filter((x) => x !== h);
        },
      },
      connectManager: {
        addConnectStatusListener: (h: (status: unknown) => void) => im.connectListeners.push(h),
        removeConnectStatusListener: (h: (status: unknown) => void) => {
          im.connectListeners = im.connectListeners.filter((x) => x !== h);
        },
      },
    }),
  },
  ConnectStatus: { Connected: "Connected" },
}));
vi.mock("../utils/channelType", () => ({ isSupportedChannelType: () => true }));
vi.mock("../components/ChatSummaryStarButton", () => ({ default: () => null }));
vi.mock("../components/ChatSummaryPanel", () => ({ default: () => null }));

import { SummaryModule, disposeSummaryModuleListeners, startSummaryAttentionPolling } from "../module";
import {
  acceptRemoteAttentionCount,
  refreshSummaryAttentionBadge,
  setSummaryAttentionPublisher,
} from "../utils/summaryAttentionBadge";

function mittHandler(event: string): (payload?: unknown) => void {
  const handler = state.mittHandlers.get(event);
  if (!handler) throw new Error(`Missing ${event} handler`);
  return handler;
}

function docHandler(event: string): () => void {
  const handler = state.docHandlers.get(event);
  if (!handler) throw new Error(`Missing document ${event} handler`);
  return handler;
}

describe("SummaryModule —— 兜底轮询接线", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.mittHandlers.clear();
    state.docHandlers.clear();
    state.winHandlers.clear();
    state.currentSpaceId = "space-a";
    state.visibility = "visible";
    im.messageListeners = [];
    im.connectListeners = [];

    vi.spyOn(document, "addEventListener").mockImplementation(((event: string, handler: any) => {
      state.docHandlers.set(event, handler);
    }) as any);
    vi.spyOn(document, "removeEventListener").mockImplementation(((event: string) => {
      state.docHandlers.delete(event);
    }) as any);
    vi.spyOn(window, "addEventListener").mockImplementation(((event: string, handler: any) => {
      state.winHandlers.set(event, handler);
    }) as any);
    vi.spyOn(window, "removeEventListener").mockImplementation(((event: string) => {
      state.winHandlers.delete(event);
    }) as any);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state.visibility);

    new SummaryModule().init();
  });

  afterEach(() => {
    disposeSummaryModuleListeners();
  });

  it("轮询由 leader 拉起、由失去身份停掉（而不是 init 里直接 start）", () => {
    expect(captured.leaderDeps.scopeId).toBe("sid-test");
    expect(captured.leaderDeps.getUserId()).toBe("u1");
    // init 只是把 leader 起起来；是否轮询由选举结果决定, 且入口层必须先
    // 显式 startSummaryAttentionPolling() (在 MSW 就绪之后), 否则 init 时同步
    // promote 的第一拍会漏 mock.
    expect(leader.start).toHaveBeenCalledTimes(1);
    expect(poll.start).not.toHaveBeenCalled();

    // 模拟入口层启动. 此时还没 promote, poll 仍然是停止的 (start 只排期不立即取数,
    // 但连 start 都没调过, 说明还没拿到 leader 身份).
    startSummaryAttentionPolling();
    expect(poll.start).not.toHaveBeenCalled();
    poll.notifyActivity.mockClear();

    captured.leaderDeps.onBecomeLeader();
    expect(poll.start).toHaveBeenCalledTimes(1);
    // 接管意味着刚才有一段【没人轮询】的窗口（上任 leader 崩了，或切到后台
    // 让了位），必须立刻取一次而不是等一个基础间隔。start() 只排期不取数。
    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);

    captured.leaderDeps.onResignLeader();
    expect(poll.stop).toHaveBeenCalledTimes(1);
  });

  it("后台轮询的取数【不】带 fresh（吃服务端 5s 缓存）", async () => {
    const badge = await import("../utils/summaryAttentionBadge");

    await captured.pollDeps.fetchCount();

    // 它是唯一一条无人值守就会产生的流量，必须可缓存。
    expect(badge.readSummaryAttentionCount).toHaveBeenCalledWith();
  });

  it("取数返回 null（未登录 / 飞行中切 Space）时抄当前值，等价于一次「值未变」", async () => {
    const badge = await import("../utils/summaryAttentionBadge");
    vi.mocked(badge.readSummaryAttentionCount).mockResolvedValueOnce(null);

    // 既不污染红点，也不会被当成失败去退避。
    await expect(captured.pollDeps.fetchCount()).resolves.toBe(0);
  });

  // 广播不再挂在轮询的 onCount 上：每一次成功的本地读取都该广播，不只是
  // leader 那一条。一个标签页里用户点掉红点，其它标签页本来就该跟着灭，
  // 而不是等 leader 下一拍（最长 60s）。
  it("广播钩子接到读取路径上，而不是只接轮询的 onCount", () => {
    expect(setSummaryAttentionPublisher).toHaveBeenCalledTimes(1);
    expect(captured.pollDeps.onCount).toBeUndefined();
  });

  it("广播带上当前 Space 与样本时刻", () => {
    const publisher = vi.mocked(setSummaryAttentionPublisher).mock.calls[0][0]!;

    publisher(5, 1_700_000_000_000);

    expect(leader.publish).toHaveBeenCalledWith(5, "space-a", 1_700_000_000_000);
  });

  it("只接受与本标签页当前 Space 相同的广播", () => {
    captured.leaderDeps.onRemoteCount(7, "space-a", 1_700_000_000_000);
    // 广播不再直接 setSummaryAttentionBadge：那是 last-write-wins，会让 leader
    // 一条更早发出的响应把本地刚 commit 的新值盖回去。改走同一个排序域。
    expect(acceptRemoteAttentionCount).toHaveBeenCalledWith(7, 1_700_000_000_000);

    vi.mocked(acceptRemoteAttentionCount).mockClear();

    // 各标签页可能停在不同 Space 上；写错 Space 的数字比不刷新更糟。
    captured.leaderDeps.onRemoteCount(9, "space-b", 1_700_000_000_001);
    captured.leaderDeps.onRemoteCount(9, "", 1_700_000_000_002);
    expect(acceptRemoteAttentionCount).not.toHaveBeenCalled();
  });

  it("标签页转入后台时停表，回到前台时重新起表", () => {
    state.visibility = "hidden";
    docHandler("visibilitychange")();
    expect(poll.setVisible).toHaveBeenLastCalledWith(false);

    state.visibility = "visible";
    docHandler("visibilitychange")();
    expect(poll.setVisible).toHaveBeenLastCalledWith(true);
  });

  // 🔴 回归：可见性此前只喂给轮询，没喂给 leader。于是隐藏的 leader 一边停着
  // 自己的表、一边每 3s 照常续租，其它可见标签页永远看到新鲜租约不接管——
  // 整个浏览器零轮询，直到 Chrome 的 intensive throttling（约 5 分钟）生效才自愈。
  it("可见性同时是选主资格：隐藏时通知 leader 让位，可见时通知它重新竞争", () => {
    state.visibility = "hidden";
    docHandler("visibilitychange")();
    expect(leader.setVisible).toHaveBeenLastCalledWith(false);

    state.visibility = "visible";
    docHandler("visibilitychange")();
    expect(leader.setVisible).toHaveBeenLastCalledWith(true);
  });

  it("窗口聚焦算一次活动：把节奏拉回基础档", () => {
    state.winHandlers.get("focus")?.();

    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);
  });

  it("切 Space 算一次活动（否则新 Space 的变化要等一个退避周期才可见）", () => {
    mittHandler("space-ready")();
    poll.notifyActivity.mockClear();

    mittHandler("space-changed")();

    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);
  });

  it("space-ready 会把登录前退避的轮询拉回基础档", () => {
    mittHandler("space-ready")();

    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);
    expect(refreshSummaryAttentionBadge).toHaveBeenCalledTimes(1);
  });

  it("登录态变化会重置轮询节奏并 fresh 刷新", () => {
    mittHandler("wk:auth-state-changed")();

    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);
    expect(refreshSummaryAttentionBadge).toHaveBeenCalledTimes(1);
  });

  // 🔴 回归：这两行原本是【fresh 在前、轮询在后】。两条读取都在自己的第一个
  // await 之前取票，notifyActivity() 又是同步调进 tick() 的，所以那个顺序下非
  // fresh 的轮询读票号更新；它先回来就直接落盘，随后 fresh 的响应因票号过期被
  // 丢掉——切一次 Space 花两个请求，偏偏丢的是唯一绕开服务端 5s 缓存的那条。
  it("切 Space 时先发轮询读、后发 fresh 读，好让绕开缓存的那条赢", async () => {
    const badge = await import("../utils/summaryAttentionBadge");
    mittHandler("space-ready")();
    vi.clearAllMocks();

    mittHandler("space-changed")();

    const pollOrder = poll.notifyActivity.mock.invocationCallOrder[0];
    const freshOrder = vi.mocked(badge.refreshSummaryAttentionBadge).mock.invocationCallOrder[0];
    expect(pollOrder).toBeLessThan(freshOrder);
  });

  it("站内路由切换（NavRail 菜单激活）算一次活动", () => {
    mittHandler("wk:active-menu-changed")({ menuId: "summary" });

    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);
  });

  it("冷启动前的 space-changed 不唤醒轮询（首刷统一交给 space-ready）", () => {
    mittHandler("space-changed")();

    expect(poll.notifyActivity).not.toHaveBeenCalled();
  });
});

/**
 * IM 消息与重连触发的刷新要过可见性门。
 *
 * 这两条是【每个标签页各收一份】的事件源：既不过 leader，也不跨页去抖，而本 PR
 * 之后它们走的是 fresh=1，逐个绕开服务端那 5s 缓存。不门控的话，开着五个 OCTO
 * 标签页的用户每来一条命中提示区间的消息就是五个未缓存请求，四个花在没人看的
 * 标签页上。门控不牺牲响应：标签页转回可见时 visibilitychange 自己会补刷一次。
 */
describe("SummaryModule —— IM / 重连刷新的可见性门", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.mittHandlers.clear();
    state.docHandlers.clear();
    state.winHandlers.clear();
    state.currentSpaceId = "space-a";
    state.visibility = "visible";
    im.messageListeners = [];
    im.connectListeners = [];

    vi.spyOn(document, "addEventListener").mockImplementation(((event: string, handler: any) => {
      state.docHandlers.set(event, handler);
    }) as any);
    vi.spyOn(document, "removeEventListener").mockImplementation(((event: string) => {
      state.docHandlers.delete(event);
    }) as any);
    vi.spyOn(window, "addEventListener").mockImplementation(((event: string, handler: any) => {
      state.winHandlers.set(event, handler);
    }) as any);
    vi.spyOn(window, "removeEventListener").mockImplementation(((event: string) => {
      state.winHandlers.delete(event);
    }) as any);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state.visibility);

    new SummaryModule().init();
  });

  afterEach(() => {
    disposeSummaryModuleListeners();
  });

  it("可见时，命中的 IM 消息照常触发刷新", () => {
    im.messageListeners[0]({ match: true });

    expect(sync.trigger).toHaveBeenCalledTimes(1);
  });

  it("隐藏时，IM 消息不再触发刷新", () => {
    state.visibility = "hidden";

    im.messageListeners[0]({ match: true });

    expect(sync.trigger).not.toHaveBeenCalled();
  });

  it("可见时，重连成功触发一次补齐", () => {
    im.connectListeners[0]("Connected");

    expect(sync.trigger).toHaveBeenCalledTimes(1);
  });

  it("隐藏时，重连成功也不刷新（回到前台那一刻由 visibilitychange 补上）", () => {
    state.visibility = "hidden";

    im.connectListeners[0]("Connected");
    expect(sync.trigger).not.toHaveBeenCalled();

    state.visibility = "visible";
    docHandler("visibilitychange")();
    expect(sync.trigger).toHaveBeenCalledTimes(1);
  });

  it("可见但不是 Connected 的状态变化仍然不刷新（门没有把原判定顶掉）", () => {
    im.connectListeners[0]("Disconnected");

    expect(sync.trigger).not.toHaveBeenCalled();
  });

  it("可见但没命中提示区间的消息仍然不刷新", () => {
    im.messageListeners[0]({ match: false });

    expect(sync.trigger).not.toHaveBeenCalled();
  });
});

describe("SummaryModule —— 定时器与监听的拆线", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.mittHandlers.clear();
    state.docHandlers.clear();
    state.winHandlers.clear();

    vi.spyOn(document, "addEventListener").mockImplementation(((event: string, handler: any) => {
      state.docHandlers.set(event, handler);
    }) as any);
    vi.spyOn(document, "removeEventListener").mockImplementation(((event: string) => {
      state.docHandlers.delete(event);
    }) as any);
    vi.spyOn(window, "addEventListener").mockImplementation(((event: string, handler: any) => {
      state.winHandlers.set(event, handler);
    }) as any);
    vi.spyOn(window, "removeEventListener").mockImplementation(((event: string) => {
      state.winHandlers.delete(event);
    }) as any);

    new SummaryModule().init();
  });

  afterEach(() => {
    disposeSummaryModuleListeners();
  });

  it("拆线时先停 leader（关 BroadcastChannel + 让出租约）再显式停表", () => {
    disposeSummaryModuleListeners();

    expect(leader.stop).toHaveBeenCalledTimes(1);
    // 降级模式下轮询是被直接拉起来的，不依赖 leader 回调，必须显式再停一次。
    expect(poll.stop).toHaveBeenCalledTimes(1);
  });

  // 广播钩子持有 _attentionLeader 的引用；漏拆的话，热更后新模块的读取会往
  // 一个已关闭的 channel 上发广播，更糟的是它会一直钉住旧模块实例。
  it("拆线摘掉广播钩子", () => {
    vi.mocked(setSummaryAttentionPublisher).mockClear();

    disposeSummaryModuleListeners();

    expect(setSummaryAttentionPublisher).toHaveBeenCalledWith(null);
  });

  it("拆线后路由监听不再在总线上", () => {
    expect(state.mittHandlers.has("wk:active-menu-changed")).toBe(true);
    expect(state.mittHandlers.has("wk:auth-state-changed")).toBe(true);

    disposeSummaryModuleListeners();

    expect(state.mittHandlers.has("wk:active-menu-changed")).toBe(false);
    expect(state.mittHandlers.has("wk:auth-state-changed")).toBe(false);
  });

  it("拆线后 visibility / focus 监听也一并摘掉（与既有 teardown 同一套做法）", () => {
    expect(state.docHandlers.has("visibilitychange")).toBe(true);
    expect(state.winHandlers.has("focus")).toBe(true);

    disposeSummaryModuleListeners();

    expect(state.docHandlers.has("visibilitychange")).toBe(false);
    expect(state.winHandlers.has("focus")).toBe(false);
  });

  it("拆线后残留的事件再来也不会碰到轮询（句柄已置空）", () => {
    const staleVisibility = state.docHandlers.get("visibilitychange")!;
    const staleFocus = state.winHandlers.get("focus")!;

    disposeSummaryModuleListeners();
    poll.setVisible.mockClear();
    poll.notifyActivity.mockClear();

    // 热更后旧 handler 可能还被宏任务队列持有；它们不应该再驱动任何东西。
    staleVisibility();
    staleFocus();

    expect(poll.setVisible).not.toHaveBeenCalled();
    expect(poll.notifyActivity).not.toHaveBeenCalled();
  });

  it("重复拆线幂等，不会重复 stop 或抛异常", () => {
    disposeSummaryModuleListeners();
    expect(() => disposeSummaryModuleListeners()).not.toThrow();

    expect(leader.stop).toHaveBeenCalledTimes(1);
    expect(poll.stop).toHaveBeenCalledTimes(1);
  });
});

describe("startSummaryAttentionPolling —— 启动顺序守卫", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.mittHandlers.clear();
    state.docHandlers.clear();
    state.winHandlers.clear();
    state.currentSpaceId = "space-a";
    state.visibility = "visible";
    im.messageListeners = [];
    im.connectListeners = [];

    vi.spyOn(document, "addEventListener").mockImplementation(((event: string, handler: any) => {
      state.docHandlers.set(event, handler);
    }) as any);
    vi.spyOn(document, "removeEventListener").mockImplementation(((event: string) => {
      state.docHandlers.delete(event);
    }) as any);
    vi.spyOn(window, "addEventListener").mockImplementation(((event: string, handler: any) => {
      state.winHandlers.set(event, handler);
    }) as any);
    vi.spyOn(window, "removeEventListener").mockImplementation(((event: string) => {
      state.winHandlers.delete(event);
    }) as any);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state.visibility);

    // 注意: 本文件里 createAttentionLeader 被 mock 成返回 { start: vi.fn(), ... },
    // 所以 _attentionLeader.start() 是 no-op, 不会同步 beat/promote. 真实代码里
    // start() 会立即 beat 一次, 可抢占到租约时 promote() → onBecomeLeader(), 这是
    // Option A 修复要拦掉的那条 init 时同步启动路径; 本 describe 的第一个断言直接
    // 验证 init 之后 poll 没被唤醒 (leader.start 本身也没把 poll 拉起来, 因为 mock).
    // 启动的唯一途径是显式调 startSummaryAttentionPolling()。
    new SummaryModule().init();
    poll.notifyActivity.mockClear();
    poll.start.mockClear();
    vi.mocked(setSummaryAttentionPublisher).mockClear();
  });

  afterEach(() => {
    disposeSummaryModuleListeners();
  });

  it("init() 不发起任何轮询请求: leader 起了但 poll 还没被唤醒", () => {
    // init 时 leader.start() 只开始心跳观察, 不 promote 也不 tick. 入口层还没
    // 调 startSummaryAttentionPolling(), 这个阶段打出去的任何 fetch 都会
    // 撞在 MSW 还没启动的窗口里 (见函数注释).
    expect(leader.start).toHaveBeenCalledTimes(1);
    expect(poll.notifyActivity).not.toHaveBeenCalled();
    expect(poll.start).not.toHaveBeenCalled();
  });

  it("显式 startSummaryAttentionPolling() 才唤醒第一拍 (入口层在 MSW 就绪后调)", () => {
    startSummaryAttentionPolling();

    // 可见: 立刻 notifyActivity 排第一拍.
    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);
  });

  it("startSummaryAttentionPolling() 幂等: 多次调用只唤醒一次", () => {
    startSummaryAttentionPolling();
    startSummaryAttentionPolling();
    startSummaryAttentionPolling();

    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);
  });

  it("页面隐藏时 startSummaryAttentionPolling() 不排第一拍 (setVisible 会在转可见时拉起来)", () => {
    state.visibility = "hidden" as DocumentVisibilityState;

    startSummaryAttentionPolling();

    // 不可见: 不打请求, 等 visibilitychange 把它唤醒 (leader.beat 每拍会让位,
    // 而 _visibilityHandler 把 setVisible(true) 接到 poll 上, 那次会走 notifyActivity).
    expect(poll.notifyActivity).not.toHaveBeenCalled();
  });

  it("dispose 复位启动标志: 重新 init 之后可以再 start 一次", () => {
    startSummaryAttentionPolling();
    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);
    disposeSummaryModuleListeners();
    poll.notifyActivity.mockClear();

    // HMR 场景: dispose 了旧实例, init 造新实例, start 再调一次, 必须能再次唤醒.
    new SummaryModule().init();
    startSummaryAttentionPolling();
    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);
  });
});
