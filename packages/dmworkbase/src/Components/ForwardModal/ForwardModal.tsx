import React, { useCallback } from "react"
import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk"
import { X } from "lucide-react"
import { IconSearchStroked } from "@douyinfe/semi-icons"
import { Tag, Tabs, TabPane } from "@douyinfe/semi-ui"
import Checkbox from "../Checkbox"
import AiBadge from "../AiBadge"
import WKAvatar from "../WKAvatar"
import VisibilityTrigger from "../VisibilityTrigger"
import { useI18n } from "../../i18n"
import { ChannelTypeCommunityTopic } from "../../Service/Const"
import type { ChatSelectorTab } from "../ChatSelector/tabFilter"
import type { ForwardGrantConfig } from "./grant"
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

// ─── 授权区（opt-in，仅 grant 存在时渲染）─────────────────────────────

function GrantArea({ grant }: { grant: ForwardGrantConfig }) {
  const { t } = useI18n()
  if (!grant.canGrant) {
    return (
      <div className="wk-fm-grant wk-fm-grant--disabled">
        <span className="wk-fm-grant-lock">🔒</span>
        <span className="wk-fm-grant-hint">
          {grant.disabledReason ?? t("base.forwardModal.grant.disabledReason")}
        </span>
      </div>
    )
  }
  return (
    <div className="wk-fm-grant">
      <div className="wk-fm-grant-row">
        <label className="wk-fm-grant-switch">
          <Checkbox checked={grant.enabled} onCheck={() => grant.onEnabledChange(!grant.enabled)} />
          <span className="wk-fm-grant-label">{t("base.forwardModal.grant.enableLabel")}</span>
        </label>
        <select
          className="wk-fm-grant-role"
          value={grant.role}
          disabled={!grant.enabled}
          onChange={(e) => grant.onRoleChange(e.target.value as ForwardGrantConfig["role"])}
        >
          <option value="reader">{t("base.forwardModal.grant.roleReader")}</option>
          <option value="writer">{t("base.forwardModal.grant.roleWriter")}</option>
        </select>
      </div>
      {grant.enabled && typeof grant.targetMemberCount === "number" && grant.targetMemberCount > 0 && (
        <div className="wk-fm-grant-members">
          {t("base.forwardModal.grant.targetMembers", { values: { count: grant.targetMemberCount } })}
        </div>
      )}
    </div>
  )
}

// ─── 左列：可选列表项 ───────────────────────────────────────────

interface ItemRowProps {
  item: ForwardItem
  selected: boolean
  flat: boolean
  showMeta: boolean
  onToggle: (item: ForwardItem) => void
}

function getKindLabel(item: ForwardItem, t: ReturnType<typeof useI18n>["t"]): string {
  if (item.isThread || item.channelType === ChannelTypeCommunityTopic) {
    return t("base.forwardModal.kindThread")
  }
  if (item.channelType === ChannelTypePerson) {
    return t("base.forwardModal.kindDirect")
  }
  return t("base.forwardModal.kindGroup")
}

function ItemRow({ item, selected, flat, showMeta, onToggle }: ItemRowProps) {
  const { t } = useI18n()
  const channel = new Channel(item.channelID, item.channelType)
  const kindLabel = showMeta ? getKindLabel(item, t) : ""
  const isExternalGroup = item.channelType === ChannelTypeGroup && item.isExternal
  return (
    <div
      className={`wk-fm-item${!flat && item.parentChannelID ? " wk-fm-item--child" : ""}${flat ? " wk-fm-item--flat" : ""}${selected ? " wk-fm-item--selected" : ""}`}
      onClick={() => onToggle(item)}
    >
      <Checkbox
        checked={selected}
        onCheck={() => {}}
      />
      <div className="wk-fm-avatar-wrap">
        <WKAvatar channel={channel} lazy />
      </div>
      <div className="wk-fm-item-main">
        <div className="wk-fm-item-title-row">
          <span className="wk-fm-item-name">{item.displayName}</span>
          {showMeta && item.isAI && <AiBadge size="small" />}
        </div>
      </div>
      {showMeta && (
        <div className="wk-fm-item-meta">
          <span>{kindLabel}</span>
          {isExternalGroup && (
            <>
              <span className="wk-fm-item-meta-separator">·</span>
              <span>{t("base.forwardModal.external")}</span>
            </>
          )}
        </div>
      )}
      {!showMeta && isExternalGroup && (
        <Tag
          size="small"
          color="purple"
          className="wk-conversationlist-item-external-tag"
        >
          {t("base.forwardModal.external")}
        </Tag>
      )}
      {!showMeta && item.isAI && <AiBadge />}
    </div>
  )
}

// ─── 右列：已选列表项 ───────────────────────────────────────────

interface SelectedRowProps {
  item: ForwardItem
  onRemove: (item: ForwardItem) => void
}

