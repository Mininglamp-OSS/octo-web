import { useEffect, useState } from "react"
import WKApp from "../../../App"
import SidebarService from "../../../Service/SidebarService"
import type { RecentSortMeta } from "../logic"

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
}

export function useSidebarScopes(): UseSidebarScopesResult {
  const [followedKeys, setFollowedKeys] = useState<Set<string>>(new Set())
  const [recentKeys, setRecentKeys] = useState<Set<string>>(new Set())
  const [recentSortMeta, setRecentSortMeta] = useState<Map<string, RecentSortMeta>>(new Map())

  useEffect(() => {
    const deviceUuid = WKApp.shared.deviceId || ""
    if (deviceUuid === "") {
      setFollowedKeys(new Set())
      setRecentKeys(new Set())
      setRecentSortMeta(new Map())
      return
    }
    let cancelled = false
    Promise.all([
      SidebarService.sync({ tab: "follow", device_uuid: deviceUuid }).catch(() => null),
      SidebarService.sync({ tab: "recent", device_uuid: deviceUuid }).catch(() => null),
    ])
      .then(([followResp, recentResp]) => {
        if (cancelled) return
        const followed = new Set<string>()
        for (const item of followResp?.items ?? []) {
          if (item.is_followed) followed.add(`${item.target_type}::${item.target_id}`)
        }

        const recent = new Set<string>()
        const sortMeta = new Map<string, RecentSortMeta>()
        for (const item of recentResp?.items ?? []) {
          const key = `${item.target_type}::${item.target_id}`
          recent.add(key)
          sortMeta.set(key, {
            timestamp: item.timestamp ?? 0,
            isPinned: item.is_pinned === true,
          })
        }

        setFollowedKeys(followed)
        setRecentKeys(recent)
        setRecentSortMeta(sortMeta)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { followedKeys, recentKeys, recentSortMeta }
}
