import React, { Component, ReactNode } from "react";
import { Button } from '@douyinfe/semi-ui';
import { FriendApplyState, WKApp, WKViewQueueHeader, Provider, I18nContext, t } from "@octo/base";
import { FriendAdd } from "../FriendAdd";
import { NewFriendVM } from "./vm";
import "./index.css";

export class NewFriend extends Component {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    render(): ReactNode {
        return <Provider create={() => {
            return new NewFriendVM()
        }} render={(vm: NewFriendVM) => {

            return <div className="wk-newfriend">
                <WKViewQueueHeader title={t("contacts.header.newFriends")} onBack={() => {
                    WKApp.routeLeft.pop()
                }} action={<div className="wk-viewqueueheader-content-action">
                    <Button size="small" onClick={()=>{
                          WKApp.routeLeft.push(<FriendAdd onBack={()=>{
                            WKApp.routeLeft.pop()
                        }}></FriendAdd>)
                    }} >{t("contacts.friendAdd.title")}</Button>
                </div>}></WKViewQueueHeader>
                <div className="wk-newfriend-content">
                    <ul>
                        {
                            vm.friendApplys.map((f) => {
                                return <li key={f.to_uid} >
                                    <div className="wk-newfriend-content-avatar">
                                        <img src={WKApp.shared.avatarUser(f.to_uid)}></img>
                                    </div>
                                    <div className="wk-newfriend-content-title">
                                        <div className="wk-newfriend-content-title-name">
                                            {f.to_name}
                                        </div>
                                        <div className="wk-newfriend-content-title-remark">
                                            {f.remark}
                                        </div>
                                    </div>
                                    <div className="wk-newfriend-content-action">
                                        <Button loading={vm.currentFriendApply?.to_uid === f.to_uid && vm.sureLoading } disabled={f.status === FriendApplyState.accepted} onClick={()=>{
                                           vm.friendSure(f)
                                        }}>{f.status === FriendApplyState.accepted ? t("contacts.newFriend.added") : t("contacts.newFriend.confirm")}</Button>
                                    </div>
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
