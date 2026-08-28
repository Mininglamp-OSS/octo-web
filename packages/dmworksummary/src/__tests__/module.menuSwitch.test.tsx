import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  switchToMenuById: vi.fn(),
  replaceToRoot: vi.fn(),
  popToRoot: vi.fn(),
  currentMenuId: "mail",
  shared: {
    currentSpaceId: "space-a",
    baseContext: {
      hideGlobalModal: vi.fn(),
      showGlobalModal: vi.fn(),
    },
  },
  app: {} as Record<string, unknown>,
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
    get switchToMenuById() {
      return state.switchToMenuById;
    },
    shared: state.shared,
    routeLeft: { popToRoot: state.popToRoot },
    routeRight: { replaceToRoot: state.replaceToRoot, push: vi.fn(), popToRoot: state.popToRoot },
    route: { register: vi.fn() },
    menus: { register: vi.fn() },
    mittBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    endpoints: {
      registerChannelHeaderRightItem: vi.fn(),
      registerChatSummaryPanel: vi.fn(),
    },
    ...state.app,
  },
}));

vi.mock("../pages/SummaryListPage", () => ({ default: () => null }));
vi.mock("../pages/SummaryCreatePage", () => ({ default: () => null }));
vi.mock("../pages/SummaryDetailPage", () => ({ default: () => null }));
vi.mock("../pages/SummaryShareDetailPage", () => ({ default: () => null }));
vi.mock("../features/summaryShare/SummarySharePreviewFeature", () => ({
  default: () => null,
}));
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
vi.mock("../utils/chatSummaryActions", () => ({
  notifyChatSummaryCreated: vi.fn(),
}));
vi.mock("../utils/summaryAttentionBadge", () => ({
  getSummaryAttentionBadge: () => 0,
  refreshSummaryAttentionBadge: vi.fn(),
  setSummaryAttentionBadge: vi.fn(),
  // 广播排序相关的两个出口：init 会接广播钩子（setSummaryAttentionPublisher），
  // leader 收到广播时走 acceptRemoteAttentionCount。本用例只关心菜单切换，
  // 但 mock 缺一个导出就会让整个 init 抛错。
  acceptRemoteAttentionCount: vi.fn(),
  setSummaryAttentionPublisher: vi.fn(),
}));
vi.mock("../utils/channelType", () => ({
  isSupportedChannelType: () => true,
}));
vi.mock("../components/ChatSummaryStarButton", () => ({
  default: () => null,
}));
vi.mock("../components/ChatSummaryPanel", () => ({ default: () => null }));

import React from "react";
import { WKApp } from "@octo/base";
import { getSummaryShare } from "../api/summaryApi";
import SummaryCreatePage from "../pages/SummaryCreatePage";
import { SummaryModule } from "../module";
import { refreshSummaryAttentionBadge, setSummaryAttentionBadge } from "../utils/summaryAttentionBadge";

function registeredHandler(event: string): () => void {
  const call = vi.mocked(WKApp.mittBus.on).mock.calls.find(
    ([registeredEvent]) => registeredEvent === event
  );
  if (!call) throw new Error(`Missing ${event} handler`);
  return call[1] as () => void;
}

function summaryMenuFactory(): () => { onPress?: (reentry?: boolean) => void } {
  const reg = vi.mocked(WKApp.menus.register);
  const factory = reg.mock.calls.find(([id]) => id === "summary")?.[1] as unknown as () => { onPress?: (reentry?: boolean) => void };
  expect(factory).toBeTruthy();
  return factory;
}

