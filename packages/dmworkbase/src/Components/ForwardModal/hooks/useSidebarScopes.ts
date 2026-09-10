import { useMemo } from "react"
import WKApp from "../../../App"
import SidebarService, { type SidebarSyncResp } from "../../../Service/SidebarService"
import type { RecentSortMeta } from "../logic"
import { createForwardSource, type ForwardSource } from "./createForwardSource"
import { useForwardScope } from "./useForwardScope"

/**
 * 「关注 / 最近」Tab 的作用域集合同步。
 *
 * 与智能纪要选择器一致，走 SidebarService follow/recent 同步。转发列表主体仍复用本地
 * 会话 + group/my + 好友装配（保证零权限回归）；这里只提供 sidebar 返回的权威集合
 * 作为「关注 / 最近」Tab 的过滤作用域 + 最近 Tab 的排序元信息。
 *
 * deviceId 为空时后端 validateSidebarRequest 必拒，跳过注定失败的请求，
 * 关注/最近集合退化为空集（保持与既有 useForwardModal 行为一致）。
 */
export interface UseSidebarScopesResult {
  followedKeys: Set<string>
  recentKeys: Set<string>
  recentSortMeta: Map<string, RecentSortMeta>
  follow: ForwardSource<SidebarSyncResp>
  recent: ForwardSource<SidebarSyncResp>
}

const useFollow = createForwardSource<SidebarSyncResp>()
const useRecent = createForwardSource<SidebarSyncResp>()
function sync(tab: "follow" | "recent"): Promise<SidebarSyncResp> {
  const device_uuid = WKApp.shared.deviceId || ""
  return device_uuid
    ? SidebarService.sync({ tab, device_uuid })
    : Promise.resolve({ items: [], version: 0, follow_version: 0 })
}
const loadFollow = () => sync("follow")
const loadRecent = () => sync("recent")

/** Publish each tab independently; an unfinished scope is never treated as a confirmed empty list. */
export function useSidebarScopes(providedScope?: string): UseSidebarScopesResult {
  const scope = useForwardScope(providedScope)
  const follow = useFollow(scope, loadFollow)
  const recent = useRecent(scope, loadRecent)
  const followedKeys = useMemo(() => new Set(
    (follow.data?.items ?? []).filter((item) => item.is_followed)
      .map((item) => `${item.target_type}::${item.target_id}`),
  ), [follow.data])
  const { recentKeys, recentSortMeta } = useMemo(() => {
    const recentKeys = new Set<string>()
    const recentSortMeta = new Map<string, RecentSortMeta>()
    for (const item of recent.data?.items ?? []) {
      const key = `${item.target_type}::${item.target_id}`
      recentKeys.add(key)
      recentSortMeta.set(key, { timestamp: item.timestamp ?? 0, isPinned: item.is_pinned === true })
    }
    return { recentKeys, recentSortMeta }
  }, [recent.data])
  return { followedKeys, recentKeys, recentSortMeta, follow, recent }
}
