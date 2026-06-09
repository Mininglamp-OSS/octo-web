// @vitest-environment jsdom
//
// 回归 #345：行内归档/取消归档后，侧边栏(关注 Tab 子区列表)的归档过滤
// 读取的是 conv.channelInfo.orgData.thread.status（IM 实时补齐的 live channelInfo）。
// 该字段由 refreshThreadChannelInfo → deleteChannelInfo + fetchChannelInfo 刷新。
//
// 后端把子区状态落库到「IM channelInfo 返回新 status」之间存在短暂异步窗口
// （与发消息后恢复活跃同样的后端 lag，见 THREAD_REACTIVATE_REFRESH_DELAYS_MS
//  以及 reconcileThreadAfterMessageSent 的短轮询）。
//
// 现状 bug：refreshThreadChannelInfo 只做一次性 deleteChannelInfo+fetchChannelInfo，
// 没有重试/短轮询；若这一次 fetch 仍拿到变更前的旧 status，侧边栏 channelInfo
// 永远停留在旧归档态，列表不更新。本测试断言归档路径会短轮询 fetchChannelInfo
// 直到 SDK 的 channelInfo 反映出新 status——稳定失败（当前仅 1 次 fetch），
// 修复(加重试/短轮询)后转绿。
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ThreadStatus } from "../../../Service/Thread";

const hoisted = vi.hoisted(() => ({
  threadArchive: vi.fn(),
  threadUnarchive: vi.fn(),
  threadGet: vi.fn(),
  threadList: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastClose: vi.fn(),
  getSubscribes: vi.fn(),
  deleteChannelInfo: vi.fn(),
  fetchChannelInfo: vi.fn(),
  getChannelInfo: vi.fn(),
}));

vi.mock("../../../App", () => ({
  __esModule: true,
  default: {
    dataSource: {
      channelDataSource: {
        threadArchive: hoisted.threadArchive,
        threadUnarchive: hoisted.threadUnarchive,
        threadGet: hoisted.threadGet,
        threadList: hoisted.threadList,
        channelFiles: vi.fn(),
      },
    },
    loginInfo: { uid: "owner-uid" },
    shared: { deviceId: "dev-1", currentSpaceId: "space-1" },
    mittBus: { emit: vi.fn() },
    endpoints: { showConversation: vi.fn() },
  },
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    info: hoisted.toastInfo,
    error: hoisted.toastError,
    success: hoisted.toastSuccess,
    close: hoisted.toastClose,
  },
  Spin: () => React.createElement("div", { "data-testid": "spin" }),
  Popover: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string;
    channelType: number;
    constructor(id: string, type: number) {
      this.channelID = id;
      this.channelType = type;
    }
  }
  return {
    Channel,
    ChannelTypePerson: 1,
    ChannelTypeGroup: 2,
    WKSDK: {
      shared: () => ({
        channelManager: {
          getSubscribes: hoisted.getSubscribes,
          getChannelInfo: hoisted.getChannelInfo,
          deleteChannelInfo: hoisted.deleteChannelInfo,
          fetchChannelInfo: hoisted.fetchChannelInfo,
        },
      }),
    },
  };
});

vi.mock("../../Conversation", () => ({ Conversation: () => null }));
vi.mock("../../FilePreviewPanel/FileListPanel", () => ({ FileListPanel: () => null }));
vi.mock("../../FilePreviewPanel/FilePreviewHeader", () => ({ __esModule: true, default: () => null }));
vi.mock("../../FilePreviewPanel/registry", () => ({ fileRendererRegistry: { getRenderer: () => ({ renderer: () => null }) } }));
vi.mock("../../FilePreviewPanel/renderers/MarkdownRenderer", () => ({ MarkdownRenderer: () => null }));
vi.mock("../../FilePreviewPanel/renderers/HtmlRenderer", () => ({ HtmlRenderer: () => null }));
vi.mock("../../FilePreviewPanel/renderers/ImageRenderer", () => ({ ImageRenderer: () => null }));
vi.mock("../../../Service/SidebarService", () => ({ __esModule: true, default: { sync: vi.fn().mockResolvedValue(null) } }));
vi.mock("../../../Service/FollowService", () => ({ __esModule: true, default: {} }));
vi.mock("../../../Service/CategoryService", () => ({ __esModule: true, default: {} }));

