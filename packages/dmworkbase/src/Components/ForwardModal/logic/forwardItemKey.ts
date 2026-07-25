import { ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk"
import { ChannelTypeCommunityTopic } from "../../../Service/Const"
import type {
  ChatKind,
  ChatSelectorAccessors,
} from "../../ChatSelector/tabFilter"
import type { ForwardItem } from "../ForwardModal"

// 复合 key：`${channelType}::${channelID}`，防跨类型 id 碰撞。channelType 取值
// (个人=1 / 群=2 / 子区=5) 恰与 SidebarTargetType(DM/CHANNEL/THREAD) 一致，
// 故转发本地 item 与 SidebarService 返回的关注/最近集合可直接对齐比较。
export function forwardItemKey(item: ForwardItem): string {
  return `${item.channelType}::${item.channelID}`
}

// 归类：个人→私聊，子区→thread，其余→群。供四 Tab 作用域过滤使用。
export function forwardItemKind(item: ForwardItem): ChatKind {
  if (item.channelType === ChannelTypePerson) return "direct"
  if (item.isThread || item.channelType === ChannelTypeCommunityTopic) return "thread"
  return "group"
}

export const FORWARD_ITEM_ACCESSORS: ChatSelectorAccessors<ForwardItem> = {
  getId: (i) => i.channelID,
  getName: (i) => i.displayName,
  getKind: forwardItemKind,
  getParentId: (i) => i.parentChannelID,
  getKey: forwardItemKey,
  // 父群恒为群聊，故以群类型（ChannelTypeGroup）构造复合 key，与 forwardItemKey 同构。
  getGroupKeyFromId: (parentId) => `${ChannelTypeGroup}::${parentId}`,
}
