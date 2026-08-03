import { useEffect, useRef, useState } from "react"
import { Channel } from "wukongimjssdk"
import WKApp from "../../../App"
import type { ForwardItem } from "../ForwardModal"
import {
  candidateToForwardItem,
  type SearchChatCandidate,
} from "../candidateToForwardItem"
import { chatTypeToChannelType } from "../chatTypeToChannelType"

/**
 * 后端 `WKApp.searchChatCandidates` 搜索群/子区/后端全库联系人。keyword < 2 或
 * 回调未注册时清空结果（复刻既有 useForwardModal 行为）。
 *
 * 副作用：每条候选构造 Channel 后回调 `onCandidateChannel`，让调用方把 Channel
 * 引用登记到 channelMap，供 confirm() 按 channelID 取回。之所以做成回调而非
 * 返回 Map：channelMap 由上层管理（跨来源共享：本地会话 / 好友 / 搜索候选），
 * 这里只负责「搜到就登记」这一步。
 *
 * 竞态守卫：单调递增 reqId + await 后比对，过期请求直接丢弃。
 */
export interface UseForwardSearchResult {
  searchGroupItems: ForwardItem[]
}

export function useForwardSearch(
  keyword: string,
  onCandidateChannel: (channelID: string, channel: Channel) => void,
): UseForwardSearchResult {
  const [searchGroupItems, setSearchGroupItems] = useState<ForwardItem[]>([])
  const requestRef = useRef(0)
  // 把 callback 收敛到 ref，避免上层每次 render 传入新引用触发 effect 重跑。
  const onCandidateChannelRef = useRef(onCandidateChannel)
  onCandidateChannelRef.current = onCandidateChannel

  useEffect(() => {
    if (keyword.length < 2) {
      setSearchGroupItems([])
      return
    }
    if (!WKApp.searchChatCandidates) {
      setSearchGroupItems([])
      return
    }
    const reqId = ++requestRef.current
    const searchParams: Record<string, string> = { keyword }
    const currentSpaceId = WKApp.shared.currentSpaceId
    if (currentSpaceId) {
      searchParams.space_id = currentSpaceId
    }
    WKApp.searchChatCandidates(searchParams)
      .then((candidates: unknown) => {
        if (reqId !== requestRef.current) return
        const arr: SearchChatCandidate[] = Array.isArray(candidates)
          ? (candidates as SearchChatCandidate[])
          : []
        const groups: ForwardItem[] = arr.map((c) => {
          const ch = new Channel(c.chat_id, chatTypeToChannelType(c.chat_type))
          onCandidateChannelRef.current(c.chat_id, ch)
          return candidateToForwardItem(c)
        })
        setSearchGroupItems(groups)
      })
      .catch(() => {
        if (reqId === requestRef.current) setSearchGroupItems([])
      })
  }, [keyword])

  return { searchGroupItems }
}
