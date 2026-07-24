import React from "react"
import { Tabs, TabPane } from "@douyinfe/semi-ui"
import { useI18n } from "../../../i18n"
import type { ChatSelectorTab } from "../../ChatSelector/tabFilter"

/** 四 Tab：关注 / 最近 / 全部群聊 / 全部私聊（对齐智能纪要选择器）。 */
export interface TabsBarProps {
  activeTab: ChatSelectorTab
  onTabChange: (tab: ChatSelectorTab) => void
}

export function TabsBar({ activeTab, onTabChange }: TabsBarProps) {
  const { t } = useI18n()
  return (
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
  )
}
