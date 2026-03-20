import { WKApp, WKLayout, Provider } from "@octo/base";
import React, { Component } from "react";
import "./index.css"
import MainVM from "./vm";
import { EmptyStateIllustration } from "./EmptyStateIllustration";
import { TabNormalScreen } from "./tab_normal_screen";
import { Space, SpaceService } from "@octo/base";
import { SpaceCreate, ConnectionStatus } from "@octo/base";
import { Toast } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import classNames from "classnames";


export interface MainContentLeftProps {
    vm: MainVM
}

export interface MainContentLeftState {
}
interface MainContentLeftFullState {
    allSpaces: Space[];
    showSpaceDropdown: boolean;
showSpaceCreate: boolean;
}

export class MainContentLeft extends Component<MainContentLeftProps, MainContentLeftFullState>{
    constructor(props: any) {
        super(props)
        this.state = {
            allSpaces: [],
            showSpaceDropdown: false,
            showSpaceCreate: false,
        }
    }

    componentDidMount() {
        SpaceService.shared.getMySpaces().then(spaces => {
            this.setState({ allSpaces: spaces });
            // 恢复上次选中的 Space，或默认第一个
            const savedSpaceId = localStorage.getItem("currentSpaceId")
            if (savedSpaceId && spaces.find(s => s.space_id === savedSpaceId)) {
                WKApp.shared.currentSpaceId = savedSpaceId
            } else if (spaces.length > 0) {
                // savedSpaceId 不在列表中或 currentSpaceId 为空，fallback 到第一个
                WKApp.shared.currentSpaceId = spaces[0].space_id
                localStorage.setItem("currentSpaceId", spaces[0].space_id)
                this.forceUpdate()
            } else {
                // 无 Space：清除状态，回到 SpaceGate 引导页
                WKApp.shared.currentSpaceId = ''
                WKApp.shared.spaceChecked = false
                localStorage.removeItem("currentSpaceId")
                try { WKApp.shared.notifyListener(); } catch (_) {}
            }
        }).catch(() => {});
    }

