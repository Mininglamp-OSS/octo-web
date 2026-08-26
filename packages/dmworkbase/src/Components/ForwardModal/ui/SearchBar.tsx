import React, { useCallback } from "react"
import { IconSearchStroked } from "@douyinfe/semi-icons"
import { useI18n } from "../../../i18n"

/** 顶部搜索输入：受控 value + change 回调。 */
export interface SearchBarProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
}

export function SearchBar({ value, onChange, placeholder }: SearchBarProps) {
  const { t } = useI18n()
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value)
    },
    [onChange],
  )
  return (
    <div className="wk-fm-search">
      <IconSearchStroked className="wk-fm-search-icon" />
      <input
        className="wk-fm-search-input"
        placeholder={placeholder ?? t("base.forwardModal.searchPlaceholder")}
        type="text"
        value={value}
        onChange={handleInputChange}
      />
    </div>
  )
}
