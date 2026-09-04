import React from "react"
import { Empty } from "@octo/ui"
import { useI18n } from "../../../i18n"
import type { ForwardItem } from "../ForwardModal"
import type { ForwardBotSnapshot } from "../grant"
import { SelectedRow, selectedBotsForPerson } from "./SelectedRow"

/** 右列已选列表。空态时展示提示；有选中时展示计数标题 + 逐行 SelectedRow。 */
export interface SelectedPanelProps {
  selectedItems: ForwardItem[]
  onRemove: (item: ForwardItem) => void
  /**
   * Authoritative Bot snapshot (Scope C). When present, a selected PERSON/private-chat target
   * renders its currently selected/default Bots nested beneath it, kept in lockstep with the 授权区
   * (same snapshot.toggleBot — no duplicate selection state). Group/thread targets stay flat: they
   * never render nested members/Bots here.
   */
  bots?: ForwardBotSnapshot
}

export function SelectedPanel({ selectedItems, onRemove, bots }: SelectedPanelProps) {
  const { t } = useI18n()
  if (selectedItems.length === 0) {
    return (
      <Empty
        illustration={false}
        description={t("base.forwardModal.noneSelected")}
        className="wk-fm-empty wk-fm-empty--right"
      />
    )
  }
  return (
    <>
      <div className="wk-fm-selected-title">
        {t("base.forwardModal.selectedCount", { values: { count: selectedItems.length } })}
      </div>
      <div className="wk-fm-selected-list">
        {selectedItems.map((item) => (
          <SelectedRow
            key={item.channelID}
            item={item}
            onRemove={onRemove}
            bots={selectedBotsForPerson(item, bots)}
          />
        ))}
      </div>
    </>
  )
}
