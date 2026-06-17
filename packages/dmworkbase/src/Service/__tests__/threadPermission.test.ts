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

import { canManageThread, canEditThreadName, canArchiveThread } from "../threadPermission";
import { GroupRole } from "../Const";

const GROUP_NO = "g1";
const GROUP_KEY = `${GROUP_NO}-2`;

function setGroupMembers(members: Array<{ uid: string; role: number }>) {
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

// issue #394：子区设置页「改名」入口的权限回归。旧代码用恒为 false 的
// isManagerOrCreatorOfMe 判定，导致非创建者的父群群主/管理员被前端拦截。
describe("canEditThreadName (issue #394)", () => {
  beforeEach(() => {
    subscribesByKey.clear();
  });

  it("allows the thread creator (even with empty parent-group cache)", () => {
    expect(
      canEditThreadName({ thread: { creator_uid: "me" }, groupNo: GROUP_NO })
    ).toBe(true);
  });

  it("allows a non-creator parent-group owner — the issue #394 fix", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(
      canEditThreadName({
        thread: { creator_uid: "someone-else" },
        groupNo: GROUP_NO,
      })
    ).toBe(true);
  });

  it("allows a non-creator parent-group manager", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.manager }]);
    expect(
      canEditThreadName({
        thread: { creator_uid: "someone-else" },
        groupNo: GROUP_NO,
      })
    ).toBe(true);
  });

  it("denies an ordinary parent-group member", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.normal }]);
    expect(
      canEditThreadName({
        thread: { creator_uid: "someone-else" },
        groupNo: GROUP_NO,
      })
    ).toBe(false);
  });

  it("honors the isManagerOrCreatorOfMe fallback when the backend does set it", () => {
    // 父群缓存为空时，若子区频道缓存意外给出 true，仍放行（与 canArchiveThread 一致）
    expect(
      canEditThreadName({
        thread: { creator_uid: "someone-else" },
        groupNo: GROUP_NO,
        isManagerOrCreatorOfMeFallback: true,
      })
    ).toBe(true);
  });

  // 一致性回归：改名入口（A）与归档入口共用父群口径，二者权限判定必须始终一致，
  // 避免再次出现「一处能改、一处不能」的撕裂（issue #283 / #394）。
  it("stays consistent with canArchiveThread across the role/fallback matrix", () => {
    const roles = [
      GroupRole.owner,
      GroupRole.manager,
      GroupRole.normal,
      undefined,
    ];
    for (const role of roles) {
      for (const fallback of [true, false, undefined]) {
        for (const creator of ["me", "someone-else"]) {
          subscribesByKey.clear();
          if (role !== undefined) {
            setGroupMembers([{ uid: "me", role }]);
          }
          const args = {
            thread: { creator_uid: creator },
            groupNo: GROUP_NO,
            isManagerOrCreatorOfMeFallback: fallback,
          };
          expect(canEditThreadName(args)).toBe(canArchiveThread(args));
        }
      }
    }
  });
});
