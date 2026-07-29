import React from "react"
import { useI18n } from "../../../i18n"
import type { ForwardItem } from "../ForwardModal"
import { SelectedRow } from "./SelectedRow"

/** 右列已选列表。空态时展示提示；有选中时展示计数标题 + 逐行 SelectedRow。 */
export interface SelectedPanelProps {
  selectedItems: ForwardItem[]
  onRemove: (item: ForwardItem) => void
}

export function SelectedPanel({ selectedItems, onRemove }: SelectedPanelProps) {
  const { t } = useI18n()
  if (selectedItems.length === 0) {
    return (
      <div className="wk-fm-empty wk-fm-empty--right">
        {t("base.forwardModal.noneSelected")}
      </div>
    )
  }
  return (
    <>
      <div className="wk-fm-selected-title">
        {t("base.forwardModal.selectedCount", { values: { count: selectedItems.length } })}
      </div>
      <div className="wk-fm-selected-list">
        {selectedItems.map((item) => (
          <SelectedRow key={item.channelID} item={item} onRemove={onRemove} />
        ))}
      </div>
    </>
  )
}
