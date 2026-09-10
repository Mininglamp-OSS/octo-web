import { useCallback, useEffect, useRef, useState } from "react"
import {
  Channel,
  ChannelInfo,
  ChannelInfoListener,
  ChannelTypeGroup,
} from "wukongimjssdk"
import WKApp from "../../../App"
import { ConversationWrap } from "../../../Service/Model"
import { ChannelTypeCommunityTopic } from "../../../Service/Const"
import {
  shouldSkipChannelForSpace,
  shouldSkipPersonConversationForSpace,
} from "../../../Service/SpaceService"
import { debounce } from "../../../Utils/rateLimit"
import { filterArchivedThreads } from "../../ConversationListGrouped/archivedThreads"
import {
  addCurrentImChannelInfoListener,
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
} from "../../../im-runtime/currentChannelRuntime"
import { getCurrentImConversationsDirectly } from "../../../im-runtime/currentConversationRuntime"
import type { ForwardItem } from "../ForwardModal"
import { createForwardSource, type ForwardSource } from "./createForwardSource"
import { readForwardScope, useForwardScope } from "./useForwardScope"
import {
  channelInfoToForwardItem,
  deriveForwardItemBase,
  sortConversations,
} from "../logic"

/**
 * 转发候选装配 hook：本地会话 + group/my 兜底群 + 好友。
 *
 * 隐藏在 rebuildConvItems 里的复杂度（Space 权威回种、子区归位、孤儿兜底、
 * 归档子区过滤）都收敛在这里。上层组合 hook 只关心三件事：
 *   - `conversationItems` / `friendItems`：给 mergeForwardSources 用
 *   - `channelMapRef`：给 confirm() 按 channelID 取 Channel 引用
 *   - `requestChannelInfoIfNeeded`：ItemRow 进入视口时按需拉 channelInfo
 *
 * 副作用（订阅 channelInfo 监听、监听 `conversation-list-refreshed` 广播、
 * 切 Space 时清空兜底群）在 hook 卸载时全部清理。
 */
export interface UseForwardCandidatesResult {
  conversationItems: ForwardItem[]
  friendItems: ForwardItem[]
  loading: boolean
  scope: string
  groups: ForwardSource<ChannelInfo[]>
  friends: ForwardSource<ChannelInfo[]>
  channelMapRef: React.MutableRefObject<Map<string, Channel>>
  requestChannelInfoIfNeeded: (item: ForwardItem) => void
}

function conversationWrapToForwardItem(
  wrap: ConversationWrap,
  parentGroupNoSet: ReadonlySet<string>,
  parentChannelID?: string,
): ForwardItem {
  const channelInfo = wrap.channelInfo
  const isThread = wrap.channel.channelType === ChannelTypeCommunityTopic
  // hasThreads: 判断该群聊下是否有子区。调用方预先聚合 parentGroupNoSet（O(M) 一次遍历），
  // 这里 O(1) 命中即可；避免每个 wrap 都做 .some() 全表扫（旧实现 O(N·M) 卡顿）。
  const hasThreads = !isThread && parentGroupNoSet.has(wrap.channel.channelID)
  const base = deriveForwardItemBase(wrap.channel, channelInfo)
  return {
    ...base,
    hasThreads,
    parentChannelID,
  }
}

const useGroups = createForwardSource<ChannelInfo[]>()
const useFriends = createForwardSource<ChannelInfo[]>()
const loadGroups = () => WKApp.dataSource.channelDataSource.groupSaveList()
const loadFriends = async () => (await WKApp.dataSource.commonDataSource.searchFriends("")) ?? []

