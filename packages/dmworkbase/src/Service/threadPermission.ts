import { Channel, ChannelTypeGroup, WKSDK } from "wukongimjssdk";
import { GroupRole } from "./Const";
import { ThreadStatus } from "./Thread";
import WKApp from "../App";

/**
 * 当前登录用户在指定群是否为群主 / 管理员 —— 子区所有权限判定的共同底座（#451 review）。
 *
 * 角色必须从【父群】成员列表解析：子区频道成员从未被同步，读子区缓存会让非创建者的
 * 群主/管理员恒为 false。父群订阅未热时 getSubscribes 返回空 → false（降级为非管理员，安全）。
 */
function isGroupOwnerOrManager(groupNo: string): boolean {
  const groupChannel = new Channel(groupNo, ChannelTypeGroup);
  const subscribers = WKSDK.shared().channelManager.getSubscribes(groupChannel);
  const me = subscribers?.find((s) => s.uid === WKApp.loginInfo.uid);
  return me?.role === GroupRole.owner || me?.role === GroupRole.manager;
}

/**
 * 子区「角色/权限」统一判定：当前登录用户是否可以管理（含归档/取消归档）该子区。
 *
 * 归档入口在两处出现，必须共用同一份口径，否则会像 issue #283 一样出现一处可见、
 * 一处不可见的撕裂：
 *   - 入口 A：ChannelSetting 的 thread.actions（module.tsx）
 *   - 入口 B：ThreadPanel 右上角「…」菜单（ThreadPanel/canEditThread）
 *
 * 关键点：角色必须从【父群】成员列表解析，而不是子区频道自身的成员缓存。
 * 子区频道成员从未被同步，读取子区缓存会让非创建者的群主/管理员恒为 false。
 *
 * @param thread  子区数据（至少含 creator_uid）。为空返回 false。
 * @param groupNo 父群 group_no。
 */
export function canManageThread(
  thread: { creator_uid?: string } | null | undefined,
  groupNo: string
): boolean {
  if (!thread) {
    return false;
  }
  if (thread.creator_uid && thread.creator_uid === WKApp.loginInfo.uid) {
    return true;
  }
  if (!groupNo) {
    return false;
  }
  return isGroupOwnerOrManager(groupNo);
}

/**
 * 子区入站 Webhook 管理面的「是否管理员」判定（#451）。
 *
 * 子区没有独立角色矩阵 —— 与归档/改名一致，权限锚定【父群】：当前登录用户是否为父群
 * 群主 / 管理员。结果作为 isManager 传给 ChannelWebhookPanel，决定是否可设头像、是否可
 * 管理他人创建的 webhook（普通成员不受此 gate，仍可管理自己创建的）。
 *
 * 与 {@link canManageThread} 的区别：这里【不含】创建者捷径 —— 子区创建者若只是普通群员，
 * 不应获得设头像 / 管他人 webhook 的管理员权力（与群面 Webhook 的 isManager 口径一致）。
 *
 * 角色必须从父群成员列表解析（子区频道成员从未同步，读子区缓存会让非创建者的群主/管理员
 * 恒为 false）；父群订阅未热时返回 false（降级为非管理员，安全）。
 */
export function isParentGroupManager(groupNo: string | undefined): boolean {
  if (!groupNo) {
    return false;
  }
  return isGroupOwnerOrManager(groupNo);
}

/**
 * 群名 / 子区名改名的「明显不该改」粗过滤：登录用户在该群的成员记录若是龙虾（robot），
 * 前端直接拒绝；其余活跃成员一律放行，最终由服务端裁决。
 *
 * 与服务端放开口径对齐（octo-server #542：仅改 name 的活跃人类成员放行，龙虾 / 外部
 * 成员仍拒）。前端不重复实现完整权限矩阵——外部 / 黑名单成员放行到弹窗后由服务端返回
 * 错误、经调用点的 Toast.error(err.msg) 呈现；这里只挡住明显非人类的龙虾。
 *
 * member 为空（非成员 / 订阅缓存未热）时返回 false，降级为不可改（fail-closed，安全）。
 */
