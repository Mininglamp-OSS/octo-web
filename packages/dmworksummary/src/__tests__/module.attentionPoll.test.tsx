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
const poll = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  notifyActivity: vi.fn(),
  setVisible: vi.fn(),
  getCurrentIntervalMs: () => 15_000,
  isFetching: () => false,
}));

const leader = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  publish: vi.fn(),
  isLeader: () => true,
  isDegraded: () => false,
}));

const captured = vi.hoisted(() => ({
  pollDeps: null as any,
  leaderDeps: null as any,
}));

vi.mock("@octo/base", () => ({
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
vi.mock("../pages/SummaryConfirmPage", () => ({ default: () => null }));
vi.mock("../pages/ScheduleListPage", () => ({ default: () => null }));
vi.mock("../api/summaryApi", () => ({
  getChatCandidates: vi.fn(),
  getSummaryShare: vi.fn(),
}));
vi.mock("../features/summaryShare/navigation", () => ({
  getOriginalSummaryTaskId: vi.fn(),
  shouldOpenOriginalSummary: () => false,
}));
vi.mock("../utils/chatSummaryActions", () => ({ notifyChatSummaryCreated: vi.fn() }));
vi.mock("../utils/summaryAttentionBadge", () => ({
  getSummaryAttentionBadge: () => 0,
  readSummaryAttentionCount: vi.fn().mockResolvedValue(0),
  refreshSummaryAttentionBadge: vi.fn(),
  setSummaryAttentionBadge: vi.fn(),
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
vi.mock("../utils/channelType", () => ({ isSupportedChannelType: () => true }));
vi.mock("../components/ChatSummaryStarButton", () => ({ default: () => null }));
vi.mock("../components/ChatSummaryPanel", () => ({ default: () => null }));

import { SummaryModule, disposeSummaryModuleListeners } from "../module";
import { setSummaryAttentionBadge } from "../utils/summaryAttentionBadge";

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

  it("轮询由 leader 拉起、由失去身份停掉（而不是 init 里直接 start）", () => {
    // init 只是把 leader 起起来；是否轮询由选举结果决定。
    expect(leader.start).toHaveBeenCalledTimes(1);
    expect(poll.start).not.toHaveBeenCalled();

    captured.leaderDeps.onBecomeLeader();
    expect(poll.start).toHaveBeenCalledTimes(1);

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

  it("取到的计数被广播出去，并带上当前 Space", async () => {
    captured.pollDeps.onCount(5);

    expect(leader.publish).toHaveBeenCalledWith(5, "space-a");
  });

  it("只接受与本标签页当前 Space 相同的广播", () => {
    captured.leaderDeps.onRemoteCount(7, "space-a");
    expect(setSummaryAttentionBadge).toHaveBeenCalledWith(7);

    vi.mocked(setSummaryAttentionBadge).mockClear();

    // 各标签页可能停在不同 Space 上；写错 Space 的数字比不刷新更糟。
    captured.leaderDeps.onRemoteCount(9, "space-b");
    captured.leaderDeps.onRemoteCount(9, "");
    expect(setSummaryAttentionBadge).not.toHaveBeenCalled();
  });

  it("标签页转入后台时停表，回到前台时重新起表", () => {
    state.visibility = "hidden";
    docHandler("visibilitychange")();
    expect(poll.setVisible).toHaveBeenLastCalledWith(false);

    state.visibility = "visible";
    docHandler("visibilitychange")();
    expect(poll.setVisible).toHaveBeenLastCalledWith(true);
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

  it("站内路由切换（NavRail 菜单激活）算一次活动", () => {
    mittHandler("wk:active-menu-changed")({ menuId: "summary" });

    expect(poll.notifyActivity).toHaveBeenCalledTimes(1);
  });

  it("冷启动前的 space-changed 不唤醒轮询（首刷统一交给 space-ready）", () => {
    mittHandler("space-changed")();

    expect(poll.notifyActivity).not.toHaveBeenCalled();
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

  it("拆线时先停 leader（关 BroadcastChannel + 让出租约）再显式停表", () => {
    disposeSummaryModuleListeners();

    expect(leader.stop).toHaveBeenCalledTimes(1);
    // 降级模式下轮询是被直接拉起来的，不依赖 leader 回调，必须显式再停一次。
    expect(poll.stop).toHaveBeenCalledTimes(1);
  });

  it("拆线后路由监听不再在总线上", () => {
    expect(state.mittHandlers.has("wk:active-menu-changed")).toBe(true);

    disposeSummaryModuleListeners();

    expect(state.mittHandlers.has("wk:active-menu-changed")).toBe(false);
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