export function useForwardCandidates(): UseForwardCandidatesResult {
  const scope = useForwardScope()
  const groups = useGroups(scope, loadGroups)
  const friends = useFriends(scope, loadFriends)
  const [conversations, setConversations] = useState<{ scope: string; items: ForwardItem[] }>({ scope, items: [] })
  const [people, setPeople] = useState<{ scope: string; items: ForwardItem[] }>({ scope, items: [] })
  const channelMapRef = useRef<Map<string, Channel>>(new Map())
  const channelScopeRef = useRef(scope)
  const wrapsRef = useRef<ConversationWrap[]>([])
  const fetchedRef = useRef<Set<string>>(new Set())

  /**
   * 懒加载入口：列表项进入视口时调用。仅当本地 channelInfo 缺失且该 channel
   * 未发起过请求时才调 fetchChannelInfo。去重避免 rebuildConvItems forceUpdate
   * 之后重复打同一个接口。
   */
  const requestChannelInfoIfNeeded = useCallback((item: ForwardItem) => {
    if (!item?.channelID) return
    if (fetchedRef.current.has(item.channelID)) return
    const ch = channelMapRef.current.get(item.channelID)
      ?? new Channel(item.channelID, item.channelType)
    if (getCurrentImChannelInfo(ch)) return
    fetchedRef.current.add(item.channelID)
    void fetchCurrentImChannelInfo(ch)
  }, [])

  const rebuildConvItems = useCallback(() => {
    if (readForwardScope() !== scope) return
    // 分离：群聊（非子区）和子区
    const groupWraps: ConversationWrap[] = []
    const threadWraps: ConversationWrap[] = []
    const spaceId = WKApp.shared.currentSpaceId
    // 已并入的群 ID（recents 群 + extraGroups 群），用于去重与子区挂回。
    const seenGroupIDs = new Set<string>()
    // 预聚合 parentGroupNo → 一次 O(M) 扫全部会话，给 hasThreads 做 O(1) 命中，
    // 消除原实现 rebuild 里对每个 wrap 都 .some() 全表扫的 O(N·M) 热点。
    const parentGroupNoSet = new Set<string>()
    for (const conv of getCurrentImConversationsDirectly<ConversationWrap["conversation"]>()) {
      if (conv.channel.channelType !== ChannelTypeCommunityTopic) continue
      const parentGroupNoRaw = getCurrentImChannelInfo(conv.channel)?.orgData?.parentGroupNo
      if (parentGroupNoRaw != null) parentGroupNoSet.add(String(parentGroupNoRaw))
    }
    for (const wrap of wrapsRef.current) {
      channelMapRef.current.set(wrap.channel.channelID, wrap.channel)
      if (wrap.channel.channelType === ChannelTypeCommunityTopic) {
        threadWraps.push(wrap)
      } else {
        // recents 群：rebuildLocal 入口的 shouldSkipChannelForSpace 已做权威 Space
        // 把关（channelSpaceMap → channelInfo → fail-closed），此处不再二次过滤。
        groupWraps.push(wrap)
        if (wrap.channel.channelType === ChannelTypeGroup) {
          seenGroupIDs.add(wrap.channel.channelID)
        }
      }
    }

    // group/my 兜底群：用群条目自带的权威 space_id（来自 group/my 行）按来源分流。
    const extraGroupItems: ForwardItem[] = []
    for (const groupInfo of groups.data ?? []) {
      const channelID = groupInfo.channel.channelID
      // 去重：仅当不在已并入的 recents 群集合时才并入（避免 React duplicate key）。
      if (seenGroupIDs.has(channelID)) continue

      if (spaceId) {
        const groupSpaceId = groupInfo.orgData?.space_id
        if (typeof groupSpaceId === "string") {
          if (groupSpaceId === spaceId) {
            // 权威命中：用 group/my 行自带的权威 space_id 回灌 channelSpaceMap
            // （隐藏副作用：让后续 shouldSkipChannelForSpace 走缓存命中分支）。
            // key 格式与 shouldSkipChannelForSpace 一致。
            WKApp.shared.channelSpaceMap.set(`${channelID}_${ChannelTypeGroup}`, groupSpaceId)
          } else if (groupSpaceId !== "") {
            // 跨 Space：先用 group/my 行自带的权威 space_id 回种 channelSpaceMap
            // （回种群真实归属，与 shouldSkipChannelForSpace 命中 channelInfo 时
            // 无条件回填的语义一致），再交给 shouldSkipChannelForSpace 统一裁决
            // （它内部含 source_space_id 外部成员豁免）。豁免逻辑只活在
            // SpaceService，不在此复制。先回种再调用不会短路——缓存命中分支读到
            // 回种的跨 Space 值后仍会执行 source_space_id 豁免检查。
            WKApp.shared.channelSpaceMap.set(`${channelID}_${ChannelTypeGroup}`, groupSpaceId)
            if (shouldSkipChannelForSpace(groupInfo.channel)) continue
          }
          // 空串 ""：group/my 已带 param.space_id 背书，保留但绝不回种缓存（空串污染）。
        }
        // groupSpaceId 字段缺失(undefined) 或为 null（typeof 非 "string"）
        // → 末位 fail-open 保留，且不回种 channelSpaceMap。
      }
      // currentSpaceId 为空（无 Space 模式）→ 不做 Space 过滤，全保留。

      channelMapRef.current.set(channelID, groupInfo.channel)
      seenGroupIDs.add(channelID)
      extraGroupItems.push(channelInfoToForwardItem(groupInfo))
    }

    // 转发目标永不包含已归档子区：复用侧栏的 fail-open helper
    // （仅过滤明确 status=Archived 的子区，status 未知/未加载的子区保留）。
    // 仅作用于子区来源，不触碰群聊/私聊。
    const visibleThreadWraps = filterArchivedThreads(threadWraps)

    // 按 parentGroupNo 建 Map
    const threadsByParent = new Map<string, ConversationWrap[]>()
    const orphanThreads: ConversationWrap[] = []
    for (const tw of visibleThreadWraps) {
      const parentGroupNoRaw = tw.channelInfo?.orgData?.parentGroupNo
      const parentGroupNo = parentGroupNoRaw != null ? String(parentGroupNoRaw) : undefined
      if (parentGroupNo) {
        const list = threadsByParent.get(parentGroupNo) || []
        list.push(tw)
        threadsByParent.set(parentGroupNo, list)
      } else {
        orphanThreads.push(tw)
      }
    }

    // 输出顺序：父群 → 其子区（紧跟） → 下一父群
    const items: ForwardItem[] = []
    for (const gw of groupWraps) {
      items.push(conversationWrapToForwardItem(gw, parentGroupNoSet))
      const children = threadsByParent.get(gw.channel.channelID) || []
      for (const tw of children) {
        items.push(conversationWrapToForwardItem(tw, parentGroupNoSet, gw.channel.channelID))
      }
      // 已挂回的子区从 Map 移除，避免后续兜底重复追加。
      threadsByParent.delete(gw.channel.channelID)
    }
    // group/my 兜底群追加在 recents 群之后；其子区（仅来自 recents）挂回父群。
    for (const item of extraGroupItems) {
      items.push(item)
      const children = threadsByParent.get(item.channelID) || []
      for (const tw of children) {
        items.push(conversationWrapToForwardItem(tw, parentGroupNoSet, item.channelID))
      }
      threadsByParent.delete(item.channelID)
    }
    // 兜底：有 parentGroupNo 但父群既不在 recents 也不在 group/my 的子区，
    // 作为独立项追加到末尾（带 parentChannelID），避免父群确实缺席时被静默丢弃。
    for (const [parentGroupNo, children] of threadsByParent) {
      for (const tw of children) {
        items.push(conversationWrapToForwardItem(tw, parentGroupNoSet, parentGroupNo))
      }
    }
    // 找不到父群的孤儿子区（无 parentGroupNo）追加到末尾
    for (const ow of orphanThreads) {
      items.push(conversationWrapToForwardItem(ow, parentGroupNoSet))
    }

    setConversations({ scope, items })
  }, [scope, groups.data])

  useEffect(() => {
    const rebuildLocal = () => {
      if (readForwardScope() !== scope) return
      if (channelScopeRef.current !== scope) {
        channelScopeRef.current = scope
        channelMapRef.current.clear()
        fetchedRef.current.clear()
      }
      const conversations = getCurrentImConversationsDirectly<ConversationWrap["conversation"]>()
      const wraps: ConversationWrap[] = []
      for (const conv of conversations) {
        if (shouldSkipChannelForSpace(conv.channel)) continue
        if (shouldSkipPersonConversationForSpace(conv)) continue
        wraps.push(new ConversationWrap(conv))
      }
      wrapsRef.current = sortConversations(wraps)
      rebuildConvItems()
    }

    // 订阅 channelInfo 更新，触发列表重渲（头像/名称补全）。
    // 使用 debounce 合批，避免视口内多个懒加载请求集中返回时连续触发 rebuild。
    const rebuildDebounced = debounce(() => rebuildConvItems(), 150)
    const channelListener: ChannelInfoListener = (_channelInfo: ChannelInfo) => {
      rebuildDebounced()
    }
    const unsubscribeChannelListener = addCurrentImChannelInfoListener(channelListener)

    // A same-scope SDK refresh only rebuilds local candidates. It must not restart
    // remote lists or hide rows that are already available. useForwardScope handles scope changes.
    WKApp.mittBus.on("conversation-list-refreshed", rebuildLocal)
    rebuildLocal()

    return () => {
      unsubscribeChannelListener()
      WKApp.mittBus.off("conversation-list-refreshed", rebuildLocal)
      rebuildDebounced.cancel()
    }
  }, [scope, rebuildConvItems])

  useEffect(() => {
    if (readForwardScope() !== scope) return
    const seen = new Set<string>()
    const items: ForwardItem[] = []
    for (const info of friends.data ?? []) {
      const cid = info.channel.channelID
      if (seen.has(cid)) continue
      seen.add(cid)
      channelMapRef.current.set(cid, info.channel)
      items.push(channelInfoToForwardItem(info))
    }
    setPeople({ scope, items })
  }, [scope, friends.data])

  return {
    conversationItems: conversations.scope === scope ? conversations.items : [],
    friendItems: people.scope === scope ? people.items : [],
    loading: groups.loading || friends.loading,
    scope,
    groups,
    friends,
    channelMapRef,
    requestChannelInfoIfNeeded,
  }
}
