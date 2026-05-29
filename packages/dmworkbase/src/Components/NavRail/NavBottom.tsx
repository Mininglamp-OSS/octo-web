import React, { Component } from "react";
import { Space } from "wukongimjssdk";
import NavSpaceSwitcher from "./NavSpaceSwitcher";
import NavLanguageSwitcher from "./NavLanguageSwitcher";
import { t } from "../../i18n";

export interface NavBottomProps {
    settingSelected?: boolean;
    onSettingsClick?: () => void;
    /** 外部通知有新版本，触发气泡首次弹出 */
    hasNewVersion?: boolean;
    /** 用户关闭气泡时通知外层（可用于清除 vm.hasNewVersion） */
    onDismissNewVersion?: () => void;
    // Space switcher
    spaces: Space[];
    currentSpaceId?: string;
    onSpaceSelect: (spaceId: string) => void;
    onJoinSpace?: () => void;
    onCreateSpace?: () => void;
}

interface NavBottomState {
    bubbleVisible: boolean;
}

function IconSettings() {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.6853 11.7271C16.7064 10.0914 17.2951 7.99518 19 7.04273L17.1665 3.979C16.6427 4.27526 16.0336 4.44514 15.3837 4.44514C13.4243 4.44514 11.8359 2.90273 11.8359 1H8.16886C8.17371 1.58729 8.02175 2.18269 7.69589 2.72709C6.71699 4.36284 4.54085 4.91911 2.83345 3.97088L1 7.03461C1.52786 7.32415 1.98483 7.74807 2.30982 8.29106C3.28715 9.9242 2.70179 12.0162 1.00324 12.9708L2.83673 16.0345C3.35876 15.741 3.96489 15.573 4.61144 15.573C6.56463 15.573 8.14889 17.1057 8.15902 19H11.826C11.8245 18.4186 11.9768 17.8298 12.2992 17.2911C13.2764 15.658 15.4473 15.101 17.1534 16.0428L18.9869 12.9791C18.4625 12.6897 18.0086 12.2673 17.6853 11.7271ZM9.99998 13.6445C7.91355 13.6445 6.22215 12.0129 6.22215 10C6.22215 7.98716 7.91352 6.35546 9.99998 6.35546C12.0864 6.35546 13.7777 7.98716 13.7777 10C13.7777 12.0129 12.0864 13.6445 9.99998 13.6445Z" />
        </svg>
    );
}

export default class NavBottom extends Component<NavBottomProps, NavBottomState> {
    state: NavBottomState = {
        bubbleVisible: false,
    };

    componentDidUpdate(prevProps: NavBottomProps) {
        // 外部第一次通知有新版本时弹出气泡
        if (this.props.hasNewVersion && !prevProps.hasNewVersion) {
            this.setState({ bubbleVisible: true });
        }
    }

    render() {
        const { onSettingsClick, hasNewVersion, onDismissNewVersion, spaces, currentSpaceId, onSpaceSelect, onJoinSpace, onCreateSpace } = this.props;
        const { bubbleVisible } = this.state;

        return (
            <div className="wk-navrail__bottom">
                {/* 设置上方分割线 */}
                <div className="wk-navrail__sep" />

                <NavLanguageSwitcher />

                {/* 设置按钮 + 气泡 */}
                <div className="wk-navrail__settings-wrap">
                    <button
                        type="button"
                        className="wk-navrail__item"
                        title={t("base.navRail.settings")}
                        aria-label={t("base.navRail.settings")}
                        onClick={onSettingsClick}
                    >
                        <IconSettings />
                    </button>

                    {/* 版本更新气泡 */}
                    {hasNewVersion && bubbleVisible && (
                        <div className="wk-navrail__version-bubble">
                            <span className="wk-navrail__version-bubble-text">
                                {t("base.navRail.versionBubble.text")}
                            </span>
                            <button
                                className="wk-navrail__version-bubble-refresh"
                                onClick={() => {
                                    const key = 'wk_version_reload_count';
                                    const count = Number(sessionStorage.getItem(key) || 0);
                                    if (count < 3) {
                                        sessionStorage.setItem(key, String(count + 1));
                                        window.location.reload();
                                    } else {
                                        alert(t("base.navRail.versionBubble.reloadLimit"));
                                    }
                                }}
                            >
                                {t("base.navRail.versionBubble.refresh")}
                            </button>
                            <button
                                className="wk-navrail__version-bubble-close"
                                aria-label={t("base.navRail.versionBubble.close")}
                                onClick={() => {
                                    this.setState({ bubbleVisible: false });
                                    onDismissNewVersion?.();
                                }}
                            >
                                ×
                            </button>
                            <span className="wk-navrail__version-bubble-arrow" />
                        </div>
                    )}
                </div>

                {/* Space 切换器（底部，向上弹出） */}
                <NavSpaceSwitcher
                    spaces={spaces}
                    currentSpaceId={currentSpaceId}
                    onSpaceSelect={onSpaceSelect}
                    onJoinSpace={onJoinSpace}
                    onCreateSpace={onCreateSpace}
                />
            </div>
        );
    }
}
