import React, { useMemo } from "react"
import { useI18n } from "../../i18n"
import type { ChatSelectorTab } from "../ChatSelector/tabFilter"
import type { ForwardGrantConfig } from "./grant"
import {
  Footer,
  GrantArea,
  ItemList,
  SearchBar,
  SelectedPanel,
  TabsBar,
} from "./ui"
import "./ForwardModal.css"

export interface ForwardItem {
  channelID: string
  channelType: number
  displayName: string
  avatarURL?: string
  isAI?: boolean
  hasThreads?: boolean
  isThread?: boolean
  isPinned?: boolean
  parentChannelID?: string
  /** 外部群（is_external_group === 1）；仅 ChannelTypeGroup 有意义 */
  isExternal?: boolean
}

export interface ForwardModalProps {
  title?: string
  items: ForwardItem[]
  allItems?: ForwardItem[]
  selectedIDs: string[]
  inputValue: string
  loading?: boolean
  onInputChange: (val: string) => void
  onToggleSelect: (item: ForwardItem) => void
  onConfirm: () => void
  onCancel?: () => void
  /** 当前 Tab（关注 / 最近 / 全部群聊 / 全部私聊）。 */
  activeTab: ChatSelectorTab
  /** 切换 Tab 回调。 */
  onTabChange: (tab: ChatSelectorTab) => void
  /** 懒加载：列表项进入视口时调用。未传则不触发懒加载（用于不需要拉 channelInfo 的场景） */
  onItemVisible?: (item: ForwardItem) => void
  /**
   * 授权区配置（feature #511 opt-in 扩展）。仅当调用方显式传入时才渲染授权区；
   * 既有转发路径（Conversation / Chat / Summary）不传 → 授权区不渲染，零回归。
   */
  grant?: ForwardGrantConfig
}

/**
 * 转发弹窗 UI shell：Header + 左（搜索/Tabs/列表）+ 右（已选）+ 授权区（opt-in）+ Footer。
 * 数据装配、过滤、选择、授权都在上层 useForwardModal / ConversationSelect 完成，
 * 这里只做纯渲染与事件转发，便于后续 UI 升级。
 */
export function ForwardModal({
  title,
  items,
  allItems,
  selectedIDs,
  inputValue,
  loading = false,
  onInputChange,
  onToggleSelect,
  onConfirm,
  onCancel,
  activeTab,
  onTabChange,
  onItemVisible,
  grant,
}: ForwardModalProps) {
  const { t } = useI18n()
  const sourceForSelected = allItems ?? items
  const selectedSet = useMemo(() => new Set(selectedIDs), [selectedIDs])
  const selectedItems = useMemo(
    () => sourceForSelected.filter((i) => selectedSet.has(i.channelID)),
    [sourceForSelected, selectedSet],
  )
  const modalTitle = title ?? t("base.forwardModal.title")
  const recentFlatList = activeTab === "recent"

  return (
    <div className="wk-fm">
      <div className="wk-fm-header">
        <span className="wk-fm-title">{modalTitle}</span>
      </div>

      <div className="wk-fm-content">
        <div className="wk-fm-left">
          <SearchBar value={inputValue} onChange={onInputChange} />
          <TabsBar activeTab={activeTab} onTabChange={onTabChange} />
          <ItemList
            items={items}
            selectedSet={selectedSet}
            loading={loading}
            flat={recentFlatList}
            showMeta={recentFlatList}
            onToggleSelect={onToggleSelect}
            onItemVisible={onItemVisible}
          />
        </div>

        <div className="wk-fm-divider" />

        <div className="wk-fm-right">
          <SelectedPanel selectedItems={selectedItems} onRemove={onToggleSelect} />
        </div>
      </div>

      {/* 授权区（opt-in）：仅当调用方传入 grant 时渲染，插在内容区与 Footer 之间。 */}
      {grant && <GrantArea grant={grant} />}

      <Footer selectedCount={selectedIDs.length} onConfirm={onConfirm} onCancel={onCancel} />
    </div>
  )
}

export default ForwardModal
