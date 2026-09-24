import { Subscriber } from "wukongimjssdk";

import {
  canRemoveChannelSettingSubscriber,
  isBotOwnedByViewer,
} from "./memberRemovalPermission";

/**
 * 「移出成员」页的分类与展开态推导（PRD §3.2–§3.4）。
 *
 * 这个模块是纯函数、零 React 依赖，原因和 memberRemovalPermission.ts 一样：
 * 分类规则要能被单测直接钉住，而不是只能透过组件渲染间接验证。
 *
 * ## 为什么分类能同时满足 §3.2 / §3.3 / §3.4
 *
 * 整页只有一条可见性判据（canRemove）和一条归属判据（isBotOwnedByViewer），
 * 三节规格都是它们的推论，不需要任何「如果是普通成员就……」的角色分支：
 *
 *   visible = subscribers.filter(canRemove)       ← §3.2 只展示可移除的
 *   myBots  = visible.filter(isBotOwnedByViewer)  ← §3.3/§3.4 「我的 BOT」
 *   others  = visible.filter(!isBotOwnedByViewer) ← §3.3/§3.4 「其他成员」
 *
 * 普通成员的 canRemove 只在「自己的 bot + 普通角色」时为 true，所以 others
 * **恒为空**，页面自动退化成单组 —— 这正是 §3.2 想要的效果。群主/管理员两组
 * 都有，就是 §3.3 的布局。一条规则两种形态，没有分叉。
 *
 * ## 归属判据直接复用 isBotOwnedByViewer（不另造字段）
 *
 * 曾考虑过让后端多下发一个纯归属字段 bot_created_by_me，用来覆盖一个盲区：
 * bot_owned_by_me 对**非普通角色**的 bot 恒为 false，所以若一个 bot 被提为群
 * 管理员角色，前端就认不出它是「我的」。
 *
 * 但产品上**没有把 bot 设为群管理员的入口**；只有 managerAdd 接口不排除 robot，
 * 所以理论上能用 API 构造出来（参见 memberRemovalPermission 的同题注释）。这种
 * 只能由 API 构造的数据，退化后的表现与本改动前完全一致（该 bot 被归入「其他
 * 成员」，群主仍能移除它），且服务端始终是授权权威，所以收益不足以引入新字段；
 * 也不在前端自造推断（前端没有 creator_uid，本地猜测会和后端授权口径漂移）。
 */

/** 分类 id。用字面量而不是 enum，方便测试里直接写断言。 */
export type MemberRemovalGroupId = "myBots" | "others";

export interface MemberRemovalGroup {
  id: MemberRemovalGroupId;
  subscribers: Subscriber[];
  /**
   * 已加载页中该组的过滤人数（截断前），不是尚未加载的全群总数。
   *
   * 标题里的计数必须用这个值而不是 `subscribers.length`：后者是被
   * MAX_OTHERS_GROUP_SIZE 砍过的**渲染量**，用它会把 500 人的群写成
   * 「其他成员（200）」—— 把一个渲染上限冒充成人口普查。
   */
  total: number;
  isPartial?: boolean;
  /**
   * 该组是否被 MAX_OTHERS_GROUP_SIZE 截断。
   * 截断时组底部要给出「仅显示前 N 人，请用搜索」的提示，而不是静默少人。
   */
  truncated: boolean;
}

/**
 * 「其他成员」组的渲染上限。
 *
 * 本页消费服务端分页并在客户端做权限过滤，不消费完整 IM 缓存快照。
 * 大群里已加载的可移除成员也可能超过几百人，限制同时渲染的行数。
 *
 * 所以这里设一个上限 + 明确提示，把「不完整」这件事显式告诉用户，而不是
 * 假装列表是全的。搜索以服务端为权威，本地索引只加速；达到上限后仍可
 * 通过独立的继续加载按钮扫描后面的页面，不能依赖不再增长的 scrollHeight。
 *
 * 「我的 BOT」组**不受此限制** —— 一个人在一个群里的 bot 通常 0-3 个，天然极小，
 * 截断它只会制造「我的 bot 不见了」的 bug。
 */
export const MAX_OTHERS_GROUP_SIZE = 200;

