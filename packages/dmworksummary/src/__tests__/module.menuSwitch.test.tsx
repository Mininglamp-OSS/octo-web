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
vi.mock("../utils/summaryMenuBadge", () => ({
  getPendingInvitationBadge: () => 0,
  refreshPendingInvitationBadge: vi.fn(),
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
import { refreshPendingInvitationBadge } from "../utils/summaryMenuBadge";

function registeredHandler(event: string): () => void {
  const call = vi.mocked(WKApp.mittBus.on).mock.calls.find(
    ([registeredEvent]) => registeredEvent === event
  );
  if (!call) throw new Error(`Missing ${event} handler`);
  return call[1] as () => void;
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

  it("refreshes the invitation badge once when the initial Space becomes ready", () => {
    registeredHandler("space-ready")();

    expect(refreshPendingInvitationBadge).toHaveBeenCalledTimes(1);
  });

  it("NavRail summary onPress opens the create page by default without pushing a duplicate list page", () => {
    // #1461 回归：菜单激活后主区 SummaryListPage 已由 MainContentLeft 按
    // currentMenus.routePath(/summary) 渲染唯一实例，onPress 若再 replaceToRoot
    // /summary 会造出双实例（e2e strict mode violation）。
    // 新需求：进入智能总结右栏默认展示新建总结页（取代欢迎占位页）——只推创建页，
    // 绝不推列表页。
    const reg = vi.mocked(WKApp.menus.register);
    const factory = reg.mock.calls.find(([id]) => id === "summary")?.[1] as () => { onPress?: (reentry?: boolean) => void };
    expect(factory).toBeTruthy();
    const menu = factory();
    menu.onPress?.(false);

    // 只清左栈；右栈由 replaceToRoot 直接落创建页。
    expect(state.popToRoot).toHaveBeenCalledTimes(1); // routeLeft only
    expect(state.replaceToRoot).toHaveBeenCalledTimes(1);

    const pushed = state.replaceToRoot.mock.calls[0][0] as React.ReactElement;
    expect(pushed.type).toBe(SummaryCreatePage); // 创建页，不是 SummaryListPage
    expect(pushed.props.source).toBe("summary_home");
    expect(pushed.props.initialMode).toBe("normal");
  });

  it("does not double-fetch when boot repairs Space before publishing ready", () => {
    registeredHandler("space-changed")();
    expect(refreshPendingInvitationBadge).not.toHaveBeenCalled();

    registeredHandler("space-ready")();
    expect(refreshPendingInvitationBadge).toHaveBeenCalledTimes(1);

    registeredHandler("space-changed")();
    expect(refreshPendingInvitationBadge).toHaveBeenCalledTimes(2);
  });
});
