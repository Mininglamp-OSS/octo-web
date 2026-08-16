import { WKApp, Dap } from "@octo/base";
import React from "react";
import { Component, ReactNode } from "react";
import "./tab_low_screen.css"
import MainVM from "./vm";

export interface TabLowScreenProps {
    vm: MainVM
}

export class TabLowScreen extends Component<TabLowScreenProps> {

    render(): ReactNode {
        const { vm } = this.props
        return <div className="wk-main-tab">
            <div className="wk-main-tab-content">
                <ul>
                    {
                        vm.menusList.map((menus) => {
                            return <li key={menus.id} onClick={() => {
                                const prevMenuId = vm.currentMenus?.id
                                const isReentry = prevMenuId === menus.id
                                vm.currentMenus = menus
                                // contacts_module_entered:低屏路径与桌面 NavRail 一致,进联系人时计一次
                                // (见 review P2-4;桌面侧在 Main/index.tsx 导航回调里对称埋点)。
                                // 重复点击当前菜单(reentry)不计,与 onPress 类模块统一口径(见二审 P2-4)。
                                if (menus.id === "contacts" && !isReentry) {
                                    Dap.shared.track("contacts_module_entered", {})
                                }
                                // 十二审 🔴 P1-3:apps_module_entered 低屏路径与桌面 NavRail 对称,进 Apps 时计一次
                                // (原 GET /app_bot/available 会被切空间重拉 / 常驻误计,见 Main/index.tsx)。
                                if (menus.id === "appbot" && !isReentry) {
                                    Dap.shared.track("apps_module_entered", {})
                                }
                                if (menus.onPress) {
                                    // Sync the URL before firing the custom
                                    // onPress. Some menu items only swap the
                                    // right pane in onPress (e.g. Summary /
                                    // Skill market) and never touch the
                                    // address bar themselves — without this
                                    // sync the URL stays on the previous
                                    // route, so refresh / copied links /
                                    // browser history reopen the wrong
                                    // module (PR#851 Jerry-Xin 02:22 P1).
                                    // Mirrors the desktop-path NavRail
                                    // handler in Main/index.tsx.
                                    WKApp.route.syncPath(menus.routePath)
                                    menus.onPress(isReentry)
                                } else {
                                    WKApp.route.push(menus.routePath)
                                }
                            }}>{vm.currentMenus?.id === menus.id ? menus.selectedIcon : menus.icon}</li>
                        })
                    }
                </ul>
            </div>
        </div>
    }
}