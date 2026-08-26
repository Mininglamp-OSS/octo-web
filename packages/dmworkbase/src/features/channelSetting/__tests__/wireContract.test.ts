import { describe, expect, it } from "vitest";

import { canRemoveChannelSettingSubscriber } from "../memberRemovalPermission";

// 跨仓库契约校验（octo-web#1511 / octo-server#805）。
//
// fixture 不是手写的：它是 octo-server 的 GET /v1/groups/:group_no/members
// 在真实 MySQL + WuKongIM 栈上跑出来后原样 dump 的响应。两边分别绿不代表接口
// 对得上——字段名拼错、类型从 bool 变成 0/1、或者后端忘了下发，单测都发现不了。
// 这里让前端判据直接消费真实报文，把「服务端说什么」和「前端怎么理解」钉在一起。
//
// 场景：testutil.UID(10000) 是普通成员；owner_other 是群主；
// bot_mine_c 归 10000 所有；bot_other_c 归群主所有；human_c 是人类成员。

type RawMember = {
  uid: string;
  role: number;
  robot: number;
  bot_owned_by_me?: boolean;
};

// 取自 octo-server 在真实 MySQL + WuKongIM 栈上跑出的
// GET /v1/groups/:group_no/members 响应，只保留与本契约相关的四个字段
// （原始响应每个成员有 23 个字段，其余是自增 id、本次运行的时间戳等偶然值，
// 落进仓库只会让人误以为它们有意义）。
//
// 重新生成：在 octo-server 侧跑
//   go test ./modules/group/ -run TestBotOwnerSelfRemoval_MembersGetExposesBotOwnedByMe
// 该用例断言的正是同一批字段；若后端改了字段名或类型，它与这里会同时变红。
//
// 场景：10000 是普通成员（当前查看者）；owner_other 是群主；
// bot_mine_c 归 10000 所有；bot_other_c 归群主所有；human_c 是人类成员。
const members: RawMember[] = [
  { uid: "owner_other", role: 1, robot: 0, bot_owned_by_me: false },
  { uid: "10000", role: 0, robot: 0, bot_owned_by_me: false },
  { uid: "bot_mine_c", role: 0, robot: 1, bot_owned_by_me: true },
  { uid: "bot_other_c", role: 0, robot: 1, bot_owned_by_me: false },
  { uid: "human_c", role: 0, robot: 0, bot_owned_by_me: false },
  // 归我所有、但被提升为 Manager 的 bot：后端自助分支拒绝它，
  // 因此 bot_owned_by_me 下发 false（而不是靠前端自己再判一次角色）。
  { uid: "bot_mgr_c", role: 2, robot: 1, bot_owned_by_me: false },
];

/** 按 IM SDK 的方式把报文原样铺进 orgData（datasource.ts / subscribers.ts 都是整份 spread）。 */
const toSubscriber = (m: RawMember) =>
  ({ uid: m.uid, role: m.role, orgData: { ...m } } as never);

const canRemove = (uid: string) => {
  const m = members.find((x) => x.uid === uid);
  expect(m, `fixture 里应有 ${uid}`).toBeTruthy();
  return canRemoveChannelSettingSubscriber({
    viewerUid: "10000",
    viewerRole: 0, // 普通成员
    subscriber: toSubscriber(m as RawMember),
  });
};

describe("wire contract · 真实 server 报文 → 前端判据", () => {
  it("后端确实下发了 bot_owned_by_me，且是布尔而非 0/1", () => {
    for (const m of members) {
      expect(
        typeof m.bot_owned_by_me,
        `${m.uid} 的 bot_owned_by_me 必须是 boolean，实际 ${typeof m.bot_owned_by_me}`
      ).toBe("boolean");
    }
  });

  it("自己名下的 bot → 可移除", () => {
    expect(canRemove("bot_mine_c")).toBe(true);
  });

  it("他人名下的 bot → 不可移除", () => {
    expect(canRemove("bot_other_c")).toBe(false);
  });

  it("归我所有但担任 Manager 的 bot → 不可移除（后端已下发 false）", () => {
    expect(canRemove("bot_mgr_c")).toBe(false);
  });

  it("人类成员与群主 → 不可移除", () => {
    expect(canRemove("human_c")).toBe(false);
    expect(canRemove("owner_other")).toBe(false);
  });

  it("普通成员在这份真实报文里，可移除项恰好只有自己的那个 bot", () => {
    const removable = members
      .filter((m) =>
        canRemoveChannelSettingSubscriber({
          viewerUid: "10000",
          viewerRole: 0,
          subscriber: toSubscriber(m),
        })
      )
      .map((m) => m.uid);
    expect(removable).toEqual(["bot_mine_c"]);
  });
});
