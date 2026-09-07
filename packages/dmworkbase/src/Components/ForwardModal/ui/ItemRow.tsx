import React, { useMemo, useState } from "react"
import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk"
import Checkbox from "../../Checkbox"
import AiBadge from "../../AiBadge"
import WKAvatar from "../../WKAvatar"
import { useI18n } from "../../../i18n"
import { ChannelTypeCommunityTopic } from "../../../Service/Const"
import type { ForwardItem } from "../ForwardModal"
import type { ForwardBotPreviewItem } from "../hooks"

/**
 * Person-row Bot PREVIEW binding (UX #4). Present only when the caller opts into grants and the
 * shared Space-Bot catalog is ready. `botsFor` returns the Bots a person created (whole-space Bots
 * only ever surface under their creator, never under a group/thread row). Preview is display-only:
 * expanding never selects the target and its Bot controls are disabled; the 授权区 stays
 * authoritative for the actual grant selection.
 */
export interface ForwardBotPreview {
  botsFor: (creatorUid: string) => ForwardBotPreviewItem[]
}

/**
 * 左列列表项。三种视图模式：
 *   - flat=true  平铺（最近 Tab）：无缩进、显示 kind/external 元信息文字
 *   - flat=false 树形（关注/群/私聊 Tab）：子区带一级缩进、外部群/AI 用 Tag/Badge
 *
 * React.memo：500 行列表下,一次键入 / toggleSelect 会触发 ForwardModal 重渲；
 * item / selected / flat / showMeta / onToggle 都不变时,memo 直接短路,免去
 * 500 次子渲染 + Channel 构造 + WKAvatar 重渲。
 */
export interface ItemRowProps {
  item: ForwardItem
  selected: boolean
  flat: boolean
  showMeta: boolean
  onToggle: (item: ForwardItem) => void
  /** Person-row Bot preview (UX #4). Absent → no expander (既有转发路径零回归). */
  botPreview?: ForwardBotPreview
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

function ItemRowInner({ item, selected, flat, showMeta, onToggle, botPreview }: ItemRowProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  // 只依赖 channelID / channelType 的 Channel 引用；同一 item 复用同一实例,
  // 避免每次渲染都 new Channel(...) 让 WKAvatar 判断 prop 变化重渲。
  const channel = useMemo(
    () => new Channel(item.channelID, item.channelType),
    [item.channelID, item.channelType],
  )
  const kindLabel = showMeta ? getKindLabel(item, t) : ""
  const isExternalGroup = item.channelType === ChannelTypeGroup && item.isExternal
  // Bot preview is a PERSON-only affordance: whole-space Bots surface under their creator, never
  // under a group/thread row (UX #4). A thread person row (isThread) is not a plain person peer.
  const isPerson = item.channelType === ChannelTypePerson && !item.isThread
  const previewBots = isPerson && botPreview ? botPreview.botsFor(item.channelID) : []
  const hasPreview = previewBots.length > 0
  const row = (
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
      {hasPreview && (
        // Separate control: toggling the preview must NOT select/deselect the target (UX #4).
        <button
          type="button"
          className="wk-fm-item-bot-expand"
          aria-expanded={expanded}
          aria-label={t(expanded ? "base.forwardModal.hideBotsPreview" : "base.forwardModal.showBotsPreview", {
            values: { count: previewBots.length },
          })}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
        >
          <span className="wk-fm-item-bot-chevron" aria-hidden="true" />
        </button>
      )}
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
        <span className="wk-conversationlist-item-external-tag">
          {t("base.forwardModal.external")}
        </span>
      )}
      {!showMeta && item.isAI && <AiBadge />}
    </div>
  )
  if (!hasPreview) return row
  return (
    <div className="wk-fm-item-wrap">
      {row}
      {expanded && (
        <div className="wk-fm-item-bots">
          {previewBots.map((bot) => (
            // Display-only preview: the checkbox is disabled and unchecked. Selecting the person is
            // what defaults these on in the authoritative 授权区 (GrantArea), not this preview.
            <label className="wk-fm-item-bot" key={bot.uid}>
              <Checkbox checked={false} disabled onCheck={() => {}} />
              <span className="wk-fm-item-bot-name">{bot.name}</span>
              <AiBadge size="small" />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export const ItemRow = React.memo(ItemRowInner)
