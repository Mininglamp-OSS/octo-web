import { Button, Spin, Toast } from "@douyinfe/semi-ui";
import { Channel, ChannelTypePerson } from "wukongimjssdk/lib/sdk";
import React, { Component, HTMLProps, ReactNode } from "react";
import { UserRelation } from "../../Service/Const";
import WKApp, { FriendApply } from "../../App";
import Provider, { IProviderListener } from "../../Service/Provider";
import { Section } from "../../Service/Section";
import RoutePage from "../RoutePage";
import Sections from "../Sections";
import "./index.css"
import { UserInfoRouteData, UserInfoVM } from "./vm";
import FriendApplyUI from "../FriendApply";
import RouteContext, { FinishButtonContext } from "../../Service/Context";
import { Image } from '@douyinfe/semi-ui';


export interface UserInfoProps extends HTMLProps<any>{
    uid: string
    fromChannel?: Channel // 从那个频道进来的
    sections?: Section[]
    vercode?: string // 验证码，加好友需要，证明好友来源
    onClose?: () => void
}

export default class UserInfo extends Component<UserInfoProps> {



    render() {
        const { uid, onClose, fromChannel, vercode } = this.props

        return <Provider create={() => {
            return new UserInfoVM(uid, fromChannel, vercode)
        }} render={(vm: UserInfoVM) => {
            return <RoutePage onClose={() => {
                if (onClose) {
                    onClose()
                }
            }} render={(context) => {
                return <div className="wk-userinfo">
                    <div className="wk-userinfo-content">
                        {
                            !vm.channelInfo ? <div className="wk-userinfo-loading">
                                <Spin></Spin>
                            </div> : (<>
                                <div className="wk-userinfo-header">
                                    <div className="wk-userinfo-user">
                                        <div className="wk-userinfo-user-avatar">
                                            <Image src={WKApp.shared.avatarUser(uid)}></Image>
                                        </div>
                                        <div className="wk-userinfo-user-info">
                                            <div className="wk-userinfo-user-info-name">
                                                {vm.displayName()}
                                            </div>
                                            <div className="wk-userinfo-user-info-others">
                                                <ul>
                                                    {
                                                        vm.showNickname() ? <li>
                                                            昵称： {vm.channelInfo?.title}
                                                        </li> : undefined
                                                    }
                                                    {
                                                        vm.showChannelNickname() ? <li>
                                                            群昵称： {vm.fromSubscriberOfUser?.remark}
                                                        </li> : undefined
                                                    }
                                                    {
                                                        vm.shouldShowShort() ? <li>
                                                            {WKApp.config.appName}号： {vm.channelInfo?.orgData.short_no}
                                                        </li> : undefined
                                                    }


                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="wk-userinfo-sections">
                                    <Sections sections={vm.sections(context)}></Sections>
                                </div>
                            </>)
                        }

                        <br></br>
                        <br></br>
                    </div>
                    {
                        vm.isSelf() ? undefined : <div className="wk-userInfo-footer">
                            <div className="wk-userinfo-footer-sendbutton">
                                {
                                    vm.relation() === UserRelation.friend ? <Button theme='solid' type="primary" onClick={() => {
                                        WKApp.shared.baseContext.hideUserInfo()
                                        WKApp.endpoints.showConversation(new Channel(vm.uid, ChannelTypePerson))
                                    }}>发送消息</Button> : <Button onClick={() => {
                                        let msg = "我是"
                                        if (vm.fromChannelInfo) {
                                            msg += `群聊"${vm.fromChannelInfo.title}"的${WKApp.loginInfo.name}`
                                        } else {
                                            msg += `${WKApp.loginInfo.name}`
                                        }
                                        var finishButtonContext: FinishButtonContext
                                        context.push(<FriendApplyUI placeholder={msg} onMessage={(m) => {
                                            msg = m
                                            if (!m || m === "") {
                                                finishButtonContext.disable(true)
                                            } else {
                                                finishButtonContext.disable(false)
                                            }
                                        }}></FriendApplyUI>, {
                                            title: "申请添加朋友",
                                            showFinishButton: true,
                                            onFinishContext: (ctx) => {
                                                finishButtonContext = ctx
                                                finishButtonContext.disable(false)
                                            },
                                            onFinish: async () => {
                                                finishButtonContext.loading(true)
                                                await WKApp.dataSource.commonDataSource.friendApply({
                                                    uid: vm.uid,
                                                    remark: msg,
                                                    vercode: vm.vercode || ""
                                                }).then(() => {
                                                    console.log("WKApp.shared.baseContext-->",WKApp.shared.baseContext)
                                                    WKApp.shared.baseContext.hideUserInfo()
                                                }).catch((err) => {
                                                    Toast.error(err.msg)
                                                })
                                                finishButtonContext.loading(false)
                                            }
                                        })
                                    }} >添加好友</Button>
                                }

                            </div>
                        </div>
                    }

                </div>
            }}></RoutePage>
        }}></Provider>

    }
}