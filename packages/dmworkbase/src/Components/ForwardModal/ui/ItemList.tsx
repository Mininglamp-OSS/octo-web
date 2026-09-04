import React from "react"
import VisibilityTrigger from "../../VisibilityTrigger"
import { useI18n } from "../../../i18n"
import { Empty, Loading } from "@octo/ui"
import type { ForwardItem } from "../ForwardModal"
import { ItemRow, type ForwardBotPreview } from "./ItemRow"

/**
 * 可选列表。loading / 空态 / 正常渲染三态，正常渲染时逐项包 VisibilityTrigger 触发懒加载。
 *
 * `flat` 控制平铺/树形样式（最近 Tab 为平铺）。`onItemVisible` 为空时不裹 VisibilityTrigger，
 * 走静态列表分支（供不需要 channelInfo 懒加载的场景使用，如 Storybook）。
 */
export interface ItemListProps {
  items: ForwardItem[]
  selectedSet: ReadonlySet<string>
  loading: boolean
  flat: boolean
  showMeta: boolean
  onToggleSelect: (item: ForwardItem) => void
  onItemVisible?: (item: ForwardItem) => void
  /** Person-row Bot preview (UX #4). Absent → no expander. */
  botPreview?: ForwardBotPreview
}

export function ItemList({
  items,
  selectedSet,
  loading,
  flat,
  showMeta,
  onToggleSelect,
  onItemVisible,
  botPreview,
}: ItemListProps) {
  const { t } = useI18n()
  return (
    <div className="wk-fm-list">
      {loading ? (
        <div className="wk-fm-empty"><Loading text={t("base.forwardModal.loading")} /></div>
      ) : items.length === 0 ? (
        <Empty
          illustration={false}
          description={t("base.forwardModal.noContacts")}
          className="wk-fm-empty"
        />
      ) : (
        items.map((item) => {
          const row = (
            <ItemRow
              item={item}
              selected={selectedSet.has(item.channelID)}
              flat={flat}
              showMeta={showMeta}
              onToggle={onToggleSelect}
              botPreview={botPreview}
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
  )
}