    render() {
        const { vm } = this.props
        const { allSpaces, showSpaceDropdown } = this.state;
        const currentSpaceId = WKApp.shared.currentSpaceId;
        const currentSpace = allSpaces.find(s => s.space_id === currentSpaceId);
        const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b', '#fa709a'];

        return <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', borderRight: '1px solid var(--wk-border-default)' }}>
            {/* 全局顶栏 */}
            <div className="wk-global-topbar">
                <div className="wk-global-topbar-space" style={{ position: 'relative' }}
                    onClick={() => this.setState(prev => ({ showSpaceDropdown: !prev.showSpaceDropdown }))}>
                    {currentSpace && (
                        <>
                            <span className="wk-global-topbar-space-icon" style={{
                                backgroundColor: colors[currentSpace.name.charCodeAt(0) % colors.length]
                            }}>{currentSpace.name.charAt(0)}</span>
                            <span className="wk-global-topbar-space-name">{currentSpace.name}</span>
                            <span style={{ fontSize: 12, color: '#999', marginLeft: 4 }}>▾</span>
                        </>
                    )}
                    {showSpaceDropdown && (
                        <div className="wk-global-topbar-dropdown" onClick={e => e.stopPropagation()}>
                            {allSpaces.map(space => {
                                const isSelected = space.space_id === currentSpaceId;
                                return (
                                    <div key={space.space_id}
                                        className={classNames("wk-global-topbar-dropdown-item", isSelected && "selected")}
                                        onClick={() => {
                                            WKApp.shared.currentSpaceId = space.space_id;
                                            localStorage.setItem("currentSpaceId", space.space_id);
                                            WKApp.shared.notifyListener();
                                            WKApp.mittBus.emit("space-changed", space);
                                            this.setState({ showSpaceDropdown: false });
                                        }}>
                                        <span className="wk-global-topbar-space-icon" style={{
                                            backgroundColor: colors[space.name.charCodeAt(0) % colors.length],
                                            width: 24, height: 24, fontSize: 12,
                                        }}>{space.name.charAt(0)}</span>
                                        <span style={{ flex: 1 }}>{space.name}</span>
                                        <span className="wk-global-topbar-invite-btn" title="复制邀请链接" onClick={async (e) => {
                                            e.stopPropagation();
                                            try {
                                                const detail = await WKApp.apiClient.get(`/space/${space.space_id}`);
                                                if (detail.invite_code) {
                                                    const link = `${window.location.origin}${window.location.pathname}?invite=${detail.invite_code}`;
                                                    let copied = false;
                                                    try {
                                                        await navigator.clipboard.writeText(link);
                                                        copied = true;
                                                    } catch {
                                                        // iOS Safari: clipboard API fails outside synchronous click handler
                                                        const textarea = document.createElement("textarea");
                                                        textarea.value = link;
                                                        textarea.style.position = "fixed";
                                                        textarea.style.opacity = "0";
                                                        document.body.appendChild(textarea);
                                                        textarea.select();
                                                        copied = document.execCommand("copy");
                                                        document.body.removeChild(textarea);
                                                    }
                                                    if (copied) {
                                                        Toast.success("邀请链接已复制");
                                                    } else {
                                                        Toast.error("复制失败，请手动复制");
                                                    }
                                                } else { Toast.warning("该 Space 暂无邀请码"); }
                                            } catch { Toast.error("获取邀请码失败"); }
                                        }}>🔗</span>
                                        {isSelected && <span style={{ color: '#6366F1', marginLeft: 4 }}>✓</span>}
                                    </div>
                                );
                            })}
                            <div className="wk-global-topbar-dropdown-divider"></div>
                            <div className="wk-global-topbar-dropdown-item" onClick={() => this.setState({ showSpaceDropdown: false, showSpaceCreate: true })}>
                                <span className="wk-global-topbar-space-icon" style={{ backgroundColor: '#e0e0e0', color: '#666', width: 24, height: 24, fontSize: 14 }}>+</span>
                                <span style={{ flex: 1, color: '#5b6abf' }}>加入 / 创建 Space</span>
                            </div>
                        </div>
                    )}
                </div>
                <ConnectionStatus />
            </div>
            {/* 路由内容 */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
                {vm.historyRoutePaths.map((routePath, i) => {
                    const Cpt = WKApp.route.get(routePath)
                    return <div key={i} style={{ "display": routePath === vm.currentMenus?.routePath ? "block" : "none", "width": "100%", "height": "100%" }}>
                        {React.isValidElement(Cpt) ? Cpt : undefined}
                    </div>
                })}
            </div>
            <SpaceCreate
                visible={this.state.showSpaceCreate}
                onClose={() => {
                    this.setState({ showSpaceCreate: false });
                }}
                onSuccess={() => {
                    this.setState({ showSpaceCreate: false });
                    // 刷新 Space 列表
                    SpaceService.shared.getMySpaces().then(spaces => {
                        this.setState({ allSpaces: spaces });
                    }).catch(() => {});
                }}
            />
        </div>
    }
}

export class MainPage extends Component {

    render() {
        return <Provider create={() => {
            return new MainVM()
        }} render={(vm: MainVM) => {
            return <WKLayout onRenderTab={(size) => {
                // if (size === ScreenSize.small) {
                //     return <TabLowScreen vm={vm}></TabLowScreen>
                // }
                return <TabNormalScreen vm={vm} />
            }} contentLeft={<MainContentLeft vm={vm} />} onRightContext={(context) => {
                WKApp.routeRight.setPush = (view) => {
                    context.push(view)
                }
                WKApp.routeRight.setReplaceToRoot = (view) => {
                    context.replaceToRoot(view)
                }
                WKApp.routeRight.setPop = () => {
                    context.pop()
                }
                WKApp.routeRight.setPopToRoot = () => {
                    context.popToRoot()
                }
            }} onLeftContext={(context) => {
                WKApp.routeLeft.setPush = (view) => {
                    context.push(view)
                }
                WKApp.routeLeft.setReplaceToRoot = (view) => {
                    context.replaceToRoot(view)
                }
                WKApp.routeLeft.setPop = () => {
                    context.pop()
                }
                WKApp.routeLeft.setPopToRoot = () => {
                    context.popToRoot()
                }
            }} contentRight={<EmptyStateIllustration />} />
        }}>

        </Provider>
    }
}