function isRenamableMember(
  member: { orgData?: { robot?: number } } | null | undefined
): boolean {
  if (!member) {
    return false;
  }
  return member.orgData?.robot !== 1;
}

/**
 * 群聊「改名」入口（module.tsx 的 groupName row）的权限判定。
 *
 * 服务端放开后（octo-server #542），任何活跃人类成员都可改群名，前端不再用
 * data.isManagerOrCreatorOfMe（群主 / 管理员）前置拦截普通成员。这里只做龙虾粗过滤，
 * 其余交给服务端兜底。抽成纯函数以便单测锁定，避免回退到 manager-only 口径。
 *
 * @param subscriberOfMe 当前登录用户在本群的成员记录（ChannelSetting 的 data.subscriberOfMe）。
 */
export function canRenameGroup(
  subscriberOfMe: { orgData?: { robot?: number } } | null | undefined
): boolean {
  return isRenamableMember(subscriberOfMe);
}

/**
 * 子区设置页「改名」入口（module.tsx 的 thread.base.info）的权限判定。
 *
 * 服务端放开后（octo-server #542），任何父群活跃人类成员都可改子区名，前端 gate 与之
 * 对齐——不再走 {@link canManageThread}（创建者 / 群主 / 管理员）的收紧口径，而是判断
 * 登录用户是否为父群活跃成员（含创建者，创建者必然在父群成员列表内）。
 *
 * 角色 / 成员必须从【父群】订阅解析：子区频道成员从未被同步，读子区缓存会让普通成员
 * 恒为 false。父群订阅未热时 getSubscribes 返回空 → false（降级，安全）。改名不像归档
 * 那样有状态门槛（Active/Archived），所以这里不做 status 过滤。
 */
export function canRenameThread(groupNo: string | undefined): boolean {
  if (!groupNo) {
    return false;
  }
  const groupChannel = new Channel(groupNo, ChannelTypeGroup);
  const subscribers = WKSDK.shared().channelManager.getSubscribes(groupChannel);
  const me = subscribers?.find((s) => s.uid === WKApp.loginInfo.uid);
  return isRenamableMember(me);
}

/**
 * ChannelSetting「子区管理」入口（module.tsx 的 thread.actions，即 issue #283 的
 * 缺陷入口 A）的归档可见性判定。
 *
 * 角色/权限核心走 {@link canManageThread}（父群口径，与 ThreadPanel 完全一致），
 * 另保留 isManagerOrCreatorOfMeFallback 作为兜底：它来自子区频道成员缓存，正常
 * 情况下不可靠（恒 false），但若后端/缓存确实给出 true 则直接放行，不回退权限。
 */
export function canArchiveThread(args: {
  thread: { creator_uid?: string } | null | undefined;
  groupNo: string | undefined;
  isManagerOrCreatorOfMeFallback?: boolean;
}): boolean {
  if (args.isManagerOrCreatorOfMeFallback) {
    return true;
  }
  return canManageThread(args.thread, args.groupNo ?? "");
}

/**
 * 入口 A（thread.actions）归档/取消归档菜单项是否应渲染：
 * 既要有权限（canArchiveThread），状态又必须是 Active 或 Archived。
 * 抽成纯函数以便与入口 B 做「一致性回归」断言。
 */
export function shouldShowThreadArchiveAction(args: {
  thread: { creator_uid?: string; status?: number } | null | undefined;
  groupNo: string | undefined;
  isManagerOrCreatorOfMeFallback?: boolean;
}): boolean {
  const status = args.thread?.status;
  const isActive = status === ThreadStatus.Active;
  const isArchived = status === ThreadStatus.Archived;
  if (!isActive && !isArchived) {
    return false;
  }
  return canArchiveThread(args);
}
