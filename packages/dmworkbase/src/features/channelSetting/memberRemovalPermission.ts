import { Subscriber } from "wukongimjssdk";

import { GroupRole } from "../../Service/Const";

/**
 * 群成员移除的**行级**判定，是这条能力唯一的前端真相来源（octo-web#1511）。
 *
 * 单独成模块而不是留在 channelSettingMemberSection 里，是为了让
 * Components/Subscribers/vm.ts 也能复用它：那边 `showRemove()` 需要判断
 * 「我在本群有没有可移除的 bot」。若 vm 直接 import channelSettingMemberSection，
 * 会形成 channelSettingMemberSection → Components/Subscribers → vm → 回去 的循环；
 * 抽到这个零依赖叶子模块后两边都从它引，环就没了。
 *
 * 更重要的是：入口可见性与行可见性必须用**同一个**判据。各写一份的话，
 * 入口比行宽就会出现「点得进去、里面没有任何可移除项」的死胡同，
 * 而且两份 fail-closed 安全判据迟早各自漂移。
 */

/**
 * 当前查看者是否拥有这个 bot 成员。
 *
 * 数据来自成员列表下发的 `bot_owned_by_me`，后端按 per-viewer 计算。
 * **必须 fail closed**：/membersync 是按 version 的增量同步，该字段上线前已缓存的
 * 成员行在其 version 变动前不会带上它。缺失 / 非严格 true 一律按「不拥有」处理，
 * 降级方向是退回改动前的行为，绝不能误开移除权限。
 */
export function isBotOwnedByViewer(subscriber: Subscriber): boolean {
  return subscriber?.orgData?.bot_owned_by_me === true;
}

/**
 * 当前查看者是否**创建**了这个 bot 成员（纯归属，不看群角色）。
 *
 * 数据来自成员列表下发的 `bot_created_by_me`（octo-web#1553 / octo-server
 * feat/bot-created-by-me-field）。它与 `bot_owned_by_me` 语义分离：
 *
 *   bot_created_by_me = 我**建**了它（只看 robot.creator_uid）
 *   bot_owned_by_me   = 我**能撤**它（归属 AND 目标是普通角色）
 *
 * 用于「移出成员」页的归属分类（我的 BOT / 其他成员），使「我建的、但已被
 * 提为管理员」的 bot 也能正确落进「我的 BOT」组 —— 该 bot owned=false（移不动）
 * 但 created=true（是我的），应显示但置灰。
 *
 * **必须 fail closed**，理由与 isBotOwnedByViewer 相同：/membersync 增量同步下
 * 老缓存行在其 version 变动前不带此字段，缺失 / 非严格 true 一律按「非我创建」
 * 处理，降级方向是不把它归到「我的 BOT」，绝不误分。
 */
export function isBotCreatedByViewer(subscriber: Subscriber): boolean {
  return subscriber?.orgData?.bot_created_by_me === true;
}

/**
 * 某行在「移出成员」页里是否应**可见但不可选**（置灰）。
 *
 * 命中条件：是我创建的 bot（归属我）、但当前不可移除（owned=false，通常因为它
 * 已被提为管理员）。这类行要出现在「我的 BOT」组里给用户完整的清点感，圆点
 * 置灰、不可勾选，并用 tooltip 说明「需先取消其管理员身份」。
 *
 * 与「其他成员」组不同：那组只收可移除的人（见 buildMemberRemovalGroups），
 * 不做置灰展示，否则几百个不可移除的陌生成员会淹没真正能操作的项。
 */
export function isOwnedBotDisabledForRemoval(params: {
  viewerUid?: string;
  viewerRole?: number;
  subscriber: Subscriber;
}): boolean {
  const { subscriber } = params;
  if (!isBotCreatedByViewer(subscriber)) return false;
  // 已经可移除的不算「置灰」——它是正常可选行。
  return !canRemoveChannelSettingSubscriber(params);
}

export function canRemoveChannelSettingSubscriber(params: {
  viewerUid?: string;
  viewerRole?: number;
  subscriber: Subscriber;
}) {
  const { viewerUid, viewerRole = GroupRole.normal, subscriber } = params;
  if (!subscriber?.uid) return false;
  if (subscriber.uid === viewerUid) return false;
  if (subscriber.role === GroupRole.owner) return false;
  if (viewerRole === GroupRole.owner) return true;
  if (viewerRole === GroupRole.manager) {
    return subscriber.role === GroupRole.normal;
  }
  // 自助移除（octo-web#1511）：普通成员可以撤走自己名下的 bot。
  //
  // 必须放在角色分支**之后**，精确镜像后端：memberRemove 的自助分支只在调用方
  // 既非 Creator 也非 Manager 时才进入。若提到前面，一个「管理员 + 拥有一个被
  // 提升为管理员的 bot」的组合会渲染出移除按钮，而后端走的是管理员路径、
  // 直接回 ErrGroupCannotRemoveAdmin —— 按钮点了必报错。
  //
  // 目标本身也必须是普通角色：后端的自助分支拒绝任何被授予了群角色的 bot
  // （Creator 回 cannot_remove_owner，Manager 回 cannot_remove_admin），
  // 把角色 bot 的处置权留给群主/管理员。这里同步限制，避免下发点了必报错的按钮。
  // （managerAdd 不排除 robot，所以 bot 当管理员是构造得出来的。）
  return subscriber.role === GroupRole.normal && isBotOwnedByViewer(subscriber);
}
