import { useState, useEffect, useCallback, useRef } from "react"
import { WKSDK, Channel, ChannelInfo, ChannelInfoListener, ChannelTypeGroup } from "wukongimjssdk"
import { ConversationWrap } from "../../Service/Model"
import { ChannelTypeCommunityTopic } from "../../Service/Const"
import { shouldSkipChannelForSpace, shouldSkipPersonConversationForSpace } from "../../Service/SpaceService"
import { filterArchivedThreads } from "../ConversationListGrouped/archivedThreads"
import { debounce } from "../../Utils/rateLimit"
import WKApp from "../../App"
import { ForwardItem } from "./ForwardModal"

function channelInfoToForwardItem(channelInfo: ChannelInfo): ForwardItem {
  return {
    channelID: channelInfo.channel.channelID,
    channelType: channelInfo.channel.channelType,
    displayName: channelInfo.orgData.displayName || channelInfo.channel.channelID,
    isAI: channelInfo.orgData?.robot === 1,
    isThread: channelInfo.channel.channelType === ChannelTypeCommunityTopic,
    isExternal:
      channelInfo.channel.channelType === ChannelTypeGroup &&
      channelInfo.orgData?.is_external_group === 1,
  }
}

function conversationWrapToForwardItem(wrap: ConversationWrap, parentChannelID?: string): ForwardItem {
  const channelInfo = wrap.channelInfo
  const isThread = wrap.channel.channelType === ChannelTypeCommunityTopic
  // hasThreads: 判断该群聊下是否有子区（子区会出现在 conversations 里，其 orgData.parentGroupNo 指向父群）
  const hasThreads = !isThread && WKSDK.shared().conversationManager.conversations?.some(
    (c) => c.channel.channelType === ChannelTypeCommunityTopic
      && (WKSDK.shared().channelManager.getChannelInfo(c.channel)?.orgData?.parentGroupNo === wrap.channel.channelID)
  )
  return {
    channelID: wrap.channel.channelID,
    channelType: wrap.channel.channelType,
    displayName: channelInfo?.orgData.displayName || wrap.channel.channelID,
    isAI: channelInfo?.orgData?.robot === 1,
    isThread,
    hasThreads: hasThreads ?? false,
    parentChannelID,
    isExternal:
      wrap.channel.channelType === ChannelTypeGroup &&
      channelInfo?.orgData?.is_external_group === 1,
  }
}

function sortConversations(wraps: ConversationWrap[]): ConversationWrap[] {
  return [...wraps].sort((a, b) => {
    let aScore = a.timestamp
    let bScore = b.timestamp
    if (a.channelInfo?.top) aScore += 1_000_000
    if (b.channelInfo?.top) bScore += 1_000_000
    return bScore - aScore
  })
}

export interface UseForwardModalResult {
  /** 关键字过滤后的列表（用于渲染列表项） */
  items: ForwardItem[]
  /** 全量列表（用于已选头像区，不受搜索过滤影响） */
  allItems: ForwardItem[]
  selectedIDs: string[]
  selectedChannels: Channel[]
  /** 实际 input 显示值（即时更新） */
  inputValue: string
  /** 触发 debounce 过滤的 keyword */
  keyword: string
  loading: boolean
  /** 更新 input 显示值，内部 debounce 后更新过滤 keyword */
  setInputValue: (val: string) => void
  toggleSelect: (item: ForwardItem) => void
  confirm: () => void
  reset: () => void
  /** 懒加载：项进入视口时调用，按需拉取 channelInfo；去重 */
  requestChannelInfoIfNeeded: (item: ForwardItem) => void
}

