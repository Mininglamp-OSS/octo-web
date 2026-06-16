import { describe, it, expect, vi, beforeEach } from "vitest";

// 内存版父群成员缓存，测试通过它驱动 getSubscribes 返回值
const subscribesByKey = new Map<string, Array<{ uid: string; role: number }>>();

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;
    constructor(id: string, type: number) {
      this.channelID = id;
      this.channelType = type;
    }
    getChannelKey() {
      return `${this.channelID}-${this.channelType}`;
    }
  },
  ChannelTypeGroup: 2,
  WKSDK: {
    shared: () => ({
      channelManager: {
        getSubscribes: (channel: { getChannelKey: () => string }) =>
          subscribesByKey.get(channel.getChannelKey()),
      },
    }),
  },
}));

vi.mock("../../App", () => ({
  default: {
    loginInfo: { uid: "me" },
  },
}));

import {
  canArchiveThread,
  shouldShowThreadArchiveAction,
} from "../threadPermission";
import { GroupRole } from "../Const";
import { ThreadStatus } from "../Thread";

const GROUP_NO = "g1";
const GROUP_KEY = `${GROUP_NO}-2`;

function setGroupMembers(members: Array<{ uid: string; role: number }>) {
  subscribesByKey.set(GROUP_KEY, members);
}

/**
 * 入口 B（ThreadPanel）的归档可见性参照实现：
 * canEditThread 调用 canManageThread（角色核心），状态判断在渲染处。
 * 这里复刻其归档项实际可见性，用于一致性回归断言。
 */
function entryBArchiveVisibility(thread: {
  creator_uid?: string;
  status?: number;
}): boolean {
  // canManageThread 经由 canArchiveThread（无 fallback）等价表达
  const canManage = canArchiveThread({ thread, groupNo: GROUP_NO });
  const statusOk =
    thread.status === ThreadStatus.Active ||
    thread.status === ThreadStatus.Archived;
  return canManage && statusOk;
}

describe("thread.actions archive visibility (entry A)", () => {
  beforeEach(() => {
    subscribesByKey.clear();
  });

  it("shows archive action for a non-creator group owner on an Active thread", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(
      shouldShowThreadArchiveAction({
        thread: { creator_uid: "other", status: ThreadStatus.Active },
        groupNo: GROUP_NO,
        isManagerOrCreatorOfMeFallback: false,
      })
    ).toBe(true);
  });

  it("shows unarchive action for a non-creator group owner on an Archived thread", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(
      shouldShowThreadArchiveAction({
        thread: { creator_uid: "other", status: ThreadStatus.Archived },
        groupNo: GROUP_NO,
        isManagerOrCreatorOfMeFallback: false,
      })
    ).toBe(true);
  });

  it("hides archive action for an ordinary parent-group member", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.normal }]);
    expect(
      shouldShowThreadArchiveAction({
        thread: { creator_uid: "other", status: ThreadStatus.Active },
        groupNo: GROUP_NO,
        isManagerOrCreatorOfMeFallback: false,
      })
    ).toBe(false);
  });

  it("does not throw when orgData.thread is missing", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(() =>
      shouldShowThreadArchiveAction({
        thread: undefined,
        groupNo: GROUP_NO,
        isManagerOrCreatorOfMeFallback: false,
      })
    ).not.toThrow();
    // 无 thread → 无状态 → 不渲染
    expect(
      shouldShowThreadArchiveAction({
        thread: undefined,
        groupNo: GROUP_NO,
        isManagerOrCreatorOfMeFallback: false,
      })
    ).toBe(false);
  });

  it("honors the isManagerOrCreatorOfMe fallback when true", () => {
    // 父群缓存为空、非创建者，但兜底为 true → 放行
    expect(
      shouldShowThreadArchiveAction({
        thread: { creator_uid: "other", status: ThreadStatus.Active },
        groupNo: GROUP_NO,
        isManagerOrCreatorOfMeFallback: true,
      })
    ).toBe(true);
  });
});

describe("entry A / entry B archive visibility consistency (issue #283)", () => {
  beforeEach(() => {
    subscribesByKey.clear();
  });

  const roles = [
    { label: "creator", creator_uid: "me", members: [] as Array<{ uid: string; role: number }> },
    {
      label: "non-creator owner",
      creator_uid: "other",
      members: [{ uid: "me", role: GroupRole.owner }],
    },
    {
      label: "non-creator manager",
      creator_uid: "other",
      members: [{ uid: "me", role: GroupRole.manager }],
    },
    {
      label: "ordinary member",
      creator_uid: "other",
      members: [{ uid: "me", role: GroupRole.normal }],
    },
    {
      label: "empty member cache",
      creator_uid: "other",
      members: [] as Array<{ uid: string; role: number }>,
    },
  ];

  const statuses = [
    { label: "Active", status: ThreadStatus.Active },
    { label: "Archived", status: ThreadStatus.Archived },
    { label: "Deleted", status: ThreadStatus.Deleted },
  ];

  for (const role of roles) {
    for (const st of statuses) {
      it(`matches for ${role.label} + ${st.label}`, () => {
        if (role.members.length > 0) {
          setGroupMembers(role.members);
        }
        const thread = { creator_uid: role.creator_uid, status: st.status };

        // 入口 A：不依赖子区缓存兜底（fallback=false），纯父群口径
        const entryA = shouldShowThreadArchiveAction({
          thread,
          groupNo: GROUP_NO,
          isManagerOrCreatorOfMeFallback: false,
        });
        const entryB = entryBArchiveVisibility(thread);

        expect(entryA).toBe(entryB);
      });
    }
  }
});
