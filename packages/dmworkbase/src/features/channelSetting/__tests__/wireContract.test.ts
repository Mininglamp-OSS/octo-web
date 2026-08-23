import { describe, expect, it } from "vitest";

import { canRemoveChannelSettingSubscriber } from "../memberRemovalPermission";
import realMembersResponse from "./__fixtures_members_contract.json";

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

const members = realMembersResponse as RawMember[];

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
