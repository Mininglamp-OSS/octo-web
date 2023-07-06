import { TextArea } from "@douyinfe/semi-ui";
import React from "react";
import { Component, ReactNode } from "react";

import "./index.css"

export interface FriendApplyUIProps {
    onMessage?:(msg:string)=>void
    placeholder?:string
}

export default class FriendApplyUI extends Component<FriendApplyUIProps> {

    render(): ReactNode {
        const { onMessage,placeholder } = this.props
        console.log("placeholder----->",placeholder)
        return <div className="wk-friendapply">
            <div className="wk-friendapply-content">
                <div className="wk-friendapply-content-tip">
                    发送添加朋友申请
                </div>
                <div className="wk-friendapply-content-message">
                    <TextArea defaultValue={placeholder} onChange={(v)=>{
                        if(onMessage) {
                            onMessage(v)
                        }
                    }}></TextArea>
                </div>
            </div>
        </div>
    }
}