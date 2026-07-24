import type { ForwardItem } from "../ForwardModal"

/**
 * 合并去重转发候选的三来源：本地会话 > 好友 > 后端搜索群组。纯函数。
 *
 * 优先级：conversationItems 在最前（保留其 displayName / 排序 / hasThreads
 * 等本地元信息），friends 中已出现在会话里的跳过，搜索群组再排除掉前两者已
 * 覆盖的 channelID，最后按 [conv, friend, search] 顺序拼接。
 *
 * 之所以以 channelID 而非复合 key 去重：三来源共存的仅群/私聊；父群与子区
 * channelID 天然不同（子区 id 形如 `groupNo____shortId`），不存在跨类型碰撞。
 */
export function mergeForwardSources(
  conversationItems: ForwardItem[],
  friendItems: ForwardItem[],
  searchGroupItems: ForwardItem[],
): ForwardItem[] {
  const convIDs = new Set(conversationItems.map((i) => i.channelID))
  const uniqueFriends = friendItems.filter((f) => !convIDs.has(f.channelID))
  const localIDs = new Set<string>(convIDs)
  for (const f of uniqueFriends) localIDs.add(f.channelID)
  const uniqueSearchGroups = searchGroupItems.filter((g) => !localIDs.has(g.channelID))
  return [...conversationItems, ...uniqueFriends, ...uniqueSearchGroups]
}
