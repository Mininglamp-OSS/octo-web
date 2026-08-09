import { describe, it, expect, vi, beforeEach } from "vitest";

// 内存版父群成员缓存，测试通过它同时驱动 getSubscribes 与 subscribeCacheMap
// （生产里两者是同一份存储），从而覆盖 ensureRenameMemberResolved 的 wiring。
const subscribesByKey = new Map<string, any[]>();
const notifySubscribeChangeListeners = vi.fn();
// 单成员接口（GET groups/{id}/members/{uid}）的 mock，按测试注入返回值。
const subscriberFn = vi.fn();

const sharedSdk = {
  channelManager: {
    subscribeCacheMap: subscribesByKey,
    getSubscribes: (channel: { getChannelKey: () => string }) =>
      subscribesByKey.get(channel.getChannelKey()),
    notifySubscribeChangeListeners,
  },
};

vi.mock("wukongimjssdk", () => ({
  default: {
    shared: () => sharedSdk,
  },
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
    shared: () => sharedSdk,
  },
}));

vi.mock("../../App", () => ({
  default: {
    loginInfo: { uid: "me" },
    dataSource: {
      channelDataSource: {
        // 惰性转发到 subscriberFn，避免在 mock 工厂构造期（const 初始化前）触发 TDZ。
        subscriber: (channel: any, uid: string) => subscriberFn(channel, uid),
      },
    },
  },
}));

import {
  canManageThread,
  canRenameGroup,
  canRenameThread,
  ensureRenameMemberResolved,
} from "../threadPermission";
import { GroupRole, SubscriberStatus } from "../Const";

const GROUP_NO = "g1";
const GROUP_KEY = `${GROUP_NO}-2`;
const flushMicrotasks = () =>
  new Promise((resolve) => setTimeout(resolve, 0));

function setGroupMembers(
  members: Array<{
    uid: string;
    role?: number;
    status?: number;
    orgData?: { robot?: number };
  }>
) {
  subscribesByKey.set(GROUP_KEY, members);
}

describe("canManageThread", () => {
  beforeEach(() => {
    subscribesByKey.clear();
  });

  it("returns false when thread is missing", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(canManageThread(null, GROUP_NO)).toBe(false);
    expect(canManageThread(undefined, GROUP_NO)).toBe(false);
  });

  it("returns true for the thread creator", () => {
    // 即便父群没有成员缓存，创建者也成立
    expect(canManageThread({ creator_uid: "me" }, GROUP_NO)).toBe(true);
  });

  it("returns true for parent-group owner who is not the creator", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(canManageThread({ creator_uid: "someone-else" }, GROUP_NO)).toBe(
      true
    );
  });

  it("returns true for parent-group manager who is not the creator", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.manager }]);
    expect(canManageThread({ creator_uid: "someone-else" }, GROUP_NO)).toBe(
      true
    );
  });

  it("returns false for an ordinary parent-group member", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.normal }]);
    expect(canManageThread({ creator_uid: "someone-else" }, GROUP_NO)).toBe(
      false
    );
  });

  it("returns false (and does not throw) when the member cache is empty", () => {
    // 父群成员缓存从未同步：getSubscribes 返回 undefined
    expect(() =>
      canManageThread({ creator_uid: "someone-else" }, GROUP_NO)
    ).not.toThrow();
    expect(canManageThread({ creator_uid: "someone-else" }, GROUP_NO)).toBe(
      false
    );
  });

  it("returns false when groupNo is empty for a non-creator", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(canManageThread({ creator_uid: "someone-else" }, "")).toBe(false);
  });
});

// WS-23：群/子区改名放开给普通成员（服务端 octo-server #542）。前端 gate 从
// manager-only / 创建者口径改为「活跃人类成员即可」，只挡龙虾（orgData.robot === 1）
// 与黑名单（status === blacklist）。
describe("canRenameGroup (group rename gate, WS-23)", () => {
  it("allows an ordinary active member to rename the group", () => {
    expect(
      canRenameGroup({ uid: "me", role: GroupRole.normal } as any)
    ).toBe(true);
  });

  it("allows an owner/manager to rename the group", () => {
    expect(canRenameGroup({ uid: "me", role: GroupRole.owner } as any)).toBe(
      true
    );
    expect(
      canRenameGroup({ uid: "me", role: GroupRole.manager } as any)
    ).toBe(true);
  });

  it("allows a member record with no orgData or with robot: 0", () => {
    expect(canRenameGroup({ uid: "me", orgData: {} } as any)).toBe(true);
    expect(
      canRenameGroup({ uid: "me", orgData: { robot: 0 } } as any)
    ).toBe(true);
  });

  it("blocks a robot (lobster) member", () => {
    expect(
      canRenameGroup({ uid: "bot", orgData: { robot: 1 } } as any)
    ).toBe(false);
  });

  it("blocks a blacklisted member", () => {
    expect(
      canRenameGroup({
        uid: "me",
        status: SubscriberStatus.blacklist,
      } as any)
    ).toBe(false);
  });

  it("fails closed when the member record is missing (not a member / cache cold)", () => {
    expect(canRenameGroup(undefined)).toBe(false);
    expect(canRenameGroup(null)).toBe(false);
  });
});

