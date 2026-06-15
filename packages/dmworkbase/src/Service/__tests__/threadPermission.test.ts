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

import { canManageThread, canRenameThread } from "../threadPermission";
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

// issue #394：子区设置页「改名」入口此前用 data.isManagerOrCreatorOfMe（读子区频道
// 成员缓存，从未同步、恒 false），把非创建者的父群群主/管理员误拦在前端、不发请求。
// 修复后改名入口（module.tsx）改调 canRenameThread —— 与归档入口同口径。
// 这里覆盖 canRenameThread 自身的契约（创建者 / 父群群主 / 管理员 / 普通成员 /
// undefined groupNo）。注意：本组用例并不证明 module.tsx 仍在调用 canRenameThread；
// 那部分由 module.tsx:2222 的静态 import 与类型检查保障，不在测试范围内。
describe("canRenameThread (thread rename gate, issue #394)", () => {
  beforeEach(() => {
    subscribesByKey.clear();
  });

  it("allows the thread creator to rename", () => {
    expect(canRenameThread({ creator_uid: "me" }, GROUP_NO)).toBe(true);
  });

  it("allows a non-creator parent-group owner to rename", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(canRenameThread({ creator_uid: "someone-else" }, GROUP_NO)).toBe(
      true
    );
  });

  it("allows a non-creator parent-group manager to rename", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.manager }]);
    expect(canRenameThread({ creator_uid: "someone-else" }, GROUP_NO)).toBe(
      true
    );
  });

  it("blocks an ordinary parent-group member from renaming", () => {
    setGroupMembers([{ uid: "me", role: GroupRole.normal }]);
    expect(canRenameThread({ creator_uid: "someone-else" }, GROUP_NO)).toBe(
      false
    );
  });

  it("fails closed when groupNo is undefined for a non-creator", () => {
    // module.tsx 传入的是 threadInfo?.groupNo，可能为 undefined
    setGroupMembers([{ uid: "me", role: GroupRole.owner }]);
    expect(canRenameThread({ creator_uid: "someone-else" }, undefined)).toBe(
      false
    );
  });
});
