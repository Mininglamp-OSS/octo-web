import { useState, useEffect, useCallback, useRef } from "react"
import { WKSDK, Channel, ChannelInfo, ChannelInfoListener, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk"
import { ConversationWrap } from "../../Service/Model"
import { ChannelTypeCommunityTopic } from "../../Service/Const"
import { shouldSkipChannelForSpace, shouldSkipPersonConversationForSpace } from "../../Service/SpaceService"
import { filterArchivedThreads } from "../ConversationListGrouped/archivedThreads"
import { debounce } from "../../Utils/rateLimit"
import WKApp from "../../App"
import SidebarService from "../../Service/SidebarService"
import { ForwardItem } from "./ForwardModal"
import { candidateToForwardItem } from "./candidateToForwardItem"
import { chatTypeToChannelType } from "./chatTypeToChannelType"
import {
  filterChatSelectorItems,
  type ChatSelectorTab,
  type ChatSelectorAccessors,
  type ChatKind,
} from "../ChatSelector/tabFilter"
import type { ForwardFinished, ForwardGrantRole } from "./grant"

// 复合 key：${channelType}::${channelID}，防跨类型 id 碰撞。channelType 取值
// (个人=1 / 群=2 / 子区=5) 恰与 SidebarTargetType(DM/CHANNEL/THREAD) 一致，
// 故转发本地 item 与 SidebarService 返回的关注/最近集合可直接对齐比较。
function forwardItemKey(item: ForwardItem): string {
  return `${item.channelType}::${item.channelID}`
}

// 归类：个人→私聊，子区→thread，其余→群。供四 Tab 作用域过滤使用。
function forwardItemKind(item: ForwardItem): ChatKind {
  if (item.channelType === ChannelTypePerson) return "direct"
  if (item.isThread || item.channelType === ChannelTypeCommunityTopic) return "thread"
  return "group"
}

const FORWARD_ITEM_ACCESSORS: ChatSelectorAccessors<ForwardItem> = {
  getId: (i) => i.channelID,
  getName: (i) => i.displayName,
  getKind: forwardItemKind,
  getParentId: (i) => i.parentChannelID,
  getKey: forwardItemKey,
  // 父群恒为群聊，故以群类型（ChannelTypeGroup）构造复合 key，与 forwardItemKey 同构。
  getGroupKeyFromId: (parentId) => `${ChannelTypeGroup}::${parentId}`,
}

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
  /** 当前 Tab（关注 / 最近 / 全部群聊 / 全部私聊）。 */
  activeTab: ChatSelectorTab
  /** 切换 Tab。 */
  setActiveTab: (tab: ChatSelectorTab) => void
  /** 更新 input 显示值，内部 debounce 后更新过滤 keyword */
  setInputValue: (val: string) => void
  toggleSelect: (item: ForwardItem) => void
  confirm: () => void
  reset: () => void
  /** 懒加载：项进入视口时调用，按需拉取 channelInfo；去重 */
  requestChannelInfoIfNeeded: (item: ForwardItem) => void
  /** 授权区 UI 状态（仅在调用方传入 grantOptions 时有意义）。 */
  grantEnabled: boolean
  grantRole: ForwardGrantRole
  setGrantEnabled: (v: boolean) => void
  setGrantRole: (r: ForwardGrantRole) => void
}

/**
 * Opt-in grant options. When present the hook manages the授权区 UI state (enabled/role) and
 * emits a `grant` second argument on confirm; when absent, confirm keeps the legacy
 * single-argument `onFinished(channels)` behaviour (既有转发路径零回归).
 */
export interface UseForwardModalGrantOptions {
  canGrant: boolean
  defaultRole?: ForwardGrantRole
}

