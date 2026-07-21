// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ThreadStatus } from "../../../Service/Thread";

// ── Hoisted mock fns shared across module mocks ──
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
  setChannleInfoForCache: vi.fn(),
  notifyListeners: vi.fn(),
  emit: vi.fn(),
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
    remoteConfig: {
      messagesSearchOn: false,
      addConfigChangeListener: vi.fn(() => vi.fn()),
    },
    shared: { deviceId: "dev-1", currentSpaceId: "space-1" },
    mittBus: { emit: hoisted.emit },
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

vi.mock("react-virtuoso", () => ({
  Virtuoso: () => null,
  TableVirtuoso: () => null,
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
  const sdk = {
    shared: () => ({
      channelManager: {
        getSubscribes: hoisted.getSubscribes,
        getChannelInfo: hoisted.getChannelInfo,
        deleteChannelInfo: hoisted.deleteChannelInfo,
        fetchChannelInfo: hoisted.fetchChannelInfo,
        setChannleInfoForCache: hoisted.setChannleInfoForCache,
        notifyListeners: hoisted.notifyListeners,
      },
    }),
  };
  return {
    default: sdk,
    Channel,
    MessageContent: class {},
    MediaMessageContent: class {},
    ChannelTypePerson: 1,
    ChannelTypeGroup: 2,
    WKSDK: sdk,
  };
});

// Heavy sub-trees not needed for list-view interaction tests.
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
vi.mock("../../../bridge/thread/createThread", () => ({
  createThreadByNameAndNotify: vi.fn(),
}));
vi.mock("../../../ui/ThreadCreateDialog", () => ({
  __esModule: true,
  default: () => null,
}));

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

const ARCHIVED_THREAD = {
  ...ACTIVE_THREAD,
  short_id: "t2",
  channel_id: "g1____t2",
  name: "Archived Thread",
  status: ThreadStatus.Archived,
};

function archiveButton(): HTMLElement | null {
  return document.querySelector(".wk-thread-panel-item-archive-btn");
}

async function renderPanel(threads: any[], canEdit = true) {
  hoisted.threadList.mockResolvedValue(threads);
  // canEditThread: creator_uid === loginInfo.uid ⇒ owner; toggle via creator match.
  hoisted.getSubscribes.mockReturnValue(
    canEdit ? [{ uid: "owner-uid", role: 1 /* owner */ }] : []
  );
  const props = {
    groupNo: "g1",
    thread: null,
    onClose: vi.fn(),
    onThreadSelect: vi.fn(),
  };
  render(React.createElement(ThreadPanel, props));
  await waitFor(() =>
    expect(screen.getByText(threads[0].name)).toBeTruthy()
  );
  return props;
}

async function renderPanelWithUnmount(threads: any[], canEdit = true) {
  hoisted.threadList.mockResolvedValue(threads);
  hoisted.getSubscribes.mockReturnValue(
    canEdit ? [{ uid: "owner-uid", role: 1 /* owner */ }] : []
  );
  const result = render(
    React.createElement(ThreadPanel, {
      groupNo: "g1",
      thread: null,
      onClose: vi.fn(),
      onThreadSelect: vi.fn(),
    })
  );
  await waitFor(() => expect(screen.getByText(threads[0].name)).toBeTruthy());
  return result;
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

describe("ThreadPanel inline archive button", () => {
  it("点击归档按钮调用 threadArchive 参数正确，并弹出撤销 Toast", async () => {
    await renderPanel([ACTIVE_THREAD]);
    const btn = archiveButton();
    expect(btn).toBeTruthy();

    await act(async () => {
      fireEvent.click(btn!);
    });

    expect(hoisted.threadArchive).toHaveBeenCalledWith("g1", "t1");
    await waitFor(() => expect(hoisted.toastInfo).toHaveBeenCalledTimes(1));
  });

  it("点击归档不触发整行 handleThreadClick（e.stopPropagation 生效）", async () => {
    const props = await renderPanel([ACTIVE_THREAD]);
    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    // 进入 detail 视图会调用 onThreadSelect(thread)；stopPropagation 后不应触发
    expect(props.onThreadSelect).not.toHaveBeenCalled();
  });

  it("归档失败回滚乐观状态并 Toast.error", async () => {
    hoisted.threadArchive.mockRejectedValue(new Error("boom"));
    await renderPanel([ACTIVE_THREAD]);
    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    await waitFor(() => expect(hoisted.toastError).toHaveBeenCalledTimes(1));
    // 回滚后仍在活跃组，按钮 data-action 仍为 archive
    expect(archiveButton()?.getAttribute("data-action")).toBe("archive");
  });

  it("无编辑权限时不渲染归档按钮", async () => {
    // 非创建者 + 非群主/管理员 ⇒ canEditThread 为 false
    await renderPanel(
      [{ ...ACTIVE_THREAD, creator_uid: "someone-else" }],
      /* canEdit */ false
    );
    expect(archiveButton()).toBeNull();
  });

  it("已归档行点击直接调用 threadUnarchive（无撤销 Toast）", async () => {
    hoisted.threadList.mockResolvedValue([ARCHIVED_THREAD]);
    hoisted.getSubscribes.mockReturnValue([{ uid: "owner-uid", role: 1 }]);
    render(
      React.createElement(ThreadPanel, {
        groupNo: "g1",
        thread: null,
        onClose: vi.fn(),
        onThreadSelect: vi.fn(),
      })
    );
    // 已归档分组默认折叠，需先展开
    await waitFor(() => expect(screen.getByText("已归档")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("已归档"));
    });
    await waitFor(() => expect(archiveButton()).toBeTruthy());

    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    expect(hoisted.threadUnarchive).toHaveBeenCalledWith("g1", "t2");
    expect(hoisted.toastInfo).not.toHaveBeenCalled();
  });

  it("点击撤销调用 threadUnarchive 恢复", async () => {
    await renderPanel([ACTIVE_THREAD]);
    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    await waitFor(() => expect(hoisted.toastInfo).toHaveBeenCalled());

    // 取出 Toast 自定义 content，点击其中的「撤销」按钮
    const content = hoisted.toastInfo.mock.calls[0][0].content as React.ReactElement;
    render(content);
    const undoBtn = await waitFor(() => {
      const el = document.querySelector(".wk-thread-archive-undo-btn");
      if (!el) throw new Error("undo button not rendered yet");
      return el;
    });
    expect(undoBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(undoBtn!);
    });
    expect(hoisted.threadUnarchive).toHaveBeenCalledWith("g1", "t1");
    expect(hoisted.toastClose).toHaveBeenCalledWith("toast-id-1");
  });

  it("超时未点撤销不会调用 threadUnarchive", async () => {
    await renderPanel([ACTIVE_THREAD]);
    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    await waitFor(() => expect(hoisted.threadArchive).toHaveBeenCalled());
    // 不点击撤销：threadUnarchive 永远不应被调用
    expect(hoisted.threadUnarchive).not.toHaveBeenCalled();
  });

  it("卸载后点撤销不应再发 threadUnarchive 请求（B1 回归）", async () => {
    const { unmount } = await renderPanelWithUnmount([ACTIVE_THREAD]);
    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    await waitFor(() => expect(hoisted.toastInfo).toHaveBeenCalled());

    // 取出撤销 Toast 的 content（渲染在全局 portal，不随面板卸载销毁）
    const content = hoisted.toastInfo.mock.calls[0][0].content as React.ReactElement;
    render(content);
    const undoBtn = await waitFor(() => {
      const el = document.querySelector(".wk-thread-archive-undo-btn");
      if (!el) throw new Error("undo button not rendered yet");
      return el;
    });

    // 面板卸载：componentWillUnmount 应 Toast.close 撤销 Toast 并清理集合
    await act(async () => {
      unmount();
    });
    expect(hoisted.toastClose).toHaveBeenCalledWith("toast-id-1");

    // 卸载后点撤销：isUnmounted 短路，不应再发 threadUnarchive
    await act(async () => {
      fireEvent.click(undoBtn!);
    });
    expect(hoisted.threadUnarchive).not.toHaveBeenCalled();
  });

  it("连点两次行内归档按钮只发一次 threadArchive（防重复点击闸门）", async () => {
    // threadArchive 挂起，模拟请求进行中连点：archivingShortIds 闸门应拦住第二次
    let resolveArchive: () => void = () => {};
    hoisted.threadArchive.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveArchive = resolve;
      })
    );
    await renderPanel([ACTIVE_THREAD]);
    const btn = archiveButton();
    expect(btn).toBeTruthy();

    await act(async () => {
      fireEvent.click(btn!);
      fireEvent.click(btn!);
    });

    expect(hoisted.threadArchive).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveArchive();
    });
  });

  it("归档请求在途时卸载：resolve 后不再建撤销 Toast / 刷新（在途竞态回归）", async () => {
    let resolveArchive: () => void = () => {};
    hoisted.threadArchive.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveArchive = resolve;
      })
    );
    const { unmount } = await renderPanelWithUnmount([ACTIVE_THREAD]);

    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    expect(hoisted.threadArchive).toHaveBeenCalledTimes(1);

    // 请求 resolve 前卸载面板
    await act(async () => {
      unmount();
    });

    // 现在 resolve 在途请求：isUnmounted 短路，不应再建撤销 Toast 或刷新频道信息
    await act(async () => {
      resolveArchive();
    });
    expect(hoisted.toastInfo).not.toHaveBeenCalled();
    expect(hoisted.deleteChannelInfo).not.toHaveBeenCalled();
    expect(hoisted.fetchChannelInfo).not.toHaveBeenCalled();
  });

  it("归档请求在途时卸载：reject 后不再回滚乐观状态（在途 reject 竞态回归）", async () => {
    let rejectArchive: (e: Error) => void = () => {};
    hoisted.threadArchive.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectArchive = reject;
      })
    );
    const { unmount } = await renderPanelWithUnmount([ACTIVE_THREAD]);

    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    expect(hoisted.threadArchive).toHaveBeenCalledTimes(1);

    await act(async () => {
      unmount();
    });

    // reject 在途请求：catch 块开头 isUnmounted 短路，不应回滚（setThreadStatusOptimistic）
    // 也不应 Toast.error。
    await act(async () => {
      rejectArchive(new Error("boom"));
    });
    expect(hoisted.toastError).not.toHaveBeenCalled();
  });

  it("取消归档请求在途时卸载：resolve 后不再刷新 / loadThreads（在途竞态回归）", async () => {
    let resolveUnarchive: () => void = () => {};
    hoisted.threadUnarchive.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveUnarchive = resolve;
      })
    );
    hoisted.threadList.mockResolvedValue([ARCHIVED_THREAD]);
    hoisted.getSubscribes.mockReturnValue([{ uid: "owner-uid", role: 1 }]);
    const { unmount } = render(
      React.createElement(ThreadPanel, {
        groupNo: "g1",
        thread: null,
        onClose: vi.fn(),
        onThreadSelect: vi.fn(),
      })
    );
    await waitFor(() => expect(screen.getByText("已归档")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("已归档"));
    });
    await waitFor(() => expect(archiveButton()).toBeTruthy());

    // 初次列表加载已调用过 threadList，记录基线后只观察卸载后是否再次调用
    const threadListCallsBefore = hoisted.threadList.mock.calls.length;

    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    expect(hoisted.threadUnarchive).toHaveBeenCalledWith("g1", "t2");

    await act(async () => {
      unmount();
    });

    // resolve 在途请求：isUnmounted 短路，不应 refreshThreadChannelInfo / loadThreads
    await act(async () => {
      resolveUnarchive();
    });
    expect(hoisted.deleteChannelInfo).not.toHaveBeenCalled();
    expect(hoisted.fetchChannelInfo).not.toHaveBeenCalled();
    expect(hoisted.threadList.mock.calls.length).toBe(threadListCallsBefore);
  });

  it("撤销请求在途时卸载：resolve 后不再刷新 / loadThreads（撤销在途竞态回归）", async () => {
    let resolveUnarchive: () => void = () => {};
    hoisted.threadUnarchive.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveUnarchive = resolve;
      })
    );
    const { unmount } = await renderPanelWithUnmount([ACTIVE_THREAD]);

    // 归档创建撤销 Toast
    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    await waitFor(() => expect(hoisted.toastInfo).toHaveBeenCalled());

    // 取出撤销 Toast 的 content 并点击「撤销」，threadUnarchive 进入在途状态
    const content = hoisted.toastInfo.mock.calls[0][0].content as React.ReactElement;
    render(content);
    const undoBtn = await waitFor(() => {
      const el = document.querySelector(".wk-thread-archive-undo-btn");
      if (!el) throw new Error("undo button not rendered yet");
      return el;
    });
    const threadListCallsBefore = hoisted.threadList.mock.calls.length;
    await act(async () => {
      fireEvent.click(undoBtn!);
    });
    expect(hoisted.threadUnarchive).toHaveBeenCalledWith("g1", "t1");

    // 记录基线：归档成功路径已调用过 refreshThreadChannelInfo，只观察卸载后是否再次调用
    const deleteCallsBefore = hoisted.deleteChannelInfo.mock.calls.length;
    const fetchCallsBefore = hoisted.fetchChannelInfo.mock.calls.length;

    // 撤销请求 resolve 前卸载面板
    await act(async () => {
      unmount();
    });

    // resolve 在途请求：isUnmounted 短路，不应 refreshThreadChannelInfo / loadThreads
    await act(async () => {
      resolveUnarchive();
    });
    expect(hoisted.deleteChannelInfo.mock.calls.length).toBe(deleteCallsBefore);
    expect(hoisted.fetchChannelInfo.mock.calls.length).toBe(fetchCallsBefore);
    expect(hoisted.threadList.mock.calls.length).toBe(threadListCallsBefore);
  });

  it("撤销请求在途时卸载：reject 后不再 Toast.error（撤销在途 reject 竞态回归）", async () => {
    let rejectUnarchive: (e: Error) => void = () => {};
    hoisted.threadUnarchive.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectUnarchive = reject;
      })
    );
    const { unmount } = await renderPanelWithUnmount([ACTIVE_THREAD]);

    // 归档创建撤销 Toast
    await act(async () => {
      fireEvent.click(archiveButton()!);
    });
    await waitFor(() => expect(hoisted.toastInfo).toHaveBeenCalled());

    // 取出撤销 Toast 的 content 并点击「撤销」，threadUnarchive 进入在途状态
    const content = hoisted.toastInfo.mock.calls[0][0].content as React.ReactElement;
    render(content);
    const undoBtn = await waitFor(() => {
      const el = document.querySelector(".wk-thread-archive-undo-btn");
      if (!el) throw new Error("undo button not rendered yet");
      return el;
    });
    await act(async () => {
      fireEvent.click(undoBtn!);
    });
    expect(hoisted.threadUnarchive).toHaveBeenCalledWith("g1", "t1");

    // 撤销请求 reject 前卸载面板
    await act(async () => {
      unmount();
    });

    // reject 在途请求：catch 块开头 isUnmounted 短路，不应 Toast.error
    await act(async () => {
      rejectUnarchive(new Error("boom"));
    });
    expect(hoisted.toastError).not.toHaveBeenCalled();
  });
});

