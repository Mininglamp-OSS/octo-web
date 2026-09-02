import React, { useMemo } from "react"
import { useI18n } from "../../i18n"
import type { ChatSelectorTab } from "../ChatSelector/tabFilter"
import type { ForwardGrantConfig } from "./grant"
import type { ForwardBotPreview } from "./ui/ItemRow"
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
  showHeader?: boolean
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
  /**
   * Person-row Bot preview (UX #4). Present only when the caller opts into grants; lets an
   * unselected person candidate be expanded to inspect their Bots (display-only). Absent → no
   * expander (既有转发路径零回归).
   */
  botPreview?: ForwardBotPreview
}

/**
 * 转发弹窗 UI shell：Header + 左（搜索/Tabs/列表）+ 右（已选）+ 授权区（opt-in）+ Footer。
 * 数据装配、过滤、选择、授权都在上层 useForwardModal / ConversationSelect 完成，
 * 这里只做纯渲染与事件转发，便于后续 UI 升级。
 */
export function ForwardModal({
  title,
  showHeader = true,
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
  botPreview,
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
      {showHeader ? (
        <div className="wk-fm-header">
          <span className="wk-fm-title">{modalTitle}</span>
        </div>
      ) : null}

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
            botPreview={botPreview}
          />
        </div>

        <div className="wk-fm-divider" />

        <div className="wk-fm-right">
          {/* Right panel shares the ONE authoritative Bot snapshot (Scope C): when the grant switch
              is on, a selected person shows their selected/default Bots nested, synced with the
              授权区. Off / group / thread targets stay flat. */}
          <SelectedPanel
            selectedItems={selectedItems}
            onRemove={onToggleSelect}
            bots={grant?.enabled ? grant.bots : undefined}
          />
        </div>
      </div>

      {/* 授权区（opt-in）：仅当调用方传入 grant 时渲染，插在内容区与 Footer 之间。 */}
      {grant && <GrantArea grant={grant} />}

      <Footer
        selectedCount={selectedIDs.length}
        confirmDisabled={!!grant?.enabled && !!grant.bots && !grant.bots.ready}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  )
}

export default ForwardModal
