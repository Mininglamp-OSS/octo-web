import { WKApp } from "@tsdaodao/base";
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