import React from "react"
import { Badge } from "@octo/ui"
import { useI18n } from "../../i18n"
import "./index.css"

export type SidebarTab = 'follow' | 'recent'

export interface SidebarTabBarProps {
    activeTab: SidebarTab
    followUnread: number
    recentUnread: number
    onTabChange: (tab: SidebarTab) => void
    onActiveTabClick?: (tab: SidebarTab) => void
}

const SidebarTabBar: React.FC<SidebarTabBarProps> = ({
    activeTab,
    followUnread,
    recentUnread,
    onTabChange,
    onActiveTabClick,
}) => {
    const { t } = useI18n()
    const handleTabClick = (tab: SidebarTab) => {
        if (activeTab === tab) {
            onActiveTabClick?.(tab)
            return
        }
        onTabChange(tab)
    }

    return (
        <div className="wk-sidebar-tabbar">
            <div className="wk-sidebar-tabbar__container">
                <button
                    className={`wk-sidebar-tabbar__btn ${activeTab === 'follow' ? 'wk-sidebar-tabbar__btn--active' : ''}`}
                    onClick={() => handleTabClick('follow')}
                >
                    <span className="wk-sidebar-tabbar__label">{t("base.sidebarTabBar.follow")}</span>
                    {followUnread > 0 && (
                        <Badge
                            count={followUnread}
                            variant="soft"
                            className="wk-sidebar-tabbar__badge"
                        />
                    )}
                </button>
                <button
                    className={`wk-sidebar-tabbar__btn ${activeTab === 'recent' ? 'wk-sidebar-tabbar__btn--active' : ''}`}
                    onClick={() => handleTabClick('recent')}
                >
                    <span className="wk-sidebar-tabbar__label">{t("base.sidebarTabBar.recent")}</span>
                    {recentUnread > 0 && (
                        <Badge
                            count={recentUnread}
                            variant="soft"
                            className="wk-sidebar-tabbar__badge"
                        />
                    )}
                </button>
            </div>
        </div>
    )
}

export default SidebarTabBar