// WS-23：子区改名 gate 也放开——任何父群活跃人类成员即可。创建者走 cache-independent
// 快路径（thread.creator_uid），不依赖父群订阅缓存；其余成员从父群订阅解析，父群缓存
// 未热且非创建者 → false（降级，安全）。
describe("canRenameThread (thread rename gate, WS-23)", () => {
  beforeEach(() => {
    subscribesByKey.clear();
  });

  it("allows an ordinary active parent-group member to rename", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.normal }]);
    expect(canRenameThread(GROUP_NO)).toBe(true);
  });

  it("allows a parent-group owner/manager to rename", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(canRenameThread(GROUP_NO)).toBe(true);
  });

  it("allows the thread creator even when the parent-group cache is cold", () => {
    // 创建者快路径与父群订阅缓存无关：缓存为空也放行（超级群父群冷缓存回归防护）
    expect(canRenameThread(GROUP_NO, { creator_uid: "me" })).toBe(true);
  });

  it("does not treat a non-creator as creator via the shortcut", () => {
    // 非创建者且父群缓存冷 → 落到成员判定 → false（不被快路径误放）
    expect(canRenameThread(GROUP_NO, { creator_uid: "someone-else" })).toBe(
      false
    );
  });

  it("blocks a robot (lobster) parent-group member", () => {
    setGroupMembers([{ uid: "me", orgData: { robot: 1 } }]);
    expect(canRenameThread(GROUP_NO)).toBe(false);
  });

  it("blocks a blacklisted parent-group member", () => {
    setGroupMembers([{ uid: "me", status: SubscriberStatus.blacklist }]);
    expect(canRenameThread(GROUP_NO)).toBe(false);
  });

  it("blocks a user who is not a parent-group member", () => {
    setGroupMembers([{ uid: "someone-else", role: GroupRole.owner }]);
    expect(canRenameThread(GROUP_NO)).toBe(false);
  });

  it("fails closed when the parent-group member cache is empty", () => {
    expect(() => canRenameThread(GROUP_NO)).not.toThrow();
    expect(canRenameThread(GROUP_NO)).toBe(false);
  });

  it("fails closed when groupNo is undefined", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(canRenameThread(undefined)).toBe(false);
  });
});

// 生产 wiring 回归（Octo-Q review 4891675677）：supergroup 父群成员缓存可能不含当前用户，
// 渲染侧调用 ensureRenameMemberResolved 应通过单成员接口补齐当前用户记录并入共享缓存，
// 使后续 canRenameThread 看到该记录——仅靠手喂 cache mock 的纯函数测试挡不住这类 wiring 回归。
describe("ensureRenameMemberResolved (cold-cache wiring, WS-23)", () => {
  beforeEach(() => {
    subscribesByKey.clear();
    subscriberFn.mockReset();
    notifySubscribeChangeListeners.mockClear();
  });

  it("resolves the current user on demand when absent from the parent-group cache, so the gate then passes", async () => {
    const WGROUP = "gw-resolve";
    const WKEY = `${WGROUP}-2`;
    // 冷缓存：父群里没有当前用户，且当前用户不是创建者 → 初始 false
    subscribesByKey.set(WKEY, [{ uid: "someone-else", role: GroupRole.normal }]);
    expect(canRenameThread(WGROUP)).toBe(false);

    // 单成员接口返回当前用户的成员记录
    subscriberFn.mockResolvedValue({ uid: "me", orgData: { robot: 0 } });

    ensureRenameMemberResolved(WGROUP);
    await flushMicrotasks();

    // 已按需拉取、并入共享缓存、并通知订阅变更以触发重渲染
    expect(subscriberFn).toHaveBeenCalledTimes(1);
    expect(
      (subscribesByKey.get(WKEY) || []).some((s: any) => s.uid === "me")
    ).toBe(true);
    expect(notifySubscribeChangeListeners).toHaveBeenCalled();
    // 后续 gate 看到当前用户记录 → 放行
    expect(canRenameThread(WGROUP)).toBe(true);
  });

  it("stays fail-closed and does not merge when the user is not a parent-group member", async () => {
    const WGROUP = "gw-nonmember";
    const WKEY = `${WGROUP}-2`;
    subscribesByKey.set(WKEY, [{ uid: "someone-else", role: GroupRole.owner }]);
    // 单成员接口命中不到当前用户
    subscriberFn.mockResolvedValue(undefined);

    ensureRenameMemberResolved(WGROUP);
    await flushMicrotasks();

    expect(subscriberFn).toHaveBeenCalledTimes(1);
    expect(
      (subscribesByKey.get(WKEY) || []).some((s: any) => s.uid === "me")
    ).toBe(false);
    expect(canRenameThread(WGROUP)).toBe(false);
  });

  it("skips the lookup entirely when the current user is already cached", async () => {
    const WGROUP = "gw-cached";
    const WKEY = `${WGROUP}-2`;
    subscribesByKey.set(WKEY, [{ uid: "me", role: GroupRole.normal }]);

    ensureRenameMemberResolved(WGROUP);
    await flushMicrotasks();

    expect(subscriberFn).not.toHaveBeenCalled();
  });
});
