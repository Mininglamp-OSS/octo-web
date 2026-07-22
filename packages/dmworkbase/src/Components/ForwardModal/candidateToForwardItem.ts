import { WKSDK, Channel, ChannelInfo, ChannelTypeGroup } from "wukongimjssdk"
import { ChannelTypeCommunityTopic } from "../../Service/Const"
import { parseThreadChannelId } from "../../Service/Thread"
import { chatTypeToChannelType } from "./chatTypeToChannelType"
import type { ForwardItem } from "./ForwardModal"
import { getImChannelInfo } from "../../im-runtime/channelRuntime"

/** searchChatCandidates 后端返回的单条候选（只取本模块用到的字段）。 */
export interface SearchChatCandidate {
  chat_id: string
  chat_type?: string
  name?: string
  /** 子区父群号；可能是数字(含 0) 或字符串，缺失时为 null/undefined。 */
  parent_group_no?: string | number | null
}

/**
 * 把后端 searchChatCandidates 的单条候选映射成列表用的 ForwardItem。
 *
 * 抽成纯函数便于单测（见 forwardModalChatType.test.ts）：唯一的外部依赖
 * （读本地缓存的 channelInfo 以继承外部群标记）通过 getCachedChannelInfo
 * 注入，省略时不读缓存。
 *
 * parentChannelID 仅子区(thread)有意义：优先用后端 parent_group_no（注意
 * 数字 0 也是合法父群号，必须 `!= null` 判断而非 falsy 判断），缺失时再从
 * channelID(groupNo____shortId) 兜底解析；chat_id 不含分隔符时 parse 返回
 * null → parentChannelID 为 undefined（不抛错）。
 */
export function candidateToForwardItem(
  candidate: SearchChatCandidate,
  getCachedChannelInfo: (channel: Channel) => ChannelInfo | undefined = (ch) =>
    getImChannelInfo(WKSDK.shared(), ch),
): ForwardItem {
  const chType = chatTypeToChannelType(candidate.chat_type)
  const ch = new Channel(candidate.chat_id, chType)
  const cachedInfo = getCachedChannelInfo(ch)
  const isExternal =
    chType === ChannelTypeGroup && cachedInfo?.orgData?.is_external_group === 1
  const isThread = chType === ChannelTypeCommunityTopic
  const parentChannelID = isThread
    ? candidate.parent_group_no != null
      ? String(candidate.parent_group_no)
      : parseThreadChannelId(candidate.chat_id)?.groupNo
    : undefined
  return {
    channelID: candidate.chat_id,
    channelType: chType,
    displayName: candidate.name || candidate.chat_id,
    isAI: false,
    isThread,
    isPinned: cachedInfo?.top === true,
    parentChannelID,
    isExternal,
  }
}
