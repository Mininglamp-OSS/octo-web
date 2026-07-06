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

import { canManageThread } from "../threadPermission";
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
