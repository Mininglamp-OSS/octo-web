import React from "react"
import { useI18n } from "../../../i18n"

/** 底部按钮区：取消（可选）+ 确认（有选中时显示计数）。 */
export interface FooterProps {
  selectedCount: number
  onConfirm: () => void
  onCancel?: () => void
}

export function Footer({ selectedCount, onConfirm, onCancel }: FooterProps) {
  const { t } = useI18n()
  return (
    <div className="wk-fm-footer">
      {onCancel && (
        <button className="wk-fm-btn wk-fm-btn--cancel" onClick={onCancel}>
          {t("base.common.cancel")}
        </button>
      )}
      <button
        className="wk-fm-btn wk-fm-btn--confirm"
        onClick={onConfirm}
        disabled={selectedCount === 0}
      >
        {selectedCount > 0
          ? t("base.forwardModal.confirmWithCount", { values: { count: selectedCount } })
          : t("base.forwardModal.confirm")}
      </button>
    </div>
  )
}
