import { WKApp, WKLayout, Provider, WKModal, t } from "@octo/base";
import React, { Component } from "react";
import "./index.css"
import MainVM from "./vm";
import { EmptyStateIllustration } from "./EmptyStateIllustration";
import { Onboarding } from "../../Components/Onboarding";
import {
    defaultOnboardingConfig,
    shouldShowOnboarding,
} from "../../Components/Onboarding/content";
import { Space, SpaceService } from "@octo/base";
import { JoinSpaceModalConnected, NavRail, MeInfo, SpaceCreate } from "@octo/base";
import { consumeJoinSuccessNotice, showJoinSuccessToast } from "@octo/base";
import { Toast } from "@douyinfe/semi-ui";

// ─── MainContentLeft：纯路由渲染区（Sidebar + 内容） ───────────────────────

export interface MainContentLeftProps {
    vm: MainVM
}

export class MainContentLeft extends Component<MainContentLeftProps> {
    render() {
        const { vm } = this.props;
        return (
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {vm.historyRoutePaths.map((routePath, i) => {
                    const Cpt = WKApp.route.get(routePath);
                    return (
                        <div key={i} style={{ display: routePath === vm.currentMenus?.routePath ? "block" : "none", width: "100%", height: "100%" }}>
                            {React.isValidElement(Cpt) ? Cpt : undefined}
                        </div>
                    );
                })}
            </div>
        );
    }
}

// ─── MainPage：顶层，管理 Space/MeInfo/NavRail 状态 ───────────────────────

interface MainPageState {
    allSpaces: Space[];
    showJoinSpace: boolean;
    showCreateSpace: boolean;
    showMeInfo: boolean;
    showOnboardingGate: boolean;
    forceOnboardingVisible: boolean;
    skipOnboardingIntro: boolean;
}

function shouldGateMainOnboarding() {
    if (typeof window === "undefined") return false;

    try {
        return shouldShowOnboarding(
            defaultOnboardingConfig,
            window.localStorage
        );
    } catch {
        return false;
    }
}

export class MainPage extends Component<{}, MainPageState> {
    constructor(props: {}) {
        super(props);
        this.state = {
            allSpaces: [],
            showJoinSpace: false,
            showCreateSpace: false,
            showMeInfo: false,
            showOnboardingGate: shouldGateMainOnboarding(),
            forceOnboardingVisible: false,
            skipOnboardingIntro: false,
        };
    }

    private unsubscribeRemoteConfig?: () => void;

    componentDidMount() {
        // 注册菜单刷新回调，触发父组件 re-render（原 TabNormalScreen componentDidMount 里的逻辑）
        WKApp.menus.setRefresh = () => { this.forceUpdate(); };
        this.unsubscribeRemoteConfig = WKApp.remoteConfig.addConfigChangeListener(() => {
            if (WKApp.remoteConfig.disableUserCreateSpace && this.state.showCreateSpace) {
                this.setState({ showCreateSpace: false });
                return;
            }
            this.forceUpdate();
        });

        SpaceService.shared.getMySpaces().then(spaces => {
            this.setState({ allSpaces: spaces });
            const savedSpaceId = localStorage.getItem("currentSpaceId");
            if (savedSpaceId && spaces.find(s => s.space_id === savedSpaceId)) {
                WKApp.shared.currentSpaceId = savedSpaceId;
            } else if (spaces.length > 0) {
                WKApp.shared.currentSpaceId = spaces[0].space_id;
                localStorage.setItem("currentSpaceId", spaces[0].space_id);
                this.forceUpdate();
            } else {
                WKApp.shared.currentSpaceId = '';
                WKApp.shared.spaceChecked = false;
                localStorage.removeItem("currentSpaceId");
                try { WKApp.shared.notifyListener(); } catch (_) {}
            }
            // dmwork-web#1065: InviteLanding 走 window.location.href 跳转后，
            // Toast 无法跨 full-reload 存活。我们用 sessionStorage 把 notice 带过来，
            // 在主界面挂载、Space 列表就绪之后再弹出。放在 .then() 内确保 spaces 已加载，
            // 切换按钮按下时用户 Space 信息可用。
            this.showPostJoinToastIfPending();
        }).catch((e) => { console.error('[NavRail] Failed to load spaces:', e); });
    }

    componentWillUnmount() {
        // 清理菜单刷新回调，避免组件卸载后触发 forceUpdate
        WKApp.menus.setRefresh = undefined;
        this.unsubscribeRemoteConfig?.();
    }

