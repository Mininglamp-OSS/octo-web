import WKSDK, {
  Channel,
  ChannelInfo,
  ChannelTypeGroup,
} from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../Service/Const";
import { parseThreadChannelId } from "../Service/Thread";
import {
  fetchImChannelInfo,
  getImChannelInfo,
  notifyImChannelInfoListeners,
  patchImChannelInfoOrgData,
  setImChannelInfoCache,
} from "../im-runtime/channelRuntime";

/**
 * 群聊状态枚举，与后端 group.GroupStatus 对齐：
 *   1 = Normal（正常）
 *   2 = Disband（已解散，企业微信式：保留历史、全员只读）
 */
export const GroupStatusNormal = 1;
export const GroupStatusDisband = 2;

/**
 * 从 channelInfo.orgData.status 判断群是否已解散。
 *
 * 解散语义（"A 数据 + B 皮肤"）：后端保留成员/频道/历史，仅靠 disband flag 全员只读；
 * 前端据此隐藏成员栏、置灰发送框/建子区，视觉上对齐企业微信"群已遣散"。
 *
 * status 来源：dmworkdatasource module.ts 的 channelInfoCallback 把后端
 * channels/{id}/{type} 的 status 写入 orgData.status。
 */
export function isGroupDisbanded(channelInfo?: ChannelInfo | null): boolean {
  return channelInfo?.orgData?.status === GroupStatusDisband;
}

/**
 * 直接按 channel 查缓存判断是否已解散（仅对群频道有意义）。
 * 缓存未命中时返回 false（fail-open，不误锁正常群）。
 */
export function isChannelDisbanded(channel?: Channel | null): boolean {
  if (!channel || channel.channelType !== ChannelTypeGroup) {
    return false;
  }
  const info = getImChannelInfo(WKSDK.shared(), channel);
  return isGroupDisbanded(info);
}

/**
 * 判断"当前会话所属群"是否已解散——同时覆盖群聊与子区(CommunityTopic)：
 *   - 群聊：直接看自身 status；
 *   - 子区：解散状态在父群上，需解析出父群 groupNo 再查。
 *
 * 用于会话内禁发/禁建子区等只读判定（子区也要随父群解散而只读）。
 */
export function isConversationDisbanded(channel?: Channel | null): boolean {
  if (!channel) return false;
  if (channel.channelType === ChannelTypeGroup) {
    return isChannelDisbanded(channel);
  }
  if (channel.channelType === ChannelTypeCommunityTopic) {
    const parsed = parseThreadChannelId(channel.channelID);
    if (!parsed) return false;
    return isChannelDisbanded(new Channel(parsed.groupNo, ChannelTypeGroup));
  }
  return false;
}

/**
 * channelUpdate 的统一处理收口：对「群频道」本地权威写回解散态并触发刷新，
 * 对其它频道（个人 / 子区等）退回 SDK 的 fetchChannelInfo（行为与原先一致）。
 *
 * 群频道为何不走 fetchChannelInfo：与 syncThreadArchiveState（子区归档同步）同型，
 * 规避同一 SDK 去重竞态——ChannelManager.fetchChannelInfo 对同 channelKey 在途
 * 请求去重，解散瞬间若有解散前发起、携旧 status=Normal 的 fetch 在途，依赖
 * fetchChannelInfo 刷新会被旧请求 resolve 覆盖回 Normal，导致 UI 不置灰、
 * ConversationVM.sendMessage 的解散判断读到旧 Normal 缓存而放行发送。故群频道直接：
 *   1. 在既有 channelInfo 上原地写 orgData.status=Disband（保留 title/logo 等）；
 *   2. setChannleInfoForCache 写回缓存；
 *   3. notifyListeners 触发 channelInfoListener → 会话/面板重渲染置灰。
 *
 * 操作者本人（handleDisband）与远程端（channelUpdate CMD / 消息）都经此函数，
 * 保证两侧都规避去重竞态——这正是 remote stale-fetch race（CR #447）的修复点。
 *
 * 群频道缓存未命中（极少见）时不伪造 channelInfo（会丢字段），同样退回
 * fetchChannelInfo 让 SDK 拉权威态兜底。
 */
export function syncGroupDisbandState(channel: Channel): void {
  if (!channel?.channelID) return;
  const sdk = WKSDK.shared();
  // 非群频道（个人 / 子区等）：解散态只挂在群频道上，这里无直写语义，
  // 退回常规 fetchChannelInfo，保持 channelUpdate 对这些频道的刷新行为不变。
  if (channel.channelType !== ChannelTypeGroup) {
    void fetchImChannelInfo(sdk, channel);
    return;
  }
  const channelInfo = getImChannelInfo(sdk, channel);
  if (channelInfo) {
    patchImChannelInfoOrgData(channelInfo, { status: GroupStatusDisband });
    setImChannelInfoCache(sdk, channelInfo);
    notifyImChannelInfoListeners(sdk, channelInfo);
    return;
  }
  // 群频道无 live 缓存：交给 SDK 异步拉取兜底（此分支不存在可被旧请求覆盖的本地态）。
  void fetchImChannelInfo(sdk, channel);
}
