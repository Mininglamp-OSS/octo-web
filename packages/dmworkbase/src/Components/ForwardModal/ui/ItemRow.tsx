import React, { useMemo } from "react"
import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk"
import { Tag } from "@douyinfe/semi-ui"
import Checkbox from "../../Checkbox"
import AiBadge from "../../AiBadge"
import WKAvatar from "../../WKAvatar"
import { useI18n } from "../../../i18n"
import { ChannelTypeCommunityTopic } from "../../../Service/Const"
import type { ForwardItem } from "../ForwardModal"

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

function ItemRowInner({ item, selected, flat, showMeta, onToggle }: ItemRowProps) {
  const { t } = useI18n()
  // 只依赖 channelID / channelType 的 Channel 引用；同一 item 复用同一实例,
  // 避免每次渲染都 new Channel(...) 让 WKAvatar 判断 prop 变化重渲。
  const channel = useMemo(
    () => new Channel(item.channelID, item.channelType),
    [item.channelID, item.channelType],
  )
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

export const ItemRow = React.memo(ItemRowInner)
