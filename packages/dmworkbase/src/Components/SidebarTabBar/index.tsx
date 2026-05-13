import React from "react"
import "./index.css"

export type SidebarTab = 'follow' | 'recent'

export interface SidebarTabBarProps {
    activeTab: SidebarTab
    followUnread: number
    recentUnread: number
    onTabChange: (tab: SidebarTab) => void
}

const SidebarTabBar: React.FC<SidebarTabBarProps> = ({
    activeTab,
    followUnread,
    recentUnread,
    onTabChange,
}) => {
    return (
        <div className="wk-sidebar-tabbar">
            <div className="wk-sidebar-tabbar__container">
                <button
                    className={`wk-sidebar-tabbar__btn ${activeTab === 'follow' ? 'wk-sidebar-tabbar__btn--active' : ''}`}
                    onClick={() => onTabChange('follow')}
                >
                    <span className="wk-sidebar-tabbar__label">关注</span>
                    {followUnread > 0 && (
                        <span className="wk-sidebar-tabbar__badge">
                            {followUnread > 99 ? '99+' : followUnread}
                        </span>
                    )}
                </button>
                <button
                    className={`wk-sidebar-tabbar__btn ${activeTab === 'recent' ? 'wk-sidebar-tabbar__btn--active' : ''}`}
                    onClick={() => onTabChange('recent')}
                >
                    <span className="wk-sidebar-tabbar__label">最近</span>
                    {recentUnread > 0 && (
                        <span className="wk-sidebar-tabbar__badge">
                            {recentUnread > 99 ? '99+' : recentUnread}
                        </span>
                    )}
                </button>
            </div>
        </div>
    )
}

export default SidebarTabBar
