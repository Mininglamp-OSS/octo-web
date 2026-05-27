import { WKApp, WKViewQueueHeader, Provider, I18nContext, t } from "@octo/base";
import React from "react";
import { Component, ReactNode } from "react";
import "./index.css"
import BlacklistVM from "./vm";

export default class Blacklist extends Component {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    render(): ReactNode {

        return <Provider create={() => {
            return new BlacklistVM()
        }} render={(vm: BlacklistVM) => {
            return <div className="wk-blacklist">
                <WKViewQueueHeader title={t("contacts.header.blacklist")} onBack={() => {
                    WKApp.routeLeft.pop()
                }}></WKViewQueueHeader>
                <div className="wk-blacklist-content">
                    <ul>
                        {
                            vm.blacklist().map((b) => {
                                return <li key={b.uid} onClick={()=>{
                                    WKApp.shared.baseContext.showUserInfo(b.uid)
                                }}>
                                    <div className="wk-blacklist-content-avatar">
                                        <img src={WKApp.shared.avatarUser(b.uid)}></img>
                                    </div>
                                    <div className="wk-blacklist-content-title">{b.name}</div>
                                </li>
                            })
                        }

                    </ul>
                </div>
            </div>
        }}>
        </Provider>
    }
}
