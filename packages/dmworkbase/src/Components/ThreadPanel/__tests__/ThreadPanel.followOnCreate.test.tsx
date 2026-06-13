// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  threadCreate: vi.fn(),
  followThread: vi.fn(),
  sidebarSync: vi.fn(),
  emit: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  wkConfirm: vi.fn(),
  loadThreads: vi.fn(),
}));

vi.mock("../../../App", () => ({
  __esModule: true,
  default: {
    dataSource: {
      channelDataSource: { threadCreate: hoisted.threadCreate },
    },
    loginInfo: { uid: "owner-uid" },
    shared: { deviceId: "dev-1", currentSpaceId: "space-1" },
    mittBus: { emit: hoisted.emit },
    endpoints: { showConversation: vi.fn() },
  },
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { success: hoisted.toastSuccess, error: hoisted.toastError, info: vi.fn(), close: vi.fn() },
  Spin: () => null,
  Popover: ({ children }: any) => children,
}));

vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string; channelType: number;
    constructor(id: string, type: number) { this.channelID = id; this.channelType = type; }
  }
  return {
    Channel, ChannelTypePerson: 1, ChannelTypeGroup: 2,
    WKSDK: { shared: () => ({ channelManager: {} }) },
  };
});

vi.mock("../../Conversation", () => ({ Conversation: () => null }));
vi.mock("../../FilePreviewPanel/FileListPanel", () => ({ FileListPanel: () => null }));
vi.mock("../../FilePreviewPanel/FilePreviewHeader", () => ({ __esModule: true, default: () => null }));
vi.mock("../../FilePreviewPanel/registry", () => ({ fileRendererRegistry: { getRenderer: () => ({ renderer: () => null }) } }));
vi.mock("../../FilePreviewPanel/renderers/MarkdownRenderer", () => ({ MarkdownRenderer: () => null }));
vi.mock("../../FilePreviewPanel/renderers/HtmlRenderer", () => ({ HtmlRenderer: () => null }));
vi.mock("../../FilePreviewPanel/renderers/ImageRenderer", () => ({ ImageRenderer: () => null }));
vi.mock("../../../Service/CategoryService", () => ({ __esModule: true, default: {} }));
vi.mock("../../WKModal", () => ({ wkConfirm: hoisted.wkConfirm }));

vi.mock("../../../Service/FollowService", () => ({
  __esModule: true,
  default: { followThread: hoisted.followThread },
}));
vi.mock("../../../Service/SidebarService", () => ({
  __esModule: true,
  default: { sync: hoisted.sidebarSync },
  SidebarTargetType: { DM: 1, CHANNEL: 2, THREAD: 5 },
}));

import ThreadPanel from "../index";

const CREATED = { channel_id: "g1____t1", short_id: "t1", group_no: "g1" };

// 在 React 元素树里找到 <input> 并取其 onChange（handleCreateThread 用闭包变量
// 记录子区名）。避免 monorepo 多 React 副本导致的 DOM 渲染落空。
function findInputOnChange(node: any): ((e: any) => void) | null {
  if (!node || typeof node !== "object") return null;
  if (node.type === "input" && node.props?.onChange) return node.props.onChange;
  const children = node.props?.children;
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    const found = findInputOnChange(c);
    if (found) return found;
  }
  return null;
}

// 直接实例化 ThreadPanel 并调用 handleCreateThread（私有方法，通过实例访问），
// 通过 mock 的 wkConfirm 捕获弹窗配置，填名后调用 onOk 驱动创建+自动关注链路。
async function runCreateFlow(threadName = "新子区") {
  const inst: any = new (ThreadPanel as any)({
    groupNo: "g1", thread: null, onClose: vi.fn(), onThreadSelect: vi.fn(),
  });
  inst.loadThreads = hoisted.loadThreads;
  inst.handleCreateThread();

  expect(hoisted.wkConfirm).toHaveBeenCalledTimes(1);
  const config = hoisted.wkConfirm.mock.calls[0][0] as any;
  const onChange = findInputOnChange(config.content);
  expect(onChange).toBeTypeOf("function");
  onChange!({ target: { value: threadName } });
  await config.onOk();
}

describe("ThreadPanel handleCreateThread auto-follow (GH#292)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.threadCreate.mockResolvedValue(CREATED);
  });

  it("父群已关注 → followThread 被调一次，入参 thread_channel_id 正确", async () => {
    hoisted.sidebarSync.mockResolvedValue({
      items: [{ target_type: 2, target_id: "g1", is_followed: true }],
    });
    await runCreateFlow();

    expect(hoisted.threadCreate).toHaveBeenCalledWith("g1", "新子区");
    expect(hoisted.followThread).toHaveBeenCalledTimes(1);
    expect(hoisted.followThread).toHaveBeenCalledWith({ thread_channel_id: "g1____t1" });
    expect(hoisted.loadThreads).toHaveBeenCalledTimes(1);
  });

  it("父群未关注 → followThread 不被调，创建反馈仍触发", async () => {
    hoisted.sidebarSync.mockResolvedValue({
      items: [{ target_type: 2, target_id: "other", is_followed: true }],
    });
    await runCreateFlow();

    expect(hoisted.threadCreate).toHaveBeenCalledWith("g1", "新子区");
    expect(hoisted.followThread).not.toHaveBeenCalled();
    expect(hoisted.toastSuccess).toHaveBeenCalledTimes(1);
    expect(hoisted.loadThreads).toHaveBeenCalledTimes(1);
  });
});