export function useForwardModal(
  onFinished?: ForwardFinished,
  grantOptions?: UseForwardModalGrantOptions
): UseForwardModalResult {
  const [conversationItems, setConversationItems] = useState<ForwardItem[]>([])
  const [friendItems, setFriendItems] = useState<ForwardItem[]>([])
  const [searchGroupItems, setSearchGroupItems] = useState<ForwardItem[]>([])
  const [selectedIDs, setSelectedIDs] = useState<string[]>([])
  const [inputValue, setInputValueState] = useState("")
  const [keyword, setKeyword] = useState("")
  const [loading, setLoading] = useState(true)
  // 四 Tab：关注 / 最近 / 全部群聊 / 全部私聊（对齐智能纪要选择器）。默认「最近」，
  // 因转发本地数据源以最近会话为主，落地即有内容，避免默认「关注」空集。
  const [activeTab, setActiveTab] = useState<ChatSelectorTab>("recent")
  // 关注集合（复合 key）：来自 SidebarService follow 同步，供「关注」Tab 过滤。
  const [followedKeys, setFollowedKeys] = useState<Set<string>>(new Set())
  // 最近集合（复合 key）：由本地最近会话（wrapsRef）派生，供「最近」Tab 过滤。
  // 方案 (b) 下「最近」直接等价于最近会话，不依赖后端 recent 同步。
  const [recentKeys, setRecentKeys] = useState<Set<string>>(new Set())
  // 授权区状态：开关默认关闭（不勾选，需用户主动打开才走授权），角色默认 reader。
  // 仅在传入 grantOptions 时生效。
  const grantActive = !!grantOptions
  const [grantEnabled, setGrantEnabledState] = useState<boolean>(false)
  const [grantRole, setGrantRole] = useState<ForwardGrantRole>(grantOptions?.defaultRole ?? "reader")
  // 重开授权开关时复位为 reader（不记忆上次更高级别）→ AC-4 / AC-15。
  const setGrantEnabled = useCallback((v: boolean) => {
    setGrantEnabledState(v)
    if (v) setGrantRole(grantOptions?.defaultRole ?? "reader")
  }, [grantOptions?.defaultRole])
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

  // group/my 兜底群（recents 里缺席的群只在旁路返回，SDK 不建 conversation）。
  // 由 load() 在 gen 守卫通过后写入，rebuildConvItems 每次执行都消费它并与
  // recents 群合并，从而成为 conversationItems 的唯一写入路径，避免懒加载
  // channelInfo 到达后 rebuild 全量覆盖把兜底群冲掉的双写竞态。
  const extraGroupsRef = useRef<ChannelInfo[]>([])

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
    // 已并入的群 ID（recents 群 + extraGroups 群），用于去重与子区挂回。
    const seenGroupIDs = new Set<string>()
    // 最近集合：最近会话即「最近」Tab 的作用域，用复合 key 记录（含群/子区/私聊）。
    const recentKeySet = new Set<string>()
    for (const wrap of wrapsRef.current) {
      channelMapRef.current.set(wrap.channel.channelID, wrap.channel)
      recentKeySet.add(`${wrap.channel.channelType}::${wrap.channel.channelID}`)
      if (wrap.channel.channelType === ChannelTypeCommunityTopic) {
        threadWraps.push(wrap)
      } else {
        // recents 群：load() 入口的 shouldSkipChannelForSpace 已做权威 Space
        // 把关（channelSpaceMap → channelInfo → fail-closed），此处不再二次过滤。
        groupWraps.push(wrap)
        if (wrap.channel.channelType === ChannelTypeGroup) {
          seenGroupIDs.add(wrap.channel.channelID)
        }
      }
    }

    // group/my 兜底群：用群条目自带的权威 space_id（来自 group/my 行）按来源分流。
    const extraGroupItems: ForwardItem[] = []
    for (const groupInfo of extraGroupsRef.current) {
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
      items.push(conversationWrapToForwardItem(gw))
      const children = threadsByParent.get(gw.channel.channelID) || []
      for (const tw of children) {
        items.push(conversationWrapToForwardItem(tw, gw.channel.channelID))
      }
      // 已挂回的子区从 Map 移除，避免后续兜底重复追加。
      threadsByParent.delete(gw.channel.channelID)
    }
    // group/my 兜底群追加在 recents 群之后；其子区（仅来自 recents）挂回父群。
    for (const item of extraGroupItems) {
      items.push(item)
      const children = threadsByParent.get(item.channelID) || []
      for (const tw of children) {
        items.push(conversationWrapToForwardItem(tw, item.channelID))
      }
      threadsByParent.delete(item.channelID)
    }
    // 兜底：有 parentGroupNo 但父群既不在 recents 也不在 group/my 的子区，
    // 作为独立项追加到末尾（带 parentChannelID），避免父群确实缺席时被静默丢弃。
    for (const [parentGroupNo, children] of threadsByParent) {
      for (const tw of children) {
        items.push(conversationWrapToForwardItem(tw, parentGroupNo))
      }
    }
    // 找不到父群的孤儿子区（无 parentGroupNo）追加到末尾
    for (const ow of orphanThreads) {
      items.push(conversationWrapToForwardItem(ow))
    }

    setConversationItems(items)
    setRecentKeys(recentKeySet)
  }, [])

  useEffect(() => {
    async function load() {
      const gen = ++loadGenRef.current
      // 重入/切 Space 时先清空上一轮兜底群，避免第一帧 rebuild 用旧 Space 的
      // group/my 兜底群产出（空串/字段缺失分支会 fail-open 让旧 Space 群闪现）。
      // 代价仅冷启动第一帧不显示兜底群（本就冷状态，无损）。
      extraGroupsRef.current = []
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

        // 补全：获取用户加入的全部群聊（已支持 space_id 过滤）。
        // 不再直接 setConversationItems 第二次写入，而是存入 extraGroupsRef 并
        // 触发一次 rebuildConvItems，让其与 recents 群合并产出，杜绝双写竞态。
        const allGroups = await WKApp.dataSource.channelDataSource.groupSaveList()
        if (gen !== loadGenRef.current) return // 有更新的 load 在跑,丢弃本次结果
        extraGroupsRef.current = allGroups
        rebuildConvItems()

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

  // 关注集合同步：与智能纪要选择器一致，走 SidebarService follow 同步。
  // 数据源采用方案 (b)：转发列表主体仍复用本地会话 + group/my + 好友装配
  // （保证零权限回归、无新后端依赖），仅「关注」Tab 需要额外的关注集合，故
  // 这里只拉 follow（不拉 recent —— 转发「最近」直接映射本地最近会话/群列表）。
  // deviceId 为空时后端 validateSidebarRequest 必拒，跳过注定失败的请求，
  // 关注集合退化为空集（关注 Tab 显示空态）。
  useEffect(() => {
    const deviceUuid = WKApp.shared.deviceId || ""
    if (deviceUuid === "") {
      setFollowedKeys(new Set())
      return
    }
    let cancelled = false
    SidebarService.sync({ tab: "follow", device_uuid: deviceUuid })
      .then((resp) => {
        if (cancelled) return
        const keys = new Set<string>()
        for (const item of resp?.items ?? []) {
          if (item.is_followed) keys.add(`${item.target_type}::${item.target_id}`)
        }
        setFollowedKeys(keys)
      })
      .catch(() => {
        if (!cancelled) setFollowedKeys(new Set())
      })
    return () => {
      cancelled = true
    }
  }, [])


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
          // 保留 channelMapRef 副作用：confirm 时按 channelID 取回 Channel 引用。
          const ch = new Channel(c.chat_id, chatTypeToChannelType(c.chat_type))
          channelMapRef.current.set(c.chat_id, ch)
          return candidateToForwardItem(c)
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

  // 四 Tab 作用域 + 关键字过滤（方案 A：命中子区带出父群；命中父群不展开子区）。
  // 复用共享的 filterChatSelectorItems，保证与智能纪要选择器同一套过滤语义。
  // 注意：搜索时（keyword 非空）以搜索结果 uniqueSearchGroups 补充 allItems，
  // 这些后端候选未必落在 followed/recent 本地集合内，但「关注/最近」Tab 仍按
  // 集合过滤（搜后端全库群不应污染关注/最近作用域），与纪要行为一致。
  const filtered = filterChatSelectorItems(
    allItems,
    { activeTab, keyword, followedKeys, recentKeys },
    FORWARD_ITEM_ACCESSORS,
  )

  const toggleSelect = useCallback((item: ForwardItem) => {
    setSelectedIDs((prev: string[]) =>
      prev.includes(item.channelID)
        ? prev.filter((id: string) => id !== item.channelID)
        : [...prev, item.channelID]
    )
  }, [])

  const selectedIDsRef = useRef<string[]>(selectedIDs)
  selectedIDsRef.current = selectedIDs

  // Keep the grant selection reachable from the stable confirm() callback without
  // re-creating it on every toggle.
  const grantRef = useRef<{ active: boolean; enabled: boolean; role: ForwardGrantRole }>({
    active: grantActive,
    enabled: grantEnabled,
    role: grantRole,
  })
  grantRef.current = { active: grantActive, enabled: grantEnabled, role: grantRole }

  const selectedChannels = selectedIDs
    .map((id: string) => channelMapRef.current.get(id))
    .filter(Boolean) as Channel[]

  const confirm = useCallback(() => {
    const channels = selectedIDsRef.current
      .map((id: string) => channelMapRef.current.get(id))
      .filter(Boolean) as Channel[]
    if (onFinished && channels.length > 0) {
      const { active, enabled, role } = grantRef.current
      onFinished(channels, active && enabled ? { role } : undefined)
    }
  }, [onFinished])

  const reset = useCallback(() => {
    setSelectedIDs([])
    setInputValueState("")
    setKeyword("")
    setActiveTab("recent")
  }, [])

  return {
    items: filtered,
    allItems,
    selectedIDs,
    selectedChannels,
    inputValue,
    keyword,
    loading,
    activeTab,
    setActiveTab,
    setInputValue,
    toggleSelect,
    confirm,
    reset,
    requestChannelInfoIfNeeded,
    grantEnabled,
    grantRole,
    setGrantEnabled,
    setGrantRole,
  }
}
