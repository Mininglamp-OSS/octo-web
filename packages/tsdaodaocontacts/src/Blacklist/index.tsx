import { WKApp, WKViewQueueHeader, Provider } from "@tsdaodao/base";
import React from "react";
import { Component, ReactNode } from "react";
import "./index.css"
import BlacklistVM from "./vm";

export default class Blacklist extends Component {

    render(): ReactNode {

        return <Provider create={() => {
            return new BlacklistVM()
        }} render={(vm: BlacklistVM) => {
            return <div className="wk-blacklist">
                <WKViewQueueHeader title="黑名单" onBack={() => {
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