    /**
     * dmwork-web#1065 — 消费 InviteLanding 留下的 postJoinNotice
     * - 跨 Space：双行 toast + 「切换过去」按钮；onSwitch 里调 handleSpaceSelected
     * - 同 Space / 单 Space：常规单行 toast
     * dmwork-web#1100 — notice.kind='group'（来自 dmworkim H5
     * join_group.html scanjoin 成功分支）透传给 Toast，走「已加入「群聊」/
     * 位于「Space」」双行分支，切换按钮复用 handleSpaceSelected。
     * 只执行一次（consumeJoinSuccessNotice 读取后即清）。
     */
    private showPostJoinToastIfPending() {
        const notice = consumeJoinSuccessNotice();
        if (!notice || !notice.spaceId) return;
        showJoinSuccessToast({
            // group 场景下优先取 groupName，否则退回 entityName / spaceName。
            entityName:
                (notice.kind === "group" && notice.groupName) ||
                notice.entityName ||
                notice.spaceName ||
                "",
            spaceName: notice.spaceName || "",
            crossSpace: !!notice.crossSpace,
            kind: notice.kind,
            onSwitch: () => {
                // 显式切换到归属 Space —— 走与 NavRail 点击相同的路径，
                // 保证 mittBus('space-changed') + notifyListener 一致。
                // group 场景复用同一路径：切 Space 后群自然出现在列表。
                this.handleSpaceSelected(notice.spaceId);
            },
        });
    }

    handleSpaceSelected = (spaceId: string) => {
        // 同步更新 currentSpaceId 与持久化，并立刻 emit space-changed，
        // 避免随后用户立即触发的"合并转发"等动作读到旧的 spaceId
        // （此前这些更新都放在 getMySpaces().then 内，存在网络 race）。
        WKApp.shared.currentSpaceId = spaceId;
        localStorage.setItem("currentSpaceId", spaceId);
        const existing = this.state.allSpaces.find(s => s.space_id === spaceId);
        if (existing) {
            WKApp.mittBus.emit("space-changed", existing);
        }
        WKApp.shared.notifyListener();

        // 后台刷新 Space 列表（用户可能新加入/离开 Space），完成后再补一次
        // 事件给那些以 Space 对象为入参的监听者（首次拿不到 existing 的情况）。
        SpaceService.shared.getMySpaces().then(spaces => {
            this.setState({ allSpaces: spaces, showJoinSpace: false });
            if (!existing) {
                const target = spaces.find(s => s.space_id === spaceId);
                if (target) WKApp.mittBus.emit("space-changed", target);
            }
        }).catch(() => {
            Toast.error(t("app.main.spaceListRefreshFailed"));
        });
    };

    handleAvatarClick = () => {
        const uid = WKApp.loginInfo.uid;
        WKApp.apiClient
            .get(`/users/${uid}`)
            .then((data) => {
                const loginInfo = WKApp.loginInfo;
                loginInfo.shortNo = data.short_no;
                loginInfo.name = data.name;
                loginInfo.sex = data.sex;
                loginInfo.save();
                this.setState({ showMeInfo: true });
            })
            .catch(() => {
                this.setState({ showMeInfo: true });
            });
    };

    handleOnboardingDismissed = () => {
        if (!this.state.showOnboardingGate) return;

        this.setState({
            showOnboardingGate: false,
            forceOnboardingVisible: false,
            skipOnboardingIntro: false,
        });
    };

    handleOpenOnboarding = () => {
        this.setState({
            showOnboardingGate: true,
            forceOnboardingVisible: true,
            skipOnboardingIntro: true,
        });
    };