// 入口对齐回归（issue #345）：行内归档 / 取消归档成功分支都经共享同步函数
// syncThreadArchiveState 触发。新实现用调用方传入的权威 status 直接写回 channelInfo
// 缓存（setChannleInfoForCache + notifyListeners），再 emit("sidebar-reload")，
// 不再绕异步 fetchChannelInfo，避免被在途旧请求覆盖（B1 去重竞态）。
describe("ThreadPanel inline archive sidebar sync (issue #345)", () => {
  it("行内归档成功后写回权威 Archived 状态并 emit('sidebar-reload')", async () => {
    // 提供 live channelInfo，验证权威 status 原地写回
    const channelInfo: any = {
      channel: { channelID: "g1____t1", channelType: 5 },
      orgData: { thread: { status: ThreadStatus.Active } },
    };
    hoisted.getChannelInfo.mockReturnValue(channelInfo);

    await renderPanel([ACTIVE_THREAD]);

    await act(async () => {
      fireEvent.click(archiveButton()!);
    });

    await waitFor(() => expect(hoisted.threadArchive).toHaveBeenCalledWith("g1", "t1"));
    await waitFor(() =>
      expect(hoisted.emit).toHaveBeenCalledWith("sidebar-reload")
    );
    // 权威 status 写回缓存并通知监听器
    expect(channelInfo.orgData.thread.status).toBe(ThreadStatus.Archived);
    expect(hoisted.setChannleInfoForCache).toHaveBeenCalledWith(channelInfo);
    expect(hoisted.notifyListeners).toHaveBeenCalledWith(channelInfo);
    // 不再绕异步 fetchChannelInfo（避免被在途旧请求覆盖）
    expect(hoisted.fetchChannelInfo).not.toHaveBeenCalled();
  });

  it("已归档行点击取消归档成功后写回 Active 并 emit('sidebar-reload')", async () => {
    const channelInfo: any = {
      channel: { channelID: "g1____t2", channelType: 5 },
      orgData: { thread: { status: ThreadStatus.Archived } },
    };
    hoisted.getChannelInfo.mockReturnValue(channelInfo);

    hoisted.threadList.mockResolvedValue([ARCHIVED_THREAD]);
    hoisted.getSubscribes.mockReturnValue([{ uid: "owner-uid", role: 1 }]);
    render(
      React.createElement(ThreadPanel, {
        groupNo: "g1",
        thread: null,
        onClose: vi.fn(),
        onThreadSelect: vi.fn(),
      })
    );
    await waitFor(() => expect(screen.getByText("已归档")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("已归档"));
    });
    await waitFor(() => expect(archiveButton()).toBeTruthy());

    await act(async () => {
      fireEvent.click(archiveButton()!);
    });

    await waitFor(() => expect(hoisted.threadUnarchive).toHaveBeenCalledWith("g1", "t2"));
    await waitFor(() =>
      expect(hoisted.emit).toHaveBeenCalledWith("sidebar-reload")
    );
    expect(channelInfo.orgData.thread.status).toBe(ThreadStatus.Active);
  });
});
