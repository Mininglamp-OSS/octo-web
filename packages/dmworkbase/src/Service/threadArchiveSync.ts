import { Channel, WKSDK } from "wukongimjssdk";
import WKApp from "../App";
import {
  getImChannelInfo,
  notifyImChannelInfoListeners,
  patchImChannelInfoOrgData,
  setImChannelInfoCache,
} from "../im-runtime/channelRuntime";
import { ChannelTypeCommunityTopic } from "./Const";
import { ThreadStatus } from "./Thread";

/**
 * 子区归档 / 取消归档后的左侧 sidebar 同步收口（issue #345）。
 *
 * 三个归档入口（ThreadPanel 行内、ThreadPanel 详情菜单、ChannelSetting thread.actions）
 * 此前各自 deleteChannelInfo + fetchChannelInfo，只刷新自己那一层局部状态，没有任何一个
 * 把刷新推给「持有 conversations、负责过滤归档子区」的 ChatVM sidebar 子树，导致归档后
 * 左侧列表不实时同步。
 *
 * 【B1 去重竞态】SDK ChannelManager.fetchChannelInfo 有 requestQueueMap 去重：同
 * channelKey 已有在途请求时直接 return 不重拉；而 deleteChannelInfo 只清
 * channelInfocacheMap、不清 requestQueueMap。归档瞬间若有归档前发起的旧
 * fetchChannelInfo（携旧 Active 状态）在途，原实现的 deleteChannelInfo +
 * fetchChannelInfo 就退化成 no-op，随后旧请求 resolve 把 Active 写回缓存并
 * notifyListeners，导致归档子区不被隐藏，复发 #345。
 *
 * 因此这里不再绕异步 fetchChannelInfo，而是由调用方传入权威 status
 * （archive=Archived / unarchive=Active）。职责按序为：
 *   1. setChannleInfoForCache：把权威 thread.status 直接写回 channelInfo 缓存
 *      （在既有 channelInfo 上原地更新 orgData.thread.status，保留 title/logo 等）。
 *      没有 live channelInfo 时（sidebar-only 关注子区，合成项）跳过——它本就没有
 *      可被旧请求覆盖的缓存，filterArchivedThreads 对 status 未知的子区 fail-open。
 *   2. notifyListeners：触发 ChannelManager 的 channelInfoListener →
 *      ChatVM.channelListener，配合 vm.ts 对 CommunityTopic 的 notifyListener 让
 *      sidebar 重新过滤归档子区。
 *   3. emit("sidebar-reload")：让 useFollowSidebar 重新拉 /sidebar/sync，覆盖
 *      sidebar-only 关注子区（合成项，IM SDK 无 live channelInfo）的场景。
 *
 * 入参可传 channelID 字符串或已构造好的 Channel；只要能定位到子区频道即可。
 */
export function syncThreadArchiveState(
  threadChannel: Channel | string,
  status: ThreadStatus
): void {
  const channel =
    typeof threadChannel === "string"
      ? new Channel(threadChannel, ChannelTypeCommunityTopic)
      : threadChannel;
  if (!channel.channelID) return;

  const sdk = WKSDK.shared();
  // 权威写回：在既有 channelInfo 上原地更新 thread.status，避免被归档前发起、
  // 在途的旧 fetchChannelInfo（携 Active）覆盖。没有 live channelInfo 时不伪造
  // 缓存（会丢 title/logo 等），交由下面的 sidebar-reload 兜底。
  const channelInfo = getImChannelInfo(sdk, channel);
  if (channelInfo) {
    patchImChannelInfoOrgData(channelInfo, {
      thread: { ...(channelInfo.orgData?.thread || {}), status },
    });
    setImChannelInfoCache(sdk, channelInfo);
    notifyImChannelInfoListeners(sdk, channelInfo);
  }

  // sidebar-reload 是 sidebar-only 关注子区的唯一兜底，无论有无 live channelInfo
  // 都要 emit。
  WKApp.mittBus.emit("sidebar-reload" as any);
}