    render() {
        const {
            allSpaces,
            showJoinSpace,
            showCreateSpace,
            showMeInfo,
            showOnboardingGate,
            forceOnboardingVisible,
            skipOnboardingIntro,
        } = this.state;
        // 客户端 UI 可见性控制：仅在用户拥有任一 Space 的 owner/admin 角色时显示入口；
        // 真正的接口鉴权由 admin SPA 后端负责。allSpaces 来自登录后刷新，角色变更需重新加载。
        const canManageSpace = allSpaces.some(s => s.role === 1 || s.role === 2);

        return (
            <Provider create={() => new MainVM()} render={(vm: MainVM) => {
                const currentSpaceId = WKApp.shared.currentSpaceId;

                return (
                    <>
                        <div
                            className="wk-main-onboarding-background"
                            aria-hidden={showOnboardingGate ? true : undefined}
                            {...(showOnboardingGate ? { inert: "" } : {})}
                        >
                            <WKLayout
                                onRenderTab={() => (
                                    <NavRail
                                        // Space
                                        spaces={allSpaces}
                                        currentSpaceId={currentSpaceId}
                                        onSpaceSelect={this.handleSpaceSelected}
                                        onJoinSpace={() => this.setState({ showJoinSpace: true })}
                                        onCreateSpace={() => this.setState({ showCreateSpace: true })}
                                        canManageSpace={canManageSpace}
                                        // 菜单
                                        menusList={vm.menusList}
                                        currentMenus={vm.currentMenus}
                                        onMenuClick={(menus) => {
                                            const prevMenuId = vm.currentMenus?.id;
                                            vm.currentMenus = menus;
                                            WKApp.currentMenuId = menus.id;
                                            if (menus.onPress) {
                                                menus.onPress();
                                            } else {
                                                WKApp.routeLeft.popToRoot();
                                                const stayInChat = prevMenuId === "chat" && menus.id === "chat";
                                                if (!stayInChat) {
                                                    WKApp.routeRight.popToRoot();
                                                }
                                            }
                                            // MainContentLeft 把已访问路由都挂在 DOM 里 (靠 display
                                            // 切换可见性), 所以切回某个菜单时组件不会重新 mount。
                                            // 发 mitt 事件通知依赖数据新鲜度的页面主动 reload。
                                            WKApp.mittBus.emit("wk:nav-menu-activated", { menuId: menus.id });
                                        }}
                                        // 用户
                                        onAvatarClick={this.handleAvatarClick}
                                        isOnline={navigator.onLine}
                                        // 设置
                                        settingSelected={vm.settingSelected}
                                        hasNewVersion={vm.hasNewVersion}
                                        showNewVersion={vm.showNewVersion}
                                        showAppVersion={vm.showAppVersion}
                                        showAppUpdate={vm.showAppUpdate}
                                        appUpdateProgress={vm.appUpdateProgress}
                                        showAppUpdateOperation={vm.showAppUpdateOperation}
                                        lastVersionInfo={vm.lastVersionInfo}
                                        onToggleSetting={() => { vm.settingSelected = !vm.settingSelected; }}
                                        onSetShowNewVersion={(v) => {
                                            vm.showNewVersion = v;
                                            if (!v) { vm.markVersionRead(); }
                                            vm.notifyListener();
                                        }}
                                        onSetShowAppVersion={(v) => {
                                            vm.showAppVersion = v;
                                            if (!v) { vm.markVersionRead(); }
                                            vm.notifyListener();
                                        }}
                                        onInstallUpdate={() => vm.installUpdate()}
                                        onNotifyListener={() => vm.notifyListener()}
                                        onOpenOnboarding={this.handleOpenOnboarding}
                                        onDismissNewVersion={() => { vm.markVersionRead(); }}
                                    />
                                )}
                                contentLeft={<MainContentLeft vm={vm} />}
                                onRightContext={(context) => {
                                    WKApp.routeRight.setPush = (view) => { context.push(view); };
                                    WKApp.routeRight.setReplaceToRoot = (view) => { context.replaceToRoot(view); };
                                    WKApp.routeRight.setPop = () => { context.pop(); };
                                    WKApp.routeRight.setPopToRoot = () => { context.popToRoot(); };
                                }}
                                onLeftContext={(context) => {
                                    WKApp.routeLeft.setPush = (view) => { context.push(view); };
                                    WKApp.routeLeft.setReplaceToRoot = (view) => { context.replaceToRoot(view); };
                                    WKApp.routeLeft.setPop = () => { context.pop(); };
                                    WKApp.routeLeft.setPopToRoot = () => { context.popToRoot(); };
                                    // Bind menu switch callback for showConversation
                                    WKApp.switchToMenuById = (menuId: string) => {
                                        const target = vm.menusList.find((m: any) => m.id === menuId);
                                        if (target && vm.currentMenus?.id !== menuId) {
                                            vm.currentMenus = target;
                                            WKApp.currentMenuId = menuId;
                                            // NOTE: do NOT popToRoot() here. routeLeft is a shared
                                            // stack across tabs; popping it would destroy the detail
                                            // view (e.g. summary detail page) the user was on,
                                            // breaking rendering when they later switch back.
                                        }
                                    };
                                    // Keep currentMenuId in sync with initial / user-driven menu changes
                                    if (vm.currentMenus?.id && WKApp.currentMenuId !== vm.currentMenus.id) {
                                        WKApp.currentMenuId = vm.currentMenus.id;
                                    }
                                }}
                                contentRight={<EmptyStateIllustration />}
                            />

                            {/* MeInfo Modal */}
                            <WKModal
                                className="wk-main-sider-modal wk-main-sider-meinfo"
                                visible={showMeInfo}
                                options={{ mask: false, closable: false }}
                                onCancel={() => this.setState({ showMeInfo: false })}
                            >
                                <MeInfo onClose={() => this.setState({ showMeInfo: false })} />
                            </WKModal>

                            <JoinSpaceModalConnected
                                visible={showJoinSpace}
                                onClose={() => this.setState({ showJoinSpace: false })}
                                onSuccess={this.handleSpaceSelected}
                            />
                            <SpaceCreate
                                visible={!WKApp.remoteConfig.disableUserCreateSpace && showCreateSpace}
                                onClose={() => this.setState({ showCreateSpace: false })}
                                onSuccess={this.handleSpaceSelected}
                            />
                        </div>
                        {showOnboardingGate ? (
                            <Onboarding
                                forceVisible={forceOnboardingVisible}
                                skipIntro={skipOnboardingIntro}
                                onDismiss={this.handleOnboardingDismissed}
                            />
                        ) : null}
                    </>
                );
            }}>
            </Provider>
        );
    }
}
