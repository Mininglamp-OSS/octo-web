import { ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk"
import { ChannelTypeCommunityTopic } from "../../Service/Const"

/**
 * 把后端 searchChatCandidates 返回的 chat_type 映射成 wukongimjssdk 的 channelType。
 *
 *   - "direct" → ChannelTypePerson (1)
 *   - "thread" → ChannelTypeCommunityTopic (5)
 *   - 其它(group/未知) → ChannelTypeGroup (2)
 *
 * 之前这里写成「非 direct 一律当群」，子区会被构造成 ChannelTypeGroup，channelID
 * 带四下划线 (groupNo____shortId)、channelType 错成 2，后端按 (type=2, 四下划线 id)
 * 找不到频道 → 消息被丢弃但前端本地回显成功，造成子区→子区转发静默失败 (#273)。
 */
export function chatTypeToChannelType(chatType: string | undefined): number {
  switch (chatType) {
    case "direct":
      return ChannelTypePerson
    case "thread":
      return ChannelTypeCommunityTopic
    default:
      return ChannelTypeGroup
  }
}
