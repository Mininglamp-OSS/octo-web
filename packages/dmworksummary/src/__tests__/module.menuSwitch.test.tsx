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
    routeRight: { replaceToRoot: state.replaceToRoot, push: vi.fn() },
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
vi.mock("../utils/channelType", () => ({
  isSupportedChannelType: () => true,
}));
vi.mock("../components/ChatSummaryStarButton", () => ({
  default: () => null,
}));
vi.mock("../components/ChatSummaryPanel", () => ({ default: () => null }));

import { WKApp } from "@octo/base";
import { getSummaryShare } from "../api/summaryApi";
import { SummaryModule } from "../module";

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
});
