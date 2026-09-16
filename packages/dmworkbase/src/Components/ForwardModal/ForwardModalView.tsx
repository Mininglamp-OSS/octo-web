import React, { useMemo } from "react"
import { useI18n } from "../../i18n"
import type { ChatSelectorTab } from "../ChatSelector/tabFilter"
import type { ForwardGrantConfig } from "./grant"
import type { ForwardBotPreview } from "./ui/ItemRow"
import { ForwardAvatarContext, type ForwardAvatarRenderer } from "./ui/avatar"
import { Footer, GrantArea, ItemList, SearchBar, SelectedPanel, TabsBar } from "./ui"
import "./ForwardModal.css"
export type { ForwardAvatarRenderer } from "./ui/avatar"

export interface ForwardModalViewItem {
  channelID: string
  channelType: number
  displayName: string
  avatarURL?: string
  isAI?: boolean
  hasThreads?: boolean
  isThread?: boolean
  isPinned?: boolean
  parentChannelID?: string
  isExternal?: boolean
}

export interface ForwardModalViewProps {
  title?: string
  items: ForwardModalViewItem[]
  allItems?: ForwardModalViewItem[]
  selectedIDs: string[]
  inputValue: string
  loading?: boolean
  loadError?: boolean
  onRetry?: () => void
  onInputChange: (val: string) => void
  onToggleSelect: (item: ForwardModalViewItem) => void
  onConfirm: () => void
  onCancel?: () => void
  activeTab: ChatSelectorTab
  onTabChange: (tab: ChatSelectorTab) => void
  onItemVisible?: (item: ForwardModalViewItem) => void
  grant?: ForwardGrantConfig
  botPreview?: ForwardBotPreview
  renderAvatar?: ForwardAvatarRenderer
}

/** Shared picker UI. Candidate loading, grants and sending remain in ConversationSelect/WKBase. */
export function ForwardModalView({
  title, items, allItems, selectedIDs, inputValue, loading = false, loadError = false,
  onRetry, onInputChange, onToggleSelect, onConfirm, onCancel, activeTab, onTabChange,
  onItemVisible, grant, botPreview, renderAvatar,
}: ForwardModalViewProps) {
  const { t } = useI18n()
  const sourceForSelected = allItems ?? items
  const selectedSet = useMemo(() => new Set(selectedIDs), [selectedIDs])
  const selectedItems = useMemo(
    () => sourceForSelected.filter((i) => selectedSet.has(i.channelID)),
    [sourceForSelected, selectedSet],
  )
  const recentFlatList = activeTab === "recent"
  return (
    <ForwardAvatarContext.Provider value={renderAvatar}>
      <div className="wk-fm">
        <div className="wk-fm-header">
          <span className="wk-fm-title">{title ?? t("base.forwardModal.title")}</span>
        </div>
        <div className="wk-fm-content">
          <div className="wk-fm-left">
            <SearchBar value={inputValue} onChange={onInputChange} />
            <TabsBar activeTab={activeTab} onTabChange={onTabChange} />
            <ItemList
              items={items}
              selectedSet={selectedSet}
              loading={loading}
              loadError={loadError}
              onRetry={onRetry}
              flat={recentFlatList}
              showMeta={recentFlatList}
              onToggleSelect={onToggleSelect}
              onItemVisible={onItemVisible}
              botPreview={botPreview}
            />
          </div>
          <div className="wk-fm-divider" />
          <div className="wk-fm-right">
            <SelectedPanel selectedItems={selectedItems} onRemove={onToggleSelect} bots={grant?.enabled ? grant.bots : undefined} />
          </div>
        </div>
        {grant && <GrantArea grant={grant} />}
        <Footer
          selectedCount={selectedIDs.length}
          confirmDisabled={!!grant?.enabled && !!grant.bots && !grant.bots.ready}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </div>
    </ForwardAvatarContext.Provider>
  )
}
