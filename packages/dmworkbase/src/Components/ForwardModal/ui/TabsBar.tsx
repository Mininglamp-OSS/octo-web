import React from "react"
import { Tabs } from "@octo/ui"
import { useI18n } from "../../../i18n"
import type { ChatSelectorTab } from "../../ChatSelector/tabFilter"

const tabs: ReadonlyArray<{
  key: ChatSelectorTab
  labelKey: string
}> = [
  { key: "followed", labelKey: "base.forwardModal.tabFollowed" },
  { key: "recent", labelKey: "base.forwardModal.tabRecent" },
  { key: "group", labelKey: "base.forwardModal.tabAllGroups" },
  { key: "direct", labelKey: "base.forwardModal.tabAllDirects" },
]

/** 四 Tab：关注 / 最近 / 全部群聊 / 全部私聊（对齐智能纪要选择器）。 */
export interface TabsBarProps {
  activeTab: ChatSelectorTab
  onTabChange: (tab: ChatSelectorTab) => void
}

export function TabsBar({ activeTab, onTabChange }: TabsBarProps) {
  const { t } = useI18n()

  return (
    <Tabs
      aria-label={t("base.forwardModal.title")}
      activeKey={activeTab}
      items={tabs.map(({ key, labelKey }) => ({ key, label: t(labelKey) }))}
      onChange={(key) => {
        const tab = tabs.find((item) => item.key === key)
        if (tab) onTabChange(tab.key)
      }}
      size="md"
      variant="line"
      className="wk-fm-tabs"
    />
  )
}
