import { WKApp, WKViewQueueHeader, QRCodeMy, Search } from "@tsdaodao/base";
import {WKBase, WKBaseContext } from "@tsdaodao/base";
import React from "react";
import { Component, ReactNode } from "react";
import { Spin,Toast } from '@douyinfe/semi-ui';
import "./index.css"

export interface FriendAddProps {
    onBack?: () => void
}

export class FriendAddState {
    spinning!:boolean
    keyword?:string
    result?:any
}

export class FriendAdd extends Component<FriendAddProps,FriendAddState> {
    baseContext!:WKBaseContext
    constructor(props:any) {
        super(props)

        this.state = {
            spinning: false,
        }
    }

    async searchUser() {
        const { keyword } = this.state
        if(!keyword) {
            return
        }

        this.setState({
            spinning: true,
        })
      const result = await WKApp.dataSource.commonDataSource.searchUser(keyword).catch((err)=>{
          Toast.error(err.msg)
      })
      if(result) {
        this.setState({
            result: result,
            spinning: false,
        })
        if(result.exist !== 1) {
            Toast.error("用户不存在！")
        }else {
            WKApp.shared.baseContext.showUserInfo(result.data.uid,undefined,result.data.vercode)
        }
      }
    }   


    render(): ReactNode {
        const { onBack } = this.props
        const { spinning } = this.state
        return <WKBase onContext={(ctx)=>{
            this.baseContext = ctx
        }}>
            <div className="wk-friendadd">
            <WKViewQueueHeader title="添加好友" onBack={onBack} />
            <div className="wk-friendadd-content">
                <Spin spinning={spinning}>
                <Search placeholder={`${WKApp.config.appName}号/手机号`} onChange={(v)=>{
                    this.setState({
                        keyword: v
                    })
                }} onEnterPress={()=>{
                    this.searchUser()
                }}></Search>
                </Spin>
                <div className="wk-friendadd-content-qrcode">
                        我的{WKApp.config.appName}号：{WKApp.loginInfo.shortNo} <img onClick={()=>{
                            WKApp.routeLeft.push(<QRCodeMy></QRCodeMy>)
                        }} src={require("./assets/icon_qrcode.png").default}></img>
                </div>  
            </div>
        </div>
        </WKBase>
    }
}