/**
 * 把成员列表分成「我的 BOT」/「其他成员」两组。
 *
 * 空组会被整个剔除（含标题），所以返回的数组长度就是「实际要渲染的组数」，
 * 普通成员拿到的是长度 1 的数组。顺序固定：我的 BOT 在前。
 */
export function buildMemberRemovalGroups(params: {
  subscribers: Subscriber[];
  viewerUid?: string;
  viewerRole?: number;
  hasMore?: boolean;
}): MemberRemovalGroup[] {
  const { subscribers, viewerUid, viewerRole } = params;
  if (!subscribers?.length) return [];

  const myBots: Subscriber[] = [];
  const others: Subscriber[] = [];

  for (const subscriber of subscribers) {
    // §3.2 的唯一可见性判据。复用行级判据，不另写一份 —— 页面过滤与行内按钮
    // 各写一份的话，迟早漂移成「列表里有这一行，但它没有移除按钮」。
    if (!canRemoveChannelSettingSubscriber({ viewerUid, viewerRole, subscriber })) {
      continue;
    }
    if (isBotOwnedByViewer(subscriber)) {
      myBots.push(subscriber);
    } else {
      others.push(subscriber);
    }
  }

  const groups: MemberRemovalGroup[] = [];
  // 「我的 BOT」永不截断：数量天然极小，截断只会变成「我的 bot 不见了」。
  if (myBots.length > 0) {
    groups.push({
      id: "myBots",
      subscribers: myBots,
      total: myBots.length,
      isPartial: params.hasMore,
      truncated: false,
    });
  }
  if (others.length > 0) {
    groups.push({
      id: "others",
      subscribers: others.slice(0, MAX_OTHERS_GROUP_SIZE),
      // total 记截断**前**的人数，标题计数靠它，否则 500 人群会显示成（200）。
      total: others.length,
      isPartial: params.hasMore,
      truncated: others.length > MAX_OTHERS_GROUP_SIZE,
    });
  }
  return groups;
}

/**
 * 推导各组的**默认**展开态（§3.3）。
 *
 * 规则按**组数**推导，刻意不按角色硬编码：
 *   1 组 → 强制展开（否则打开页面就是一个收起的标题，等于空屏）
 *   2 组 → 「我的 BOT」收起、「其他成员」展开
 *
 * 写成「if 普通成员 then 展开」的话，任何让群主/管理员也只剩一组的情况
 * （比如群里只有他自己的 bot 可移除）都会掉进空屏。按组数推导则天然覆盖。
 */
export function deriveDefaultExpandedGroups(
  groups: MemberRemovalGroup[]
): Record<MemberRemovalGroupId, boolean> {
  const expanded: Record<MemberRemovalGroupId, boolean> = {
    myBots: false,
    others: false,
  };
  if (groups.length === 0) return expanded;
  if (groups.length === 1) {
    expanded[groups[0].id] = true;
    return expanded;
  }
  // §3.3：两组并存时「我的 BOT」默认收起、「其他成员」默认展开。
  expanded.myBots = false;
  expanded.others = true;
  return expanded;
}

/**
 * 计算某一组**当前**是否展开，把搜索态叠加在用户的手动折叠之上（§3.4 / 决策③）。
 *
 * 搜索时强制全部展开：分类是本页的主结构，搜索中突然变成扁平列表会很割裂；
 * 而保留分类却让命中项藏在收起的组里，等于搜不到。
 *
 * 关键是**不要把强制展开写回 state**。搜索期间只是「显示上」全展开，用户手动
 * 折叠过的状态原样留在 manualExpanded 里，退出搜索后自动恢复 —— 否则搜一次
 * 就把用户的折叠偏好清掉了。
 */
export function isGroupExpanded(params: {
  groupId: MemberRemovalGroupId;
  manualExpanded: Record<MemberRemovalGroupId, boolean>;
  searching: boolean;
  groupCount: number;
}): boolean {
  const { groupId, manualExpanded, searching, groupCount } = params;
  if (searching) return true;
  // 单组永远展开：它没有「收起」的意义（收起后页面全空），也避免用户把唯一
  // 一组折叠后以为功能坏了。
  if (groupCount === 1) return true;
  return manualExpanded[groupId] === true;
}
