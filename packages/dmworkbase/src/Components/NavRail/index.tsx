import React, { Component } from "react";
import { Space } from "wukongimjssdk";
import WKApp from "../../App";
import { Menus } from "../../Service/Menus";
import NavSpaceSwitcher from "./NavSpaceSwitcher";

import NavItem from "./NavItem";
import NavBottom from "./NavBottom";
import NavSettingsPanel from "./NavSettingsPanel";
import { t } from "../../i18n";
import "./index.css";

export type NavRailItem = "messages";

export interface NavRailVMProps {
    menusList: Menus[];
    currentMenus?: Menus;
    settingSelected: boolean;
    hasNewVersion: boolean;
    showNewVersion: boolean;
    showAppVersion: boolean;
    showAppUpdate: boolean;
    appUpdateProgress: number;
    showAppUpdateOperation: boolean;
    lastVersionInfo?: { appVersion: string; updateDesc: string };
    onMenuClick: (menus: Menus) => void;
    onToggleSetting: () => void;
    onSetShowNewVersion: (v: boolean) => void;
    onSetShowAppVersion: (v: boolean) => void;
    onInstallUpdate: () => void;
    onNotifyListener: () => void;
    onAvatarClick: () => void;

    /** 用户在线状态，true 时显示绿色状态点 */
    isOnline?: boolean;
    // Space 相关
    spaces: Space[];
    currentSpaceId?: string;
    onSpaceSelect: (spaceId: string) => void;
    onJoinSpace?: () => void;
    onCreateSpace?: () => void;
    /** 是否在设置菜单中显示「空间管理」入口（仅 owner/admin 可见） */
    canManageSpace?: boolean;
    /** 用户关闭版本更新气泡时的回调 */
    onDismissNewVersion?: () => void;
}

export interface NavRailProps extends NavRailVMProps {}

export default class NavRail extends Component<NavRailProps> {
    render() {
        const {
            menusList,
            currentMenus,
            settingSelected,
            hasNewVersion,
            showNewVersion,
            showAppVersion,
            showAppUpdate,
            appUpdateProgress,
            showAppUpdateOperation,
            lastVersionInfo,
            onMenuClick,
            onToggleSetting,
            onSetShowNewVersion,
            onSetShowAppVersion,
            onInstallUpdate,
            onNotifyListener,
            onAvatarClick,
            onDismissNewVersion,
            isOnline = false,
            spaces,
            currentSpaceId,
            onSpaceSelect,
            onJoinSpace,
            onCreateSpace,
            canManageSpace = false,
        } = this.props;

        return (
            <>
                <nav className="wk-navrail" aria-label={t("base.navRail.ariaLabel")}>
                    {/* 顶部：用户头像（含在线状态点） */}
                    <div className="wk-navrail__top">
                        <div className="wk-navrail__user-wrap">
                            <button
                                type="button"
                                className="wk-navrail__user-avatar"
                                title={t("base.navRail.me")}
                                aria-label={t("base.navRail.me")}
                                onClick={onAvatarClick}
                                style={{
                                    backgroundImage: `url(${WKApp.shared.avatarUser(WKApp.loginInfo.uid || "")})`,
                                }}
                            />
                            {isOnline && <div className="wk-navrail__user-status" />}
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
                                onClick={() => onMenuClick(menus)}
                            />
                        ))}
                    </div>

                    {/* 底部：分割线 + 设置 + Space */}
                    <NavBottom
                        settingSelected={settingSelected}
                        hasNewVersion={hasNewVersion}
                        onSettingsClick={onToggleSetting}
                        onDismissNewVersion={onDismissNewVersion}
                        spaces={spaces}
                        currentSpaceId={currentSpaceId}
                        onSpaceSelect={onSpaceSelect}
                        onJoinSpace={onJoinSpace}
                        onCreateSpace={onCreateSpace}
                    />
                </nav>

                {/* 设置面板 + Modals（挂在 nav 外，避免 overflow 裁剪） */}
                <NavSettingsPanel
                    settingSelected={settingSelected}
                    hasNewVersion={hasNewVersion}
                    canManageSpace={canManageSpace}
                    showNewVersion={showNewVersion}
                    showAppVersion={showAppVersion}
                    showAppUpdate={showAppUpdate}
                    appUpdateProgress={appUpdateProgress}
                    showAppUpdateOperation={showAppUpdateOperation}
                    lastVersionInfo={lastVersionInfo}
                    onToggleSetting={onToggleSetting}
                    onSetShowNewVersion={onSetShowNewVersion}
                    onSetShowAppVersion={onSetShowAppVersion}
                    onInstallUpdate={onInstallUpdate}
                    onNotifyListener={onNotifyListener}
                />


            </>
        );
    }
}

export { NavSpaceSwitcher, NavItem, NavBottom };
export { default as NavLanguageSwitcher } from "./NavLanguageSwitcher";
export type { NavItemProps } from "./NavItem";
export type { NavSpaceSwitcherProps } from "./NavSpaceSwitcher";
export type { NavBottomProps } from "./NavBottom";
