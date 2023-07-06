import { FriendApplyState, WKApp, WKViewQueueHeader, Provider } from "@tsdaodao/base";
import React from "react";
import { Component, ReactNode } from "react";
import { Button } from '@douyinfe/semi-ui';
import "./index.css"
import { NewFriendVM } from "./vm";
import "./index.css"
import { FriendAdd } from "../FriendAdd";

export class NewFriend extends Component {

    render(): ReactNode {
        return <Provider create={() => {
            return new NewFriendVM()
        }} render={(vm: NewFriendVM) => {

            return <div className="wk-newfriend">
                <WKViewQueueHeader title="新朋友" onBack={() => {
                    WKApp.routeLeft.pop()
                }} action={<div className="wk-viewqueueheader-content-action">
                    <Button size="small" onClick={()=>{
                          WKApp.routeLeft.push(<FriendAdd onBack={()=>{
                            WKApp.routeLeft.pop()
                        }}></FriendAdd>)
                    }} >添加好友</Button>
                </div>}></WKViewQueueHeader>
                <div className="wk-newfriend-content">
                    <ul>
                        {
                            vm.friendApplys.map((f) => {
                                return <li key={f.uid} >
                                    <div className="wk-newfriend-content-avatar">
                                        <img src={WKApp.shared.avatarUser(f.uid)}></img>
                                    </div>
                                    <div className="wk-newfriend-content-title">
                                        <div className="wk-newfriend-content-title-name">
                                            {f.name}
                                        </div>
                                        <div className="wk-newfriend-content-title-remark">
                                            {f.remark} 
                                        </div>
                                    </div>
                                    <div className="wk-newfriend-content-action">
                                        <Button loading={vm.currentFriendApply?.uid === f.uid && vm.sureLoading } disabled={f.state==FriendApplyState.accepted} onClick={()=>{
                                           vm.friendSure(f)
                                        }}>{f.state==FriendApplyState.accepted?"已添加":"确认"}</Button>
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