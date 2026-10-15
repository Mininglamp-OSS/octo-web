import React, { useLayoutEffect, useMemo, useRef, useState } from "react"
import { Toast } from "@douyinfe/semi-ui"
import { useI18n } from "../../i18n"
import type { ChatSelectorTab } from "../ChatSelector/tabFilter"
import type { ForwardGrantConfig } from "./grant"
import type { ForwardBotPreview } from "./ui/ItemRow"
import { ForwardAvatarContext, type ForwardAvatarRenderer } from "./ui/avatar"
import { Footer, GrantArea, ItemList, SearchBar, SelectedPanel, TabsBar } from "./ui"
import { MAX_MESSAGE_LENGTH } from "../../Utils/messageLimits"
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
  /** Only forwarding callers opt in; ordinary conversation pickers stay unchanged. */
  withComment?: boolean
  onConfirm: (comment?: string) => void
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
  onItemVisible, grant, botPreview, renderAvatar, withComment = false,
}: ForwardModalViewProps) {
  const { t } = useI18n()
  const [comment, setComment] = useState("")
  const [commentError, setCommentError] = useState(false)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = commentRef.current
    if (!input) return
    // Reset first so deleting text also shrinks the input; CSS caps it at three lines.
    input.style.height = "auto"
    const borderHeight = input.offsetHeight - input.clientHeight
    input.style.height = `${input.scrollHeight + borderHeight}px`
  }, [comment, withComment])
  const confirm = () => {
    if (!selectedIDs.length) return
    if (withComment && comment.length > MAX_MESSAGE_LENGTH) {
      setCommentError(true)
      Toast.error(t("base.forwardModal.commentTooLong", { values: { max: MAX_MESSAGE_LENGTH } }))
      return
    }
    if (withComment) onConfirm(comment)
    else onConfirm()
  }
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
            {withComment && (
              <div className="wk-fm-comment">
                <textarea
                  className="wk-fm-comment-input"
                  ref={commentRef}
                  rows={1}
                  aria-label={t("base.forwardModal.commentPlaceholder")}
                  placeholder={t("base.forwardModal.commentPlaceholder")}
                  aria-invalid={commentError || undefined}
                  value={comment}
                  onChange={(event) => {
                    setComment(event.target.value)
                    setCommentError(false)
                  }}
                />
              </div>
            )}
          </div>
        </div>
        {grant && <GrantArea grant={grant} />}
        <Footer
          selectedCount={selectedIDs.length}
          confirmDisabled={!!grant?.enabled && !!grant.bots && !grant.bots.ready}
          onConfirm={confirm}
          onCancel={onCancel}
        />
      </div>
    </ForwardAvatarContext.Provider>
  )
}
