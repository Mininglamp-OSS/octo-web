import React, { Component } from "react";
import { Space } from "wukongimjssdk";
import SpaceItem from "../SpaceItem";
import ActionListItem from "../ActionListItem";
import { I18nContext } from "../../i18n";
import WKApp from "../../App";

function IconBuilding() {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M18.0316 13.1094H16.846V9.81999C16.846 9.76332 16.8342 9.70723 16.8111 9.65497C16.7881 9.60272 16.7544 9.55537 16.7119 9.51567C16.6695 9.47598 16.6191 9.44475 16.5639 9.4238C16.5086 9.40285 16.4495 9.39261 16.39 9.39367H10.4668V6.89179H13.644C13.9006 6.89392 14.1477 6.79894 14.3308 6.62771C14.514 6.45648 14.6183 6.22301 14.6208 5.97858V2.91437C14.622 2.41148 14.1828 2.00003 13.6452 2.00003H6.36919C6.11256 1.9982 5.86567 2.09347 5.68274 2.26491C5.49981 2.43636 5.39581 2.66995 5.3936 2.91437V5.97744C5.3936 6.48147 5.8316 6.89179 6.3704 6.89179H9.55599V9.39482H3.616C3.55652 9.39375 3.49741 9.40399 3.44213 9.42494C3.38685 9.44589 3.33651 9.47712 3.29405 9.51682C3.2516 9.55651 3.21787 9.60387 3.19486 9.65612C3.17184 9.70837 3.15999 9.76447 3.16 9.82113V13.1094H1.9756C1.71897 13.1075 1.47207 13.2028 1.28914 13.3742C1.10621 13.5457 1.00222 13.7793 1 14.0237V17.0868C1 17.5897 1.438 18 1.9756 18H5.2516C5.50823 18.0018 5.75513 17.9065 5.93805 17.7351C6.12098 17.5636 6.22498 17.3301 6.2272 17.0856V14.0237C6.2272 13.5197 5.7892 13.1094 5.2516 13.1094H4.0648V10.2486H9.54879L9.55719 13.1082H8.362C8.10536 13.1064 7.85847 13.2017 7.67554 13.3731C7.49261 13.5445 7.38861 13.7781 7.3864 14.0226V17.0868C7.3864 17.5897 7.8244 18 8.362 18H11.638C11.8946 18.0018 12.1415 17.9065 12.3244 17.7351C12.5074 17.5636 12.6114 17.3301 12.6136 17.0856V14.0237C12.6136 13.5197 12.1756 13.1094 11.638 13.1094H10.4788L10.4692 10.2497H15.934V13.1094H14.7484C14.4918 13.1075 14.2449 13.2028 14.0619 13.3742C13.879 13.5457 13.775 13.7793 13.7728 14.0237V17.0868C13.7728 17.5897 14.2108 18 14.7484 18H18.0244C18.281 18.0018 18.5279 17.9065 18.7108 17.7351C18.8938 17.5636 18.9978 17.3301 19 17.0856V14.0237C19.0006 13.9029 18.976 13.7831 18.9275 13.6715C18.8791 13.5598 18.8077 13.4585 18.7177 13.3734C18.6277 13.2882 18.5207 13.2211 18.4031 13.1757C18.2855 13.1304 18.1596 13.1078 18.0328 13.1094H18.0316Z" />
        </svg>
    );
}

import { IconCreateSpace, IconJoinSpace, IconChevronRight } from "./icons";

export interface NavSpaceSwitcherProps {
    spaces: Space[];
    currentSpaceId?: string;
    onSpaceSelect: (spaceId: string) => void;
    onJoinSpace?: () => void;
    onCreateSpace?: () => void;
}

interface NavSpaceSwitcherState {
    open: boolean;
}




export default class NavSpaceSwitcher extends Component<NavSpaceSwitcherProps, NavSpaceSwitcherState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;
    private unsubscribeRemoteConfig?: () => void;

    constructor(props: NavSpaceSwitcherProps) {
        super(props);
        this.state = { open: false };
    }

    componentDidMount() {
        document.addEventListener("keydown", this.handleKeyDown);
        this.unsubscribeRemoteConfig = WKApp.remoteConfig.addConfigChangeListener(() => {
            this.forceUpdate();
        });
    }

    componentWillUnmount() {
        document.removeEventListener("keydown", this.handleKeyDown);
        this.unsubscribeRemoteConfig?.();
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && this.state.open) {
            this.handleClose();
        }
    };

    private handleToggle = () => {
        this.setState(prev => ({ open: !prev.open }));
    };

    private handleClose = () => {
        this.setState({ open: false });
    };

    render() {
        const { spaces, currentSpaceId, onSpaceSelect, onJoinSpace, onCreateSpace } = this.props;
        const { open } = this.state;
        const { t } = this.context;
        const current = spaces.find(s => s.space_id === currentSpaceId);
        const canCreateSpace = !!onCreateSpace && !WKApp.remoteConfig.disableUserCreateSpace;

        return (
            <div className="wk-navrail__switcher">
                <button
                    type="button"
                    className="wk-navrail__space-icon-btn"
                    title={current?.name ?? t("base.navRail.spaceSwitcher.switch")}
                    aria-label={t("base.navRail.spaceSwitcher.switch")}
                    onClick={this.handleToggle}
                >
                    <IconBuilding />
                </button>

                {open && (
                    <>
                        {/* 点击外部关闭 */}
                        <div
                            className="wk-navrail__dropdown-mask"
                            onClick={this.handleClose}
                        />
                        <div className="wk-navrail__dropdown" onClick={e => e.stopPropagation()}>
                            {/* 弹窗标题 */}
                            <div className="wk-navrail__dropdown-title">{t("base.navRail.spaceSwitcher.joinedSpaces")}</div>
                            {/* 可滚动的 Space 列表 */}
                            <div className="wk-navrail__dropdown-spaces">
                                {spaces.map(space => (
                                    <SpaceItem
                                        key={space.space_id}
                                        name={space.name}
                                        logo={space.logo}
                                        avatarSize="switcher"
                                        meta={space.max_users > 0
                                            ? t("base.navRail.spaceSwitcher.memberCountWithLimit", {
                                                values: { count: space.member_count, max: space.max_users },
                                            })
                                            : t("base.navRail.spaceSwitcher.memberCount", {
                                                values: { count: space.member_count },
                                            })}
                                        selected={space.space_id === currentSpaceId}
                                        onClick={() => {
                                            onSpaceSelect(space.space_id);
                                            this.handleClose();
                                        }}
                                    />
                                ))}
                            </div>
                            {/* 固定底部操作区 */}
                            {(onJoinSpace || canCreateSpace) && (
                                <>
                                    <div className="wk-navrail__dropdown-divider" />
                                    <div className="wk-navrail__dropdown-actions">
                                        {onJoinSpace && (
                                            <ActionListItem
                                                icon={<IconJoinSpace />}
                                                label={t("base.navRail.spaceSwitcher.joinNewSpace")}
                                                compact
                                                trailing={<IconChevronRight />}
                                                onClick={() => { this.handleClose(); onJoinSpace(); }}
                                            />
                                        )}
                                        {canCreateSpace && (
                                            <ActionListItem
                                                icon={<IconCreateSpace />}
                                                label={t("base.spaceList.createSpace")}
                                                compact
                                                trailing={<IconChevronRight />}
                                                onClick={() => { this.handleClose(); onCreateSpace?.(); }}
                                            />
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </>
                )}
            </div>
        );
    }
}
