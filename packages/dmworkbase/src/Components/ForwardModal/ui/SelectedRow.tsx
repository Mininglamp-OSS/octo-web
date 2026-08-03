import React from "react"
import { Channel } from "wukongimjssdk"
import { X } from "lucide-react"
import WKAvatar from "../../WKAvatar"
import { useI18n } from "../../../i18n"
import type { ForwardItem } from "../ForwardModal"

/** 右列已选列表项：头像 + 名称 + 移除按钮。 */
export interface SelectedRowProps {
  item: ForwardItem
  onRemove: (item: ForwardItem) => void
}

export function SelectedRow({ item, onRemove }: SelectedRowProps) {
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
