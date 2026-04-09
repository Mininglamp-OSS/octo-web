import { WKApp, WKLayout, Provider, WKModal } from "@octo/base";
import React, { Component } from "react";
import "./index.css"
import MainVM from "./vm";
import { EmptyStateIllustration } from "./EmptyStateIllustration";
import { Space, SpaceService } from "@octo/base";
import { SpaceCreate, JoinSpaceModalConnected, NavRail, MeInfo } from "@octo/base";
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
    showSpaceCreate: boolean;
    showJoinSpace: boolean;
    showMeInfo: boolean;
}

export class MainPage extends Component<{}, MainPageState> {
    constructor(props: {}) {
        super(props);
        this.state = {
            allSpaces: [],
            showSpaceCreate: false,
            showJoinSpace: false,
            showMeInfo: false,
        };
    }

    componentDidMount() {
        // 注册菜单刷新回调，触发父组件 re-render（原 TabNormalScreen componentDidMount 里的逻辑）
        WKApp.menus.setRefresh = () => { this.forceUpdate(); };

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
        }).catch((e) => { console.error('[NavRail] Failed to load spaces:', e); });
    }

    componentWillUnmount() {
        // 清理菜单刷新回调，避免组件卸载后触发 forceUpdate
        WKApp.menus.setRefresh = undefined;
    }

    handleSpaceSelected = (spaceId: string) => {
        SpaceService.shared.getMySpaces().then(spaces => {
            this.setState({ allSpaces: spaces, showSpaceCreate: false, showJoinSpace: false });
            WKApp.shared.currentSpaceId = spaceId;
            localStorage.setItem("currentSpaceId", spaceId);
            const target = spaces.find(s => s.space_id === spaceId);
            if (target) WKApp.mittBus.emit("space-changed", target);
            WKApp.shared.notifyListener();
        }).catch(() => {
            Toast.error("刷新 Space 列表失败，请手动刷新");
        });
    };

    handleCopyInviteLink = async (spaceId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const detail = await WKApp.apiClient.get(`/space/${spaceId}`);
            if (!detail.invite_code) { Toast.warning("该 Space 暂无邀请码"); return; }
            const link = `${window.location.origin}${window.location.pathname}?invite=${detail.invite_code}`;
            let copied = false;
            try {
                await navigator.clipboard.writeText(link);
                copied = true;
            } catch {
                const textarea = document.createElement("textarea");
                textarea.value = link;
                textarea.style.cssText = "position:fixed;opacity:0";
                document.body.appendChild(textarea);
                textarea.select();
                copied = document.execCommand("copy");
                document.body.removeChild(textarea);
            }
            copied ? Toast.success("邀请链接已复制") : Toast.error("复制失败，请手动复制");
        } catch {
            Toast.error("获取邀请码失败");
        }
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

    render() {
        const { allSpaces, showSpaceCreate, showJoinSpace, showMeInfo } = this.state;

        return (
            <Provider create={() => new MainVM()} render={(vm: MainVM) => {
                const currentSpaceId = WKApp.shared.currentSpaceId;

                return (
                    <>
                        <WKLayout
                            onRenderTab={() => (
                                <NavRail
                                    // Space
                                    spaces={allSpaces}
                                    currentSpaceId={currentSpaceId}
                                    onSpaceSelect={this.handleSpaceSelected}
                                    onCopyInviteLink={this.handleCopyInviteLink}
                                    onJoinSpace={() => this.setState({ showJoinSpace: true })}
                                    onCreateSpace={() => this.setState({ showSpaceCreate: true })}
                                    // 菜单
                                    menusList={vm.menusList}
                                    currentMenus={vm.currentMenus}
                                    onMenuClick={(menus) => {
                                        vm.currentMenus = menus;
                                        if (menus.onPress) {
                                            menus.onPress();
                                        } else {
                                            WKApp.routeLeft.popToRoot();
                                        }
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
                                    onSetShowNewVersion={(v) => { vm.showNewVersion = v; }}
                                    onSetShowAppVersion={(v) => { vm.showAppVersion = v; vm.notifyListener(); }}
                                    onInstallUpdate={() => vm.installUpdate()}
                                    onNotifyListener={() => vm.notifyListener()}
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

                        <SpaceCreate
                            visible={showSpaceCreate}
                            onClose={() => this.setState({ showSpaceCreate: false })}
                            onSuccess={this.handleSpaceSelected}
                        />
                        <JoinSpaceModalConnected
                            visible={showJoinSpace}
                            onClose={() => this.setState({ showJoinSpace: false })}
                            onSuccess={this.handleSpaceSelected}
                        />
                    </>
                );
            }}>
            </Provider>
        );
    }
}
