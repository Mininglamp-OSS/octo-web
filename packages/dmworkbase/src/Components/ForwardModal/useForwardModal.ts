import { useCallback, useMemo, useState } from "react"
import type { Channel } from "wukongimjssdk"
import type { ForwardItem } from "./ForwardModal"
import {
  filterChatSelectorItems,
  type ChatSelectorTab,
} from "../ChatSelector/tabFilter"
import type { ForwardFinished, ForwardGrantRole } from "./grant"
import {
  FORWARD_ITEM_ACCESSORS,
  mergeForwardSources,
  sortRecentItems,
} from "./logic"
import {
  useDebouncedKeyword,
  useForwardCandidates,
  useForwardGrant,
  useForwardSearch,
  useForwardSelection,
  useSidebarScopes,
  type UseForwardGrantOptions,
} from "./hooks"

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
export type UseForwardModalGrantOptions = UseForwardGrantOptions

/**
 * 转发弹窗的组合层。数据/搜索/关注/选择/授权都拆到独立 hook；这里只做四件事：
 *   1. 把候选来源合并成 allItems；
 *   2. 按当前 Tab + keyword 过滤（复用与纪要选择器同一套 filterChatSelectorItems）；
 *   3. 最近 Tab 再叠一层 sidebar 置顶 + timestamp 排序；
 *   4. confirm 时从 selection + grant 两个 hook 读快照，透传给 onFinished。
 */
export function useForwardModal(
  onFinished?: ForwardFinished,
  grantOptions?: UseForwardModalGrantOptions,
): UseForwardModalResult {
  // 四 Tab：关注 / 最近 / 全部群聊 / 全部私聊。默认「最近」。
  const [activeTab, setActiveTab] = useState<ChatSelectorTab>("recent")

  // 输入框防抖：inputValue 即时更新驱动 UI，keyword 静默 300ms 才生效驱动过滤 + 搜索。
  const { inputValue, keyword, setInputValue, reset: resetKeyword } = useDebouncedKeyword()

  // 关注/最近集合作用域：来自 SidebarService follow/recent 同步；deviceId 空时退化空集。
  const { followedKeys, recentKeys, recentSortMeta } = useSidebarScopes()

  // 候选装配：最近会话 + group/my 兜底群 + 好友；持有 channelMapRef 供搜索/选择共享。
  const {
    conversationItems,
    friendItems,
    loading,
    channelMapRef,
    requestChannelInfoIfNeeded,
  } = useForwardCandidates()

  // 后端搜索：keyword 驱动，命中候选把 Channel 登记到 channelMapRef。
  const { searchGroupItems } = useForwardSearch(keyword, (channelID, channel) => {
    channelMapRef.current.set(channelID, channel)
  })

  // 选择态：selectedIDs / toggle / selectedChannels（从 channelMapRef 派生）。
  const {
    selectedIDs,
    selectedChannels,
    toggleSelect,
    readSelectedChannels,
    reset: resetSelection,
  } = useForwardSelection(channelMapRef)

  // 授权区：默认关闭，仅在 grantOptions 存在时激活；confirm 时读快照透传给 onFinished。
  const {
    grantEnabled,
    grantRole,
    setGrantEnabled,
    setGrantRole,
    readConfirmPayload: readGrantPayload,
  } = useForwardGrant(grantOptions)

  // 合并去重：conversationItems 优先，friend 已在 conversation 里的跳过，搜索群组追加
  const allItems = useMemo(
    () => mergeForwardSources(conversationItems, friendItems, searchGroupItems),
    [conversationItems, friendItems, searchGroupItems],
  )

  // 四 Tab 作用域 + 关键字过滤（方案 A：命中子区带出父群；命中父群不展开子区）。
  // 复用共享的 filterChatSelectorItems，保证与智能纪要选择器同一套过滤语义。
  // 注意：搜索时（keyword 非空）以搜索结果 uniqueSearchGroups 补充 allItems，
  // 这些后端候选未必落在 followed/recent 集合内，但「关注/最近」Tab 仍按
  // 集合过滤（搜后端全库群不应污染关注/最近作用域），与纪要行为一致。
  const filteredBase = useMemo(
    () =>
      filterChatSelectorItems(
        allItems,
        { activeTab, keyword, followedKeys, recentKeys },
        FORWARD_ITEM_ACCESSORS,
      ),
    [allItems, activeTab, keyword, followedKeys, recentKeys],
  )
  const filtered = useMemo(
    () =>
      activeTab === "recent" ? sortRecentItems(filteredBase, recentSortMeta) : filteredBase,
    [activeTab, filteredBase, recentSortMeta],
  )

  const confirm = useCallback(() => {
    const channels = readSelectedChannels()
    if (onFinished && channels.length > 0) {
      onFinished(channels, readGrantPayload())
    }
  }, [onFinished, readSelectedChannels, readGrantPayload])

  const reset = useCallback(() => {
    resetSelection()
    resetKeyword()
    setActiveTab("recent")
  }, [resetSelection, resetKeyword])

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