import ThreadPanel from "../index";

const ACTIVE_THREAD = {
  short_id: "t1",
  group_no: "g1",
  channel_id: "g1____t1",
  channel_type: 5,
  name: "Active Thread",
  creator_uid: "owner-uid",
  status: ThreadStatus.Active,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function archiveButton(): HTMLElement | null {
  return document.querySelector(".wk-thread-panel-item-archive-btn");
}

beforeEach(() => {
  Object.values(hoisted).forEach((fn) => fn.mockReset?.());
  hoisted.toastInfo.mockReturnValue("toast-id-1");
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ThreadPanel 归档 → 侧边栏 channelInfo 状态落稳 (#345)", () => {
  it("归档后短轮询 fetchChannelInfo 直到 channelInfo 反映新 status（后端 lag）", async () => {
    // 模拟后端 lag：归档已落库，但 IM channelInfo 在前若干次 fetch 仍返回
    // 变更前的旧 status(Active)，只有多次刷新后才返回新 status(Archived)。
    // getChannelInfo 是侧边栏归档过滤的真实数据来源——它反映出新 status，
    // 列表才会更新。
    const STABLE_AFTER = 2; // 第 1 次 fetch 仍 stale，之后才落稳
    const makeChannelInfo = (status: number) => ({
      orgData: { thread: { status } },
    });

    hoisted.deleteChannelInfo.mockImplementation(() => {
      // 清缓存：清掉后视为「未知」，直到下一次 fetch 落地
      hoisted.getChannelInfo.mockReturnValue(undefined);
    });
    hoisted.fetchChannelInfo.mockImplementation(() => {
      const n = hoisted.fetchChannelInfo.mock.calls.length;
      // 后端 lag：前 STABLE_AFTER-1 次仍返回旧 Active，之后才返回 Archived
      const status =
        n >= STABLE_AFTER ? ThreadStatus.Archived : ThreadStatus.Active;
      hoisted.getChannelInfo.mockReturnValue(makeChannelInfo(status));
      return Promise.resolve(makeChannelInfo(status));
    });
    hoisted.getChannelInfo.mockReturnValue(makeChannelInfo(ThreadStatus.Active));

    hoisted.threadList.mockResolvedValue([ACTIVE_THREAD]);
    hoisted.threadGet.mockImplementation((_g: string, _id: string) =>
      Promise.resolve({ ...ACTIVE_THREAD, status: ThreadStatus.Archived })
    );
    hoisted.getSubscribes.mockReturnValue([{ uid: "owner-uid", role: 1 }]);

    render(
      React.createElement(ThreadPanel, {
        groupNo: "g1",
        thread: null,
        onClose: vi.fn(),
        onThreadSelect: vi.fn(),
      })
    );
    await waitFor(() => expect(screen.getByText("Active Thread")).toBeTruthy());

    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    await waitFor(() => expect(hoisted.threadArchive).toHaveBeenCalledWith("g1", "t1"));

    // 关键断言：必须持续刷新 channelInfo 直到它反映出新的 Archived 状态。
    // 修复前 refreshThreadChannelInfo 只 fetch 一次（n=1，仍 stale），
    // getChannelInfo 永远停留在 Active → 侧边栏归档过滤看不到变更，断言超时失败。
    await waitFor(
      () => {
        const info = hoisted.getChannelInfo.mock.results.at(-1)?.value as
          | { orgData?: { thread?: { status?: number } } }
          | undefined;
        expect(info?.orgData?.thread?.status).toBe(ThreadStatus.Archived);
      },
      { timeout: 3000 }
    );

    // 单次 fetch 不可能让 channelInfo 落稳：必须 ≥ STABLE_AFTER 次。
    expect(hoisted.fetchChannelInfo.mock.calls.length).toBeGreaterThanOrEqual(
      STABLE_AFTER
    );
  });
});
