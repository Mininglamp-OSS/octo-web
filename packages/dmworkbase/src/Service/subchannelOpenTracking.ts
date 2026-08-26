import type { Channel } from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "./Const";
import { parseThreadChannelId, type Thread } from "./Thread";
import { stripSpacePrefix } from "./SpacePrefix";

// subchannel_opened 采集决策 —— 抽成纯函数,便于直接单测(无需挂载重型 ChatContentPage)。
// 见 #1452 review R10 P1-1/P2-1/P2-3:两入口(mount / didUpdate)必须互斥,channel_id 必须归一。

export interface SubchannelOpenPayload {
  channel_id: string;
  subchannel_id: string;
}

// 入口二(页内子区选择):componentDidUpdate 里 activeThread 身份(channel_id)变化即一次 open。
// 覆盖 onOpenThreadPanel / onThreadSelect 这类只改 state、不 remount 的页内入口。
// channel_id 取父群 group_no,经 stripSpacePrefix 归一为 bare id(与其余新事件同一口径)。
export function subchannelOpenFromThreadChange(
  curThread: Pick<Thread, "channel_id" | "group_no" | "short_id"> | null,
  prevThreadChannelId: string | undefined
): SubchannelOpenPayload | null {
  if (!curThread || !curThread.channel_id) return null;
  if (curThread.channel_id === prevThreadChannelId) return null;
  if (!curThread.group_no || !curThread.short_id) return null;
  return {
    channel_id: stripSpacePrefix(curThread.group_no),
    subchannel_id: curThread.short_id,
  };
}

// 入口一(以子区频道挂载):componentDidMount 里本页 channel 为 ChannelTypeCommunityTopic =
// 会话列表点子区行 / 深链 / 路由恢复。这些都会 remount ChatContentPage 走挂载。
//
// 去重(P1-1):若本次挂载是「已在面板打开的子区」再导航(打开完整视图 / 页内搜索 / 文件预览)
// 触发的 remount,则 didUpdate 已经发过一次 —— 这三条导航路径会把目标 channelID 记进
// WKApp.shared.pendingSubchannelOpenTracked(sentinel),挂载时若命中同一 channelID 就跳过,
// 保证两入口对同一次「打开子区」手势只发一次。直接从列表/深链挂载时 sentinel 不命中,照常发。
//
// channel_id 取父群 group_no(挂载处由 orgData.parentGroupNo || parseThreadChannelId 推得),
// 经 stripSpacePrefix 归一为 bare id —— 修复 P2-1(Space 部署下 parsed.groupNo 可能带 s<hex>_ 前缀)。
export function subchannelOpenFromMount(
  channel: Pick<Channel, "channelType" | "channelID">,
  parentGroupNo: string | undefined,
  suppressChannelId: string | undefined
): SubchannelOpenPayload | null {
  if (channel.channelType !== ChannelTypeCommunityTopic) return null;
  if (suppressChannelId && suppressChannelId === channel.channelID) return null;
  const parsed = parseThreadChannelId(channel.channelID);
  if (!parentGroupNo || !parsed?.shortId) return null;
  return {
    channel_id: stripSpacePrefix(parentGroupNo),
    subchannel_id: parsed.shortId,
  };
}
