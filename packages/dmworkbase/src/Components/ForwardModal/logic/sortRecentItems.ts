import type { ForwardItem } from "../ForwardModal"
import { forwardItemKey } from "./forwardItemKey"

/** 最近 Tab 的排序元信息：来自 SidebarService recent 同步。 */
export interface RecentSortMeta {
  timestamp: number
  isPinned: boolean
}

/**
 * 「最近」Tab 排序：置顶优先，其余按 timestamp 倒序。纯函数，不修改入参。
 *
 * 置顶判断双源合并：SidebarService 标记的 is_pinned 与本地 channelInfo.top
 * 二者任一为 true 即视为置顶（对齐既有 useForwardModal 行为）。
 * 抽出后便于单测 —— 只需构造 items + meta Map 即可覆盖各分支。
 */
export function sortRecentItems(
  items: ForwardItem[],
  recentSortMeta: Map<string, RecentSortMeta>,
): ForwardItem[] {
  return [...items].sort((a, b) => {
    const aMeta = recentSortMeta.get(forwardItemKey(a))
    const bMeta = recentSortMeta.get(forwardItemKey(b))
    const aPinned = aMeta?.isPinned === true || a.isPinned === true
    const bPinned = bMeta?.isPinned === true || b.isPinned === true
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    return (bMeta?.timestamp ?? 0) - (aMeta?.timestamp ?? 0)
  })
}