export function useForwardModal(
  onFinished?: (channels: Channel[]) => void
): UseForwardModalResult {
  const [conversationItems, setConversationItems] = useState<ForwardItem[]>([])
  const [friendItems, setFriendItems] = useState<ForwardItem[]>([])
  const [searchGroupItems, setSearchGroupItems] = useState<ForwardItem[]>([])
  const [selectedIDs, setSelectedIDs] = useState<string[]>([])
  const [inputValue, setInputValueState] = useState("")
  const [keyword, setKeyword] = useState("")
  const [loading, setLoading] = useState(true)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRequestRef = useRef(0)
  // load() 可能并发(mount 自动触发 + conversation-list-refreshed 又触发一次)。
  // 用一个单调递增的 generation,await 边界处比对,过期就丢弃 setState,
  // 避免两次 setConversationItems(prev => [...prev, ...]) 重复 append 同一批群。
  const loadGenRef = useRef(0)

  const setInputValue = useCallback((val: string) => {
    setInputValueState(val)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      setKeyword(val)
    }, 300)
  }, [])

  // unmount 时清理 debounce timer，防止在已卸载组件上触发 setState
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  // 存一份 channel 引用，用于 confirm 时返回
  const channelMapRef = useRef<Map<string, Channel>>(new Map())

  // 保存原始 wraps 引用，供 channelInfoListener 触发后重新构建
  const wrapsRef = useRef<ConversationWrap[]>([])

  // 懒加载：记录已发起 fetchChannelInfo 的 channelID，避免重复请求
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
    if (WKSDK.shared().channelManager.getChannelInfo(ch)) return
    fetchedRef.current.add(item.channelID)
    WKSDK.shared().channelManager.fetchChannelInfo(ch)
  }, [])

  const rebuildConvItems = useCallback(() => {
    // 分离：群聊（非子区）和子区
    const groupWraps: ConversationWrap[] = []
    const threadWraps: ConversationWrap[] = []
    const spaceId = WKApp.shared.currentSpaceId
    for (const wrap of wrapsRef.current) {
      if (spaceId && wrap.channel.channelType === ChannelTypeGroup) {
        const groupSpaceId = wrap.channelInfo?.orgData?.space_id
        // 严格模式：没有 space_id 或不匹配当前 Space 的群聊都跳过
        if (!groupSpaceId || groupSpaceId !== spaceId) {
          continue
        }
      }
      channelMapRef.current.set(wrap.channel.channelID, wrap.channel)
      if (wrap.channel.channelType === ChannelTypeCommunityTopic) {
        threadWraps.push(wrap)
      } else {
        groupWraps.push(wrap)
      }
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
      items.push(conversationWrapToForwardItem(gw))
      const children = threadsByParent.get(gw.channel.channelID) || []
      for (const tw of children) {
        items.push(conversationWrapToForwardItem(tw, gw.channel.channelID))
      }
    }
    // 找不到父群的孤儿子区追加到末尾
    for (const ow of orphanThreads) {
      items.push(conversationWrapToForwardItem(ow))
    }

    setConversationItems(items)
  }, [])

  useEffect(() => {
    async function load() {
      const gen = ++loadGenRef.current
      setLoading(true)
      try {
        // 最近会话：仅构造 wrap，不再对每个 conv 主动 fetchChannelInfo。
        // channelInfo 由 ForwardModal 中每个 ItemRow 的 VisibilityTrigger 在
        // 进入视口时按需拉取（去重 + debounce 合批 forceUpdate）。
        const conversations = WKSDK.shared().conversationManager.conversations ?? []
        const wraps: ConversationWrap[] = []
        for (const conv of conversations) {
          if (shouldSkipChannelForSpace(conv.channel)) continue
          if (shouldSkipPersonConversationForSpace(conv)) continue
          wraps.push(new ConversationWrap(conv))
        }
        wrapsRef.current = sortConversations(wraps)
        rebuildConvItems()

        // 补全：获取用户加入的全部群聊（已支持 space_id 过滤）
        const allGroups = await WKApp.dataSource.channelDataSource.groupSaveList()
        if (gen !== loadGenRef.current) return // 有更新的 load 在跑,丢弃本次结果
        const existingGroupIDs = new Set<string>()
        for (const wrap of wrapsRef.current) {
          if (wrap.channel.channelType === ChannelTypeGroup) {
            existingGroupIDs.add(wrap.channel.channelID)
          }
        }
        const extraGroupItems: ForwardItem[] = []
        for (const groupInfo of allGroups) {
          if (!existingGroupIDs.has(groupInfo.channel.channelID)) {
            channelMapRef.current.set(groupInfo.channel.channelID, groupInfo.channel)
            extraGroupItems.push(channelInfoToForwardItem(groupInfo))
          }
        }
        if (extraGroupItems.length > 0) {
          setConversationItems((prev: ForwardItem[]) => [...prev, ...extraGroupItems])
        }

        // 好友
        const friends = (await WKApp.dataSource.commonDataSource.searchFriends("")) ?? []
        if (gen !== loadGenRef.current) return
        // 按 channelID 去重：Space 模式下后端 space/{id}/members 可能返回同一
        // uid 的多条记录（多角色等），不去重会触发 React duplicate key 警告。
        const seen = new Set<string>()
        const fItems: ForwardItem[] = []
        for (const info of friends) {
          const cid = info.channel.channelID
          if (seen.has(cid)) continue
          seen.add(cid)
          channelMapRef.current.set(cid, info.channel)
          fItems.push(channelInfoToForwardItem(info))
        }
        setFriendItems(fItems)
      } finally {
        // 仅最新 generation 收尾 loading,避免老 load 的 setLoading(false)
        // 把更新的 load 标记成"已完成"。
        if (gen === loadGenRef.current) setLoading(false)
      }
    }

    // 订阅 channelInfo 更新，触发列表重渲（头像/名称补全）。
    // 使用 debounce 合批，避免视口内多个懒加载请求集中返回时连续触发 rebuild。
    const rebuildDebounced = debounce(() => rebuildConvItems(), 150)
    const channelListener: ChannelInfoListener = (_channelInfo: ChannelInfo) => {
      rebuildDebounced()
    }
    WKSDK.shared().channelManager.addListener(channelListener)

    // 切 Space 后 conversationManager.conversations 会被先清空再回填,
    // 如果 modal 在回填前打开,初次 load() 会读到空 cache（缺最近会话/子区）。
    // 监听 ChatVM 的回填广播,触发后重新 load 一次,保证最终能拿到完整数据。
    const onConversationListRefreshed = () => {
      load()
    }
    WKApp.mittBus.on('conversation-list-refreshed', onConversationListRefreshed)

    load()

    return () => {
      WKSDK.shared().channelManager.removeListener(channelListener)
      WKApp.mittBus.off('conversation-list-refreshed', onConversationListRefreshed)
      rebuildDebounced.cancel()
    }
  }, [rebuildConvItems])

  // 搜索群组：keyword >= 2 时调用注册的 searchChatCandidates 获取群组结果
  useEffect(() => {
    if (keyword.length < 2) {
      setSearchGroupItems([])
      return
    }
    if (!WKApp.searchChatCandidates) {
      setSearchGroupItems([])
      return
    }
    const reqId = ++searchRequestRef.current
    const searchParams: Record<string, string> = { keyword }
    const currentSpaceId = WKApp.shared.currentSpaceId
    if (currentSpaceId) {
      searchParams.space_id = currentSpaceId
    }
    WKApp.searchChatCandidates(searchParams)
      .then((candidates: any) => {
        if (reqId !== searchRequestRef.current) return
        const arr = Array.isArray(candidates) ? candidates : []
        const groups: ForwardItem[] = arr.map((c: any) => {
          const chType = c.chat_type === "direct" ? 1 : ChannelTypeGroup
          const ch = new Channel(c.chat_id, chType)
          channelMapRef.current.set(c.chat_id, ch)
          // 若本地已缓存 channelInfo，尝试继承外部群标记
          const cachedInfo = WKSDK.shared().channelManager.getChannelInfo(ch)
          const isExternal =
            chType === ChannelTypeGroup &&
            cachedInfo?.orgData?.is_external_group === 1
          return {
            channelID: c.chat_id,
            channelType: chType,
            displayName: c.name || c.chat_id,
            isAI: false,
            isThread: false,
            isExternal,
          } as ForwardItem
        })
        setSearchGroupItems(groups)
      })
      .catch(() => {
        if (reqId === searchRequestRef.current) setSearchGroupItems([])
      })
  }, [keyword])

  // 合并去重：conversationItems 优先，friend 已在 conversation 里的跳过，搜索群组追加
  const convIDs = new Set(conversationItems.map((i: ForwardItem) => i.channelID))
  const uniqueFriends = friendItems.filter((f: ForwardItem) => !convIDs.has(f.channelID))
  const localIDs = new Set([...convIDs, ...uniqueFriends.map((f) => f.channelID)])
  const uniqueSearchGroups = searchGroupItems.filter((g: ForwardItem) => !localIDs.has(g.channelID))
  const allItems = [...conversationItems, ...uniqueFriends, ...uniqueSearchGroups]

  // 关键字过滤（方案 A：命中子区时带出父群；命中父群不自动展开子区）
  const filtered = keyword
    ? (() => {
        const kw = keyword.toLowerCase()
        // 先找命中的项
        const matched = allItems.filter((i) => i.displayName.toLowerCase().includes(kw))
        // 命中子区时，把父群也加进来（若父群本身未命中）
        const parentIDsToInclude = new Set<string>()
        for (const item of matched) {
          if (item.parentChannelID) {
            parentIDsToInclude.add(item.parentChannelID)
          }
        }
        const matchedIDs = new Set(matched.map((i) => i.channelID))
        const parents = parentIDsToInclude.size > 0
          ? allItems.filter((i) => parentIDsToInclude.has(i.channelID) && !matchedIDs.has(i.channelID))
          : []
        // 保持树状顺序：遍历 allItems，只保留命中项 + 需要带出的父群
        const includeIDs = new Set([...matchedIDs, ...parents.map((p) => p.channelID)])
        return allItems.filter((i) => includeIDs.has(i.channelID))
      })()
    : allItems

  const toggleSelect = useCallback((item: ForwardItem) => {
    setSelectedIDs((prev: string[]) =>
      prev.includes(item.channelID)
        ? prev.filter((id: string) => id !== item.channelID)
        : [...prev, item.channelID]
    )
  }, [])

  const selectedIDsRef = useRef<string[]>(selectedIDs)
  selectedIDsRef.current = selectedIDs

  const selectedChannels = selectedIDs
    .map((id: string) => channelMapRef.current.get(id))
    .filter(Boolean) as Channel[]

  const confirm = useCallback(() => {
    const channels = selectedIDsRef.current
      .map((id: string) => channelMapRef.current.get(id))
      .filter(Boolean) as Channel[]
    if (onFinished && channels.length > 0) {
      onFinished(channels)
    }
  }, [onFinished])

  const reset = useCallback(() => {
    setSelectedIDs([])
    setInputValueState("")
    setKeyword("")
  }, [])

  return {
    items: filtered,
    allItems,
    selectedIDs,
    selectedChannels,
    inputValue,
    keyword,
    loading,
    setInputValue,
    toggleSelect,
    confirm,
    reset,
    requestChannelInfoIfNeeded,
  }
}