function SelectedRow({ item, onRemove }: SelectedRowProps) {
  const { t } = useI18n()
  const channel = new Channel(item.channelID, item.channelType)
  return (
    <div className="wk-fm-selected-item">
      <div className="wk-fm-avatar-wrap">
        {/* 右列已选列表项数量少且都在视口内，不启用 lazy 避免占位 SVG → 真实
            图的视觉闪烁 */}
        <WKAvatar channel={channel} />
      </div>
      <span className="wk-fm-item-name">{item.displayName}</span>
      <button
        className="wk-fm-remove-btn"
        onClick={(e) => {
          e.stopPropagation()
          onRemove(item)
        }}
        aria-label={t("base.forwardModal.remove")}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}

// ─── 主组件 ──────────────────────────────────────────────────────

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
  const selectedSet = new Set(selectedIDs)
  const sourceForSelected = allItems ?? items
  const selectedItems = sourceForSelected.filter((i) => selectedSet.has(i.channelID))
  const modalTitle = title ?? t("base.forwardModal.title")
  const recentFlatList = activeTab === "recent"

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onInputChange(e.target.value)
    },
    [onInputChange]
  )

  return (
    <div className="wk-fm">
      {/* Header */}
      <div className="wk-fm-header">
        <span className="wk-fm-title">{modalTitle}</span>
      </div>

      {/* 内容区：左右两列 */}
      <div className="wk-fm-content">

        {/* 左列：搜索 + 可选列表 */}
        <div className="wk-fm-left">
          {/* 搜索框 */}
          <div className="wk-fm-search">
            <IconSearchStroked className="wk-fm-search-icon" />
            <input
              className="wk-fm-search-input"
              placeholder={t("base.forwardModal.searchPlaceholder")}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
            />
          </div>

          {/* 四 Tab：关注 / 最近 / 全部群聊 / 全部私聊（对齐智能纪要选择器） */}
          <Tabs
            activeKey={activeTab}
            onChange={(key) => onTabChange(key as ChatSelectorTab)}
            size="small"
            className="wk-fm-tabs"
          >
            <TabPane tab={t("base.forwardModal.tabFollowed")} itemKey="followed" />
            <TabPane tab={t("base.forwardModal.tabRecent")} itemKey="recent" />
            <TabPane tab={t("base.forwardModal.tabAllGroups")} itemKey="group" />
            <TabPane tab={t("base.forwardModal.tabAllDirects")} itemKey="direct" />
          </Tabs>

          {/* 可选列表 */}
          <div className="wk-fm-list">
            {loading ? (
              <div className="wk-fm-empty">{t("base.forwardModal.loading")}</div>
            ) : items.length === 0 ? (
              <div className="wk-fm-empty">{t("base.forwardModal.noContacts")}</div>
            ) : (
              items.map((item) => {
                const row = (
                  <ItemRow
                    item={item}
                    selected={selectedSet.has(item.channelID)}
                    flat={recentFlatList}
                    showMeta={recentFlatList}
                    onToggle={onToggleSelect}
                  />
                )
                if (onItemVisible) {
                  return (
                    <VisibilityTrigger
                      key={item.channelID}
                      onVisible={() => onItemVisible(item)}
                    >
                      {row}
                    </VisibilityTrigger>
                  )
                }
                return <React.Fragment key={item.channelID}>{row}</React.Fragment>
              })
            )}
          </div>
        </div>

        {/* 分割线 */}
        <div className="wk-fm-divider" />

        {/* 右列：已选列表 */}
        <div className="wk-fm-right">
          {selectedItems.length === 0 ? (
            <div className="wk-fm-empty wk-fm-empty--right">{t("base.forwardModal.noneSelected")}</div>
          ) : (
            <>
              <div className="wk-fm-selected-title">
                {t("base.forwardModal.selectedCount", { values: { count: selectedItems.length } })}
              </div>
              <div className="wk-fm-selected-list">
                {selectedItems.map((item) => (
                  <SelectedRow
                    key={item.channelID}
                    item={item}
                    onRemove={onToggleSelect}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 授权区（opt-in）：仅当调用方传入 grant 时渲染，插在内容区与 Footer 之间。 */}
      {grant && <GrantArea grant={grant} />}

      {/* Footer */}
      <div className="wk-fm-footer">
        {onCancel && (
          <button className="wk-fm-btn wk-fm-btn--cancel" onClick={onCancel}>
            {t("base.common.cancel")}
          </button>
        )}
        <button
          className="wk-fm-btn wk-fm-btn--confirm"
          onClick={onConfirm}
          disabled={selectedIDs.length === 0}
        >
          {selectedIDs.length > 0
            ? t("base.forwardModal.confirmWithCount", { values: { count: selectedIDs.length } })
            : t("base.forwardModal.confirm")}
        </button>
      </div>
    </div>
  )
}

export default ForwardModal
