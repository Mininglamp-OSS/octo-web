import React, { Component } from "react";
import { Channel, ChannelTypePerson, Space } from "wukongimjssdk";
import WKApp from "../../App";
import { Menus } from "../../Service/Menus";
import NavSpaceSwitcher from "./NavSpaceSwitcher";

import NavItem from "./NavItem";
import NavBottom from "./NavBottom";
import NavSettingsPanel from "./NavSettingsPanel";
import WKAvatar from "../WKAvatar";
import { t } from "../../i18n";
import "./index.css";

export type NavRailItem = "messages";

export interface NavRailVMProps {
    menusList: Menus[];
    currentMenus?: Menus;
    settingSelected: boolean;
    hasNewVersion: boolean;
    showAppVersion: boolean;
    showAppUpdate: boolean;
    appUpdateProgress: number;
    showAppUpdateOperation: boolean;
    appUpdateDownloaded?: boolean;
    lastVersionInfo?: { appVersion: string; updateDesc: string; forceUpdate?: boolean };
    onMenuClick: (menus: Menus) => void;
    onToggleSetting: () => void;
    onSetShowAppVersion: (v: boolean) => void;
    onInstallUpdate: () => void;
    onNotifyListener: () => void;
    onAvatarClick: () => void;
    onOpenOnboarding?: () => void;

    /** 用户在线状态，true 时显示绿色状态点 */
    isOnline?: boolean;
    // Space 相关
    spaces: Space[];
    currentSpaceId?: string;
    onSpaceSelect: (spaceId: string) => void;
    onJoinSpace?: () => void;
    onCreateSpace?: () => void;
    /** 是否显示「Space 管理」入口（仅 owner/admin 可见） */
    canManageSpace?: boolean;
    onSpaceManagement?: () => void;
    /** 用户关闭版本更新气泡时的回调 */
    onDismissNewVersion?: () => void;
}

export interface NavRailProps extends NavRailVMProps {}

export default class NavRail extends Component<NavRailProps> {
    private settingsButtonRef = React.createRef<HTMLButtonElement>();

    render() {
        const {
            menusList,
            currentMenus,
            settingSelected,
            hasNewVersion,
            showAppVersion,
            showAppUpdate,
            appUpdateProgress,
            showAppUpdateOperation,
            appUpdateDownloaded,
            lastVersionInfo,
            onMenuClick,
            onToggleSetting,
            onSetShowAppVersion,
            onInstallUpdate,
            onNotifyListener,
            onAvatarClick,
            onOpenOnboarding,
            onDismissNewVersion,
            isOnline = false,
            spaces,
            currentSpaceId,
            onSpaceSelect,
            onJoinSpace,
            onCreateSpace,
            canManageSpace = false,
            onSpaceManagement,
        } = this.props;
        const userChannel = new Channel(WKApp.loginInfo.uid || "", ChannelTypePerson);
        const userName = WKApp.loginInfo.name || WKApp.loginInfo.uid || t("base.navRail.me");

        return (
            <>
                <nav className="wk-navrail" aria-label={t("base.navRail.ariaLabel")}>
                    {/* 顶部：用户头像（含在线状态点） */}
                    <div className="wk-navrail__top">
                        <div className="wk-navrail__user-wrap">
                            <div className="wk-navrail__user-avatar-wrap">
                                <button
                                    type="button"
                                    className="wk-navrail__user-avatar"
                                    data-testid="nav-user-avatar"
                                    title={t("base.navRail.me")}
                                    aria-label={t("base.navRail.me")}
                                    onClick={onAvatarClick}
                                >
                                    <WKAvatar channel={userChannel} />
                                </button>
                                {isOnline && <div className="wk-navrail__user-status" />}
                            </div>
                            <span className="wk-navrail__user-name">{userName}</span>
                        </div>
                    </div>

                    <div className="wk-navrail__sep" />

                    {/* 中部：动态导航菜单 */}
                    <div className="wk-navrail__items">
                        {(menusList ?? []).map((menus) => (
                            <NavItem
                                key={menus.id}
                                icon={menus.id === currentMenus?.id ? menus.selectedIcon : menus.icon}
                                label={menus.title}
                                active={menus.id === currentMenus?.id}
                                badge={menus.badge && menus.badge > 0 ? menus.badge : undefined}
                                trackObjectId={menus.routePath}
                                onClick={() => onMenuClick(menus)}
                            />
                        ))}
                    </div>

                    {/* 底部：分割线 + 设置 + Space */}
                    <NavBottom
                        settingSelected={settingSelected}
                        settingsButtonRef={this.settingsButtonRef}
                        hasNewVersion={hasNewVersion}
                        onSettingsClick={onToggleSetting}
                        onDismissNewVersion={onDismissNewVersion}
                        spaces={spaces}
                        currentSpaceId={currentSpaceId}
                        onSpaceSelect={onSpaceSelect}
                        onJoinSpace={onJoinSpace}
                        onCreateSpace={onCreateSpace}
                        onSpaceManagement={canManageSpace ? onSpaceManagement : undefined}
                    />
                </nav>

                {/* 设置面板 + Modals（挂在 nav 外，避免 overflow 裁剪） */}
                <NavSettingsPanel
                    settingSelected={settingSelected}
                    showAppVersion={showAppVersion}
                    showAppUpdate={showAppUpdate}
                    appUpdateProgress={appUpdateProgress}
                    showAppUpdateOperation={showAppUpdateOperation}
                    appUpdateDownloaded={appUpdateDownloaded}
                    lastVersionInfo={lastVersionInfo}
                    onToggleSetting={onToggleSetting}
                    onSetShowAppVersion={onSetShowAppVersion}
                    onInstallUpdate={onInstallUpdate}
                    onNotifyListener={onNotifyListener}
                    onOpenOnboarding={onOpenOnboarding}
                />


            </>
        );
    }
}

export { NavSpaceSwitcher, NavItem, NavBottom };
export type { NavItemProps } from "./NavItem";
export type { NavSpaceSwitcherProps } from "./NavSpaceSwitcher";
export type { NavBottomProps } from "./NavBottom";
