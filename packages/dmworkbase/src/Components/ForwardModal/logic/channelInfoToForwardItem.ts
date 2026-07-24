import { ChannelTypeGroup } from "wukongimjssdk"
import type { Channel, ChannelInfo } from "wukongimjssdk"
import { ChannelTypeCommunityTopic } from "../../../Service/Const"
import type { ForwardItem } from "../ForwardModal"

/**
 * 把 (channel, channelInfo) 派生成 ForwardItem 的基础字段。纯函数，无隐藏副作用。
 *
 * 抽出以让 ChannelInfo 来源（好友 / group/my 兜底群）与 ConversationWrap 来源
 * （最近会话）共享同一份 displayName 回退 / robot / isPinned / isThread / isExternal
 * 语义，避免两处分叉（例如后续新增 badge / 修改外群语义时必须两处同改）。
 *
 * channelInfo 允许为空以适配 ConversationWrap 里 channelInfo 尚未加载的场景；
 * 缺省时 displayName 回退到 channelID，其余可选字段全部为 false/undefined。
 */
export function deriveForwardItemBase(
  channel: Channel,
  channelInfo?: ChannelInfo,
): ForwardItem {
  const orgData = channelInfo?.orgData
  return {
    channelID: channel.channelID,
    channelType: channel.channelType,
    displayName: orgData?.displayName || channel.channelID,
    isAI: orgData?.robot === 1,
    isThread: channel.channelType === ChannelTypeCommunityTopic,
    isPinned: channelInfo?.top === true,
    isExternal:
      channel.channelType === ChannelTypeGroup &&
      orgData?.is_external_group === 1,
  }
}

/**
 * 把 ChannelInfo 映射成 ForwardItem。纯函数，无隐藏副作用。
 *
 * 抽出后便于单测 —— 用例只需构造一个 ChannelInfo 形状的对象即可覆盖显示名回退、
 * robot 标记、外部群标记等分支，无需拉起整个 useForwardModal。
 */
export function channelInfoToForwardItem(channelInfo: ChannelInfo): ForwardItem {
  return deriveForwardItemBase(channelInfo.channel, channelInfo)
}
