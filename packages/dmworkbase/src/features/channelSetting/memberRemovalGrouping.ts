import { Subscriber } from "wukongimjssdk";

import {
  canRemoveChannelSettingSubscriber,
  isBotOwnedByViewer,
  isBotCreatedByViewer,
} from "./memberRemovalPermission";

/**
 * 「移出成员」页的分类与展开态推导（PRD §3.2–§3.4）。
 *
 * 这个模块是纯函数、零 React 依赖，原因和 memberRemovalPermission.ts 一样：
 * 分类规则要能被单测直接钉住，而不是只能透过组件渲染间接验证。
 *
 * ## 为什么分类能同时满足 §3.2 / §3.3 / §3.4
 *
 * 分类用**归属**判据（isBotCreatedByViewer），行的可选性用**权限**判据（canRemove）：
 *
 *   myBots = subscribers.filter(isBotCreatedByViewer)              ← 我创建的全部 bot（含不可移除的）
 *   others = subscribers.filter(!created && canRemove)             ← 可移除的非我 bot
 *
 * 「我的 BOT」按归属收全集，所以我建的、但已被提为管理员的 bot（owned=false）也会
 * 出现在这组里，由组件渲染为置灰不可选（见 isOwnedBotDisabledForRemoval）。普通成员没有
 * 创建任何 bot 时 myBots 为空；若他有自己的普通 bot，则可移除且归属于他。
 *
 * ## 归属判据用 bot_created_by_me（octo-server feat/bot-created-by-me-field）
 *
 * 早期版本只有 bot_owned_by_me 一个字段兼职归属+可移除两件事，导致「我建的、已
 * 被提为管理员」的 bot（owned=false）无法落进「我的 BOT」组。后端拆出了纯归属
 * 字段 bot_created_by_me（只看 robot.creator_uid，不看角色），前端分类改用它，
 * bot_owned_by_me 继续负责可移除性（控制圆点的灰态）。
 */

/** 分类 id。用字面量而不是 enum，方便测试里直接写断言。 */
export type MemberRemovalGroupId = "myBots" | "others";

export interface MemberRemovalGroup {
  id: MemberRemovalGroupId;
  subscribers: Subscriber[];
  /**
   * 该组是否被 MAX_OTHERS_GROUP_SIZE 截断。
   * 截断时组底部要给出「仅显示前 N 人，请用搜索」的提示，而不是静默少人。
   */
  truncated: boolean;
}

/**
 * 「其他成员」组的渲染上限。
 *
 * 本页是纯客户端过滤：服务端没有 scope=removable 这类参数，所以大群里拿到的是
 * 全量名册，过滤后管理员仍可能剩几百人。一次性渲染几百行会卡，而真分页又和
 * 「点分类名滚到该组第一个成员」打架（滚动目标可能还没加载）。
 *
 * 所以这里设一个上限 + 明确提示，把「不完整」这件事显式告诉用户，而不是
 * 假装列表是全的。
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
}): MemberRemovalGroup[] {
  const { subscribers, viewerUid, viewerRole } = params;
  if (!subscribers?.length) return [];

  const myBots: Subscriber[] = [];
  const others: Subscriber[] = [];

  for (const subscriber of subscribers) {
    const canRemove = canRemoveChannelSettingSubscriber({
      viewerUid,
      viewerRole,
      subscriber,
    });
    // 「我的 BOT」组按**归属**收录（bot_created_by_me），而非按可移除性。
    // 这样「我建的、已被提为管理员」的 bot（owned=false、canRemove=false）仍会
    // 出现在此组里，只是由组件将它渲染为置灰不可选。给用户完整的清点感，
    // 而不是让自己的 bot 无声消失。
    if (isBotCreatedByViewer(subscriber)) {
      myBots.push(subscriber);
      continue;
    }
    // 「其他成员」组仍只收录**可移除**的（§3.2）：几百个不可移除的陌生成员
    // 全塞进来置灰只会淹没真正能操作的项，纯噪音。这与「我的 BOT」量极小（
    // 0-3 个）、展全集+灰态成本几乎为零不同，两组策略分开是合理的。
    if (canRemove) {
      others.push(subscriber);
    }
  }

  const groups: MemberRemovalGroup[] = [];
  // 「我的 BOT」永不截断：数量天然极小，截断只会变成「我的 bot 不见了」。
  if (myBots.length > 0) {
    groups.push({ id: "myBots", subscribers: myBots, truncated: false });
  }
  if (others.length > 0) {
    groups.push({
      id: "others",
      subscribers: others.slice(0, MAX_OTHERS_GROUP_SIZE),
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
