import { Subscriber } from "wukongimjssdk";
import { describe, expect, it } from "vitest";

import { GroupRole } from "../../../Service/Const";
import {
  MAX_OTHERS_GROUP_SIZE,
  buildMemberRemovalGroups,
  deriveDefaultExpandedGroups,
  isGroupExpanded,
} from "../memberRemovalGrouping";

// 「移出成员」页的分类与展开态推导（PRD §3.2–§3.4）。
//
// 这些是纯函数，所以整页最容易错的几件事都能在这里钉死，不必挂载组件：
//   §3.2 普通成员只看到自己的 bot（others 组恒空 → 页面自动单组）
//   §3.3 默认展开态按**组数**推导，不按角色硬编码
//   §3.4 搜索态强制展开，但不污染用户手动折叠的状态

type RawOrgData = {
  robot?: number;
  bot_owned_by_me?: boolean;
};

const sub = (
  uid: string,
  role: number = GroupRole.normal,
  orgData: RawOrgData = {}
) => ({ uid, role, orgData } as unknown as Subscriber);

describe("buildMemberRemovalGroups · §3.2 / §3.3 分类", () => {
  // §3.2 的核心：普通成员的 canRemove 只对「自己的 bot + 普通角色」为 true，
  // 所以 others 恒空，页面自动退化成单组「我的 BOT」。这不需要任何角色分支。
  it("普通成员只拿到「我的 BOT」一组，群里其他人全部不可见", () => {
    const groups = buildMemberRemovalGroups({
      viewerUid: "me",
      viewerRole: GroupRole.normal,
      subscribers: [
        sub("owner", GroupRole.owner),
        sub("manager", GroupRole.manager),
        sub("me", GroupRole.normal),
        sub("other-human", GroupRole.normal),
        sub("others-bot", GroupRole.normal, {
          robot: 1,
          bot_owned_by_me: false,
        }),
        sub("my-bot", GroupRole.normal, {
          robot: 1,
          bot_owned_by_me: true,
        }),
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("myBots");
    expect(groups[0].subscribers.map((s) => s.uid)).toEqual(["my-bot"]);
  });

  it("群主拿到两组，自己的 bot 归「我的 BOT」", () => {
    const groups = buildMemberRemovalGroups({
      viewerUid: "owner",
      viewerRole: GroupRole.owner,
      subscribers: [
        sub("owner", GroupRole.owner), // 自己：canRemove 恒 false
        sub("manager", GroupRole.manager),
        sub("human", GroupRole.normal),
        sub("my-bot", GroupRole.normal, {
          robot: 1,
          bot_owned_by_me: true,
        }),
      ],
    });

    expect(groups.map((g) => g.id)).toEqual(["myBots", "others"]);
    expect(groups[0].subscribers.map((s) => s.uid)).toEqual(["my-bot"]);
    // 群主可移除管理员与普通成员；自己不在列表里。
    expect(groups[1].subscribers.map((s) => s.uid)).toEqual([
      "manager",
      "human",
    ]);
  });

  it("空组不渲染：没有自己的 bot 时只剩「其他成员」", () => {
    const groups = buildMemberRemovalGroups({
      viewerUid: "owner",
      viewerRole: GroupRole.owner,
      subscribers: [
        sub("owner", GroupRole.owner),
        sub("human", GroupRole.normal),
      ],
    });
    expect(groups.map((g) => g.id)).toEqual(["others"]);
  });

  it("没有任何可移除对象时返回空数组（由组件渲染空态）", () => {
    const groups = buildMemberRemovalGroups({
      viewerUid: "me",
      viewerRole: GroupRole.normal,
      subscribers: [sub("owner", GroupRole.owner), sub("me", GroupRole.normal)],
    });
    expect(groups).toEqual([]);
  });

  it("「其他成员」超过上限时截断并打标，「我的 BOT」永不截断", () => {
    const many = Array.from({ length: MAX_OTHERS_GROUP_SIZE + 25 }, (_, i) =>
      sub(`h${i}`, GroupRole.normal)
    );
    const myBots = Array.from({ length: 12 }, (_, i) =>
      sub(`b${i}`, GroupRole.normal, { robot: 1, bot_owned_by_me: true })
    );
    const groups = buildMemberRemovalGroups({
      viewerUid: "owner",
      viewerRole: GroupRole.owner,
      subscribers: [...myBots, ...many],
    });

    const bots = groups.find((g) => g.id === "myBots")!;
    const others = groups.find((g) => g.id === "others")!;
    // 一个人在一个群里的 bot 天然极少，截断它只会变成「我的 bot 不见了」。
    expect(bots.subscribers).toHaveLength(12);
    expect(bots.total).toBe(12);
    expect(bots.truncated).toBe(false);
    expect(others.subscribers).toHaveLength(MAX_OTHERS_GROUP_SIZE);
    expect(others.total).toBe(MAX_OTHERS_GROUP_SIZE + 25);
    expect(others.truncated).toBe(true);
  });
});

describe("deriveDefaultExpandedGroups · §3.3 默认展开态", () => {
  // 按组数推导而不是按角色：任何让群主/管理员也只剩一组的情况（比如群里只有
  // 他自己的 bot 可移除）都不能掉进「打开就是一个收起的标题」的空屏。
  it("单组 → 强制展开（不论是哪一组）", () => {
    expect(
      deriveDefaultExpandedGroups([
        { id: "myBots", subscribers: [], total: 0, truncated: false },
      ])
    ).toEqual({ myBots: true, others: false });

    expect(
      deriveDefaultExpandedGroups([
        { id: "others", subscribers: [], total: 0, truncated: false },
      ])
    ).toEqual({ myBots: false, others: true });
  });

  it("双组 → 「我的 BOT」收起、「其他成员」展开", () => {
    expect(
      deriveDefaultExpandedGroups([
        { id: "myBots", subscribers: [], total: 0, truncated: false },
        { id: "others", subscribers: [], total: 0, truncated: false },
      ])
    ).toEqual({ myBots: false, others: true });
  });

  it("零组 → 两组都收起（页面走空态）", () => {
    expect(deriveDefaultExpandedGroups([])).toEqual({
      myBots: false,
      others: false,
    });
  });
});

describe("isGroupExpanded · §3.4 搜索态叠加", () => {
  const manual = { myBots: false, others: true };

  it("搜索时强制全部展开，否则命中项会藏在收起的组里", () => {
    expect(
      isGroupExpanded({
        groupId: "myBots",
        manualExpanded: manual,
        searching: true,
        groupCount: 2,
      })
    ).toBe(true);
  });

  // 决策③的关键细节：强制展开只是显示层覆盖，不写回 manualExpanded。
  // 否则搜一次就把用户手动折叠的偏好清掉了。
  it("退出搜索后恢复用户手动折叠的状态", () => {
    expect(
      isGroupExpanded({
        groupId: "myBots",
        manualExpanded: manual,
        searching: false,
        groupCount: 2,
      })
    ).toBe(false);
    expect(
      isGroupExpanded({
        groupId: "others",
        manualExpanded: manual,
        searching: false,
        groupCount: 2,
      })
    ).toBe(true);
  });

  it("单组恒展开，忽略手动折叠（收起唯一一组等于空屏）", () => {
    expect(
      isGroupExpanded({
        groupId: "myBots",
        manualExpanded: { myBots: false, others: false },
        searching: false,
        groupCount: 1,
      })
    ).toBe(true);
  });
});
