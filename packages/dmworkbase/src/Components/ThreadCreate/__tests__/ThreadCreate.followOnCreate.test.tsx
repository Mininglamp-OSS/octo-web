// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock fns shared across module mocks ──
const hoisted = vi.hoisted(() => ({
  threadCreate: vi.fn(),
  followThread: vi.fn(),
  sidebarSync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("../../../App", () => ({
  __esModule: true,
  default: {
    dataSource: {
      channelDataSource: { threadCreate: hoisted.threadCreate },
    },
    shared: { deviceId: "dev-1" },
    mittBus: { emit: hoisted.emit },
  },
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    success: hoisted.toastSuccess,
    error: hoisted.toastError,
    warning: hoisted.toastWarning,
  },
}));

vi.mock("../../../Service/FollowService", () => ({
  __esModule: true,
  default: { followThread: hoisted.followThread },
}));

vi.mock("../../../Service/SidebarService", () => ({
  __esModule: true,
  default: { sync: hoisted.sidebarSync },
  SidebarTargetType: { DM: 1, CHANNEL: 2, THREAD: 5 },
}));

import { ThreadCreate } from "../index";

const CREATED = { channel_id: "g1____t1", short_id: "t1", group_no: "g1" };

// 直接实例化类组件并驱动 handleSubmit（避免 monorepo 内多 React 副本导致的
// testing-library DOM 渲染落空问题；本测试聚焦 threadCreate → 自动关注 的接线）。
function makeInstance(props: any) {
  const inst: any = new (ThreadCreate as any)(props);
  inst.state = { name: "新子区", loading: false };
  inst.setState = (patch: any) => {
    const next = typeof patch === "function" ? patch(inst.state) : patch;
    inst.state = { ...inst.state, ...next };
  };
  return inst;
}

describe("ThreadCreate auto-follow on create (GH#292)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.threadCreate.mockResolvedValue(CREATED);
  });

  it("父群已关注 → followThread 被调一次，入参 thread_channel_id 正确", async () => {
    hoisted.sidebarSync.mockResolvedValue({
      items: [{ target_type: 2, target_id: "g1", is_followed: true }],
    });
    const onSuccess = vi.fn();
    const inst = makeInstance({ groupNo: "g1", onSuccess });
    await inst.handleSubmit();

    expect(hoisted.threadCreate).toHaveBeenCalledWith("g1", "新子区", undefined);
    expect(hoisted.followThread).toHaveBeenCalledTimes(1);
    expect(hoisted.followThread).toHaveBeenCalledWith({ thread_channel_id: "g1____t1" });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("父群未关注 → followThread 不被调，创建反馈仍触发", async () => {
    hoisted.sidebarSync.mockResolvedValue({
      items: [{ target_type: 2, target_id: "other", is_followed: true }],
    });
    const onSuccess = vi.fn();
    const inst = makeInstance({ groupNo: "g1", onSuccess });
    await inst.handleSubmit();

    expect(hoisted.followThread).not.toHaveBeenCalled();
    expect(hoisted.toastSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