describe("SummaryModule guarded menu switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.currentMenuId = "mail";
    state.shared.currentSpaceId = "space-a";
    new SummaryModule().init();
  });

  it("opens summary detail only after the guarded switch succeeds", () => {
    let afterSwitch: (() => void) | undefined;
    state.switchToMenuById.mockImplementation(
      (_menuId: string, next?: () => void) => {
        afterSwitch = next;
      }
    );

    WKApp.openSummaryDetail?.(42, "space-b");

    expect(state.switchToMenuById).toHaveBeenCalledWith(
      "summary",
      expect.any(Function)
    );
    expect(state.replaceToRoot).not.toHaveBeenCalled();
    expect(state.shared.currentSpaceId).toBe("space-a");

    afterSwitch?.();
    expect(state.shared.currentSpaceId).toBe("space-b");
    expect(state.popToRoot).toHaveBeenCalledTimes(1);
    expect(state.replaceToRoot).toHaveBeenCalledTimes(1);
  });

  it("does not open summary detail when the guarded switch is vetoed", () => {
    state.switchToMenuById.mockImplementation(() => undefined);

    WKApp.openSummaryDetail?.(42, "space-b");

    expect(state.replaceToRoot).not.toHaveBeenCalled();
    expect(state.shared.currentSpaceId).toBe("space-a");
  });

  it("prefetches a cross-Space share with its target Space before switching", async () => {
    let afterSwitch: (() => void) | undefined;
    state.switchToMenuById.mockImplementation(
      (_menuId: string, next?: () => void) => {
        afterSwitch = next;
      }
    );
    vi.mocked(getSummaryShare).mockResolvedValue({
      snapshot: { space_id: "space-b" },
    } as never);

    await WKApp.openSummaryShareDetail?.("share-1", "space-b");

    expect(getSummaryShare).toHaveBeenCalledWith("share-1", "space-b");
    expect(state.shared.currentSpaceId).toBe("space-a");
    expect(state.replaceToRoot).not.toHaveBeenCalled();

    afterSwitch?.();
    expect(state.shared.currentSpaceId).toBe("space-b");
    expect(state.replaceToRoot).toHaveBeenCalledTimes(1);
  });

  it("refreshes the attention badge once when the initial Space becomes ready", () => {
    registeredHandler("space-ready")();

    expect(refreshSummaryAttentionBadge).toHaveBeenCalledTimes(1);
  });

  it("NavRail summary onPress opens the create page by default without pushing a duplicate list page", () => {
    // #1461 回归：菜单激活后主区 SummaryListPage 已由 MainContentLeft 按
    // currentMenus.routePath(/summary) 渲染唯一实例，onPress 若再 replaceToRoot
    // /summary 会造出双实例（e2e strict mode violation）。
    // 新需求：进入智能总结右栏默认展示新建总结页（取代欢迎占位页）——只推创建页，
    // 绝不推列表页。
    const menu = summaryMenuFactory()();
    menu.onPress?.(false);

    // 只清左栈；右栈由 replaceToRoot 直接落创建页。
    expect(state.popToRoot).toHaveBeenCalledTimes(1); // routeLeft only
    expect(state.replaceToRoot).toHaveBeenCalledTimes(1);

    const pushed = state.replaceToRoot.mock.calls[0][0] as React.ReactElement;
    expect(pushed.type).toBe(SummaryCreatePage); // 创建页，不是 SummaryListPage
    expect(pushed.props.source).toBe("summary_home");
    expect(pushed.props.initialMode).toBe("normal");
    // P2-1/P2-5：key 必须存在且随每次进入变化——固定 key 会命中 WKViewQueue 的
    // React 复用分支，重复点菜单不会「重置回默认创建页」。
    expect(String(pushed.key).startsWith("home-normal-")).toBe(true);

    // 再次进入：key 必须不同（强制重挂载，保证重置语义）。
    menu.onPress?.(true);
    expect(state.replaceToRoot).toHaveBeenCalledTimes(2);
    const second = state.replaceToRoot.mock.calls[1][0] as React.ReactElement;
    expect(second.key).not.toBe(pushed.key);
  });

  it("small screens (≤640px) keep landing on the list: no create page pushed into the overlay right pane", () => {
    // P1-2：WKLayout 在 ≤640px 把右栏渲染为覆盖 NavRail 的 fixed 层（z-index 20 > 10），
    // 创建页非面板模式没有返回控件，推入即困住用户。小屏应保持 popToRoot 旧行为。
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 600, configurable: true, writable: true });
    try {
      const menu = summaryMenuFactory()();
      menu.onPress?.(false);

      expect(state.popToRoot).toHaveBeenCalledTimes(2); // routeLeft + routeRight
      expect(state.replaceToRoot).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true, writable: true });
    }
  });

  it("does not double-fetch when boot repairs Space before publishing ready", () => {
    registeredHandler("space-changed")();
    expect(refreshSummaryAttentionBadge).not.toHaveBeenCalled();

    registeredHandler("space-ready")();
    expect(refreshSummaryAttentionBadge).toHaveBeenCalledTimes(1);

    registeredHandler("space-changed")();
    expect(refreshSummaryAttentionBadge).toHaveBeenCalledTimes(2);
  });

  it("zeroes the badge on a Space switch so a failed refresh cannot show the previous Space's count", () => {
    // The refresh fails silently by design (the badge is a nicety, not worth a
    // toast). Without zeroing first, that failure mode is "another Space's
    // number" rather than "no number" — far more misleading now that the count
    // means unread ∪ invitations ∪ pending submissions rather than invitations
    // alone.
    registeredHandler("space-ready")();
    vi.mocked(setSummaryAttentionBadge).mockClear();

    registeredHandler("space-changed")();

    expect(setSummaryAttentionBadge).toHaveBeenCalledWith(0);
  });

  it("does not zero the badge on the cold-start space-changed that precedes space-ready", () => {
    // Boot may emit space-changed before space-ready; that path deliberately
    // defers to space-ready, so it must not clear the badge either.
    registeredHandler("space-changed")();

    expect(setSummaryAttentionBadge).not.toHaveBeenCalled();
  });
});
