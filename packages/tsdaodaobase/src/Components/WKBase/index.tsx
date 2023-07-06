import { Modal } from "@douyinfe/semi-ui";
import { Channel } from "wukongimjssdk/lib/sdk";
import React, { Component, HTMLProps, ReactNode } from "react";
import ConversationSelect from "../ConversationSelect";
import UserInfo from "../UserInfo";
import "./index.css"

export interface WKBaseState {
    showUserInfo?: boolean
    userUID?: string
    vercode?:string // 加好友的验证码
    fromChannel?:Channel
    showConversationSelect?: boolean
    conversationSelectTitle?:string
    showAlert?: boolean
    alertContent?: string
    alertTitle?: string
    onAlertOk?: () => void
    conversationSelectFinished?: (channel: Channel[]) => void
}

export interface WKBaseProps{
    children: React.ReactNode
    onContext?: (context: WKBaseContext) => void
}

export interface WKBaseContext {
    // 显示最近会话选择
    showConversationSelect(onFinished?: (channels: Channel[]) => void,title?:string): void

    // 显示用户信息
    showUserInfo(uid: string,fromChannel?:Channel,vercode?:string): void
    // 隐藏用户信息
    hideUserInfo(): void
    // 弹出提示框
    showAlert(conf:{content:string,title?:string,onOk?:()=>void}): void
}

export default class WKBase extends Component<WKBaseProps, WKBaseState> implements WKBaseContext {

    constructor(props: any) {
        super(props)
        this.state = {}
    }
    showUserInfo(uid: string,fromChannel?:Channel,vercode?:string): void {
        this.setState({
            showUserInfo: true,
            userUID: uid,
            fromChannel: fromChannel,
            vercode:vercode,
        })
    }

    showAlert(conf:{content:string,title?:string,onOk?:()=>void}): void {
        this.setState({
            alertContent: conf.content,
            alertTitle: conf.title,
            onAlertOk: conf.onOk,
            showAlert: true,
        })
    }

    showConversationSelect(onFinished?: (channels: Channel[]) => void,title?:string) {
        this.setState({
            showConversationSelect: true,
            conversationSelectFinished: onFinished,
            conversationSelectTitle: title,
        })
    }

    hideUserInfo() {
        this.setState({
            showUserInfo: false,
            userUID: undefined,
            vercode: undefined,
        })
    }

    componentDidMount() {
        const { onContext } = this.props
        if (onContext) {
            onContext(this)
        }
    }

    cancelAlert() {
        this.setState({
            showAlert: false,
            alertContent: undefined,
            alertTitle: undefined,
            onAlertOk: undefined,
        })
    }

    render(): ReactNode {
        const { showUserInfo, userUID,fromChannel,vercode, showConversationSelect,conversationSelectTitle, conversationSelectFinished, onAlertOk,alertContent,alertTitle } = this.state
        return <div className="wk-base">
            {this.props.children}
            <Modal width={400} footer={null} closeIcon={<div></div>} className="wk-base-modal-userinfo wk-base-modal" visible={showUserInfo} mask={false} onCancel={() => {
                this.setState({
                    showUserInfo: false,
                    userUID: undefined
                })
            }}>
                {
                    userUID && userUID !== "" ? <UserInfo fromChannel={fromChannel} vercode={vercode} uid={userUID} onClose={() => {
                        this.setState({
                            showUserInfo: false,
                            userUID: undefined
                        })
                    }}>
                    </UserInfo> : undefined
                }

            </Modal>

            <Modal className="wk-base-modal" width={400} footer={null} visible={showConversationSelect} mask={false} onCancel={() => {
                this.setState({
                    showConversationSelect: false,
                })
            }}>
                <ConversationSelect onFinished={(channels: Channel[]) => {
                    this.setState({
                        showConversationSelect: false
                    })
                    if (conversationSelectFinished) {
                        conversationSelectFinished(channels)
                    }
                }} title={conversationSelectTitle}></ConversationSelect>
            </Modal>

            <Modal title={alertTitle}
                visible={this.state.showAlert}
                onOk={() => {
                    if (onAlertOk) {
                        onAlertOk()
                    }
                    this.cancelAlert()
                }}
                onCancel={() => {
                    this.cancelAlert()
                }}
                maskClosable={false}>
                    {alertContent}
            </Modal>
        </div>
    }
}