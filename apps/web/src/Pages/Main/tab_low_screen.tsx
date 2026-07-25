import { WKApp } from "@octo/base";
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
                                vm.currentMenus = menus
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
                                    menus.onPress()
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