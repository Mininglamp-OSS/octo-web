import { Button, Spin, Toast } from "@douyinfe/semi-ui";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
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
import AiBadge from "../AiBadge";
import RealnameVerifiedBadge from "../RealnameVerifiedBadge";
import { I18nContext } from "../../i18n";
import WKAvatarPreviewImage from "../WKAvatarPreviewImage";


export interface UserInfoProps extends HTMLProps<any> {
    uid: string
    fromChannel?: Channel // 从那个频道进来的
    sections?: Section[]
    vercode?: string // 验证码，加好友需要，证明好友来源
    onClose?: () => void
}

export default class UserInfo extends Component<UserInfoProps> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;


    getBottomPanel(vm: UserInfoVM, context: RouteContext<any>) {
        if (vm.isSelf()) {
            return undefined
        }

        // dmwork-web #1016: 跨 space 外部成员在任何视角下都不允许直接发起 DM，
        // 只能继续通过群聊交流。这里作为 UI 层唯一拦截点：隐藏"发送消息" / "添加好友"
        // 按钮，底部改显一条静态提示，查看资料入口（昵称/@SpaceName/section 列表）
        // 照常展示。后端 Phase 2 会补齐好友/同 space 校验。
        //
        // 判定字段沿用 resolveExternalForViewer（is_external 是相对当前
        // 查看 space 的视角值，不是绝对属性）。
        const isExternalToViewer = vm.isExternalToViewer()
        const { t } = this.context
        if (isExternalToViewer) {
            return <div className="wk-userInfo-footer">
                <div className="wk-userinfo-footer-external-hint">
                    {t("base.userInfo.externalOnlyGroup")}
                </div>
            </div>
        }

        let content = <></>
        // Space 模式：成员间可直接发消息，但 Bot 需要先加好友
        const spaceId = WKApp.shared.currentSpaceId;
        const isBot = vm.channelInfo?.orgData?.robot === 1;
        const isFriend = vm.relation() === UserRelation.friend;
        if (spaceId && (!isBot || isFriend)) {
            // 非 Bot 成员或已加好友的 Bot：直接发消息
            content = <Button theme='solid' type="primary" onClick={() => {
                WKApp.shared.baseContext.hideUserInfo()
                // WuKongIM DM 只认裸 uid
                WKApp.endpoints.showConversation(new Channel(vm.uid, ChannelTypePerson))
            }}>{t("base.userInfo.sendMessage")}</Button>
        } else if (isFriend) {
            content = <Button theme='solid' type="primary" onClick={() => {
                WKApp.shared.baseContext.hideUserInfo()
                WKApp.endpoints.showConversation(new Channel(vm.uid, ChannelTypePerson))
            }}>{t("base.userInfo.sendMessage")}</Button>
        } else if (isBot) {
            // Bot 未加好友：走好友申请流程（BotFather 通知创建者审核）
            content = <Button theme='solid' type="primary" onClick={() => {
                let msg = t("base.userInfo.botApplyMessage", {
                    values: { name: vm.displayName() },
                })
                var finishButtonContext: FinishButtonContext
                context.push(<FriendApplyUI placeholder={msg} onMessage={(m) => {
                    msg = m
                    if (!m || m === "") {
                        finishButtonContext.disable(true)
                    } else {
                        finishButtonContext.disable(false)
                    }
                }}></FriendApplyUI>, {
                    title: t("base.userInfo.applyAddFriendBot"),
                    showFinishButton: true,
                    onFinishContext: (ctx) => {
                        finishButtonContext = ctx
                        finishButtonContext.disable(false)
                    },
                    onFinish: async () => {
                        if (!finishButtonContext) return
                        finishButtonContext.loading(true)
                        await WKApp.dataSource.commonDataSource.friendApply({
                            uid: vm.uid,
                            remark: msg,
                            vercode: vm.vercode || ""
                        }).then(() => {
                            Toast.success(t("base.userInfo.friendApplySent"))
                            WKApp.shared.baseContext.hideUserInfo()
                        }).catch((err: any) => {
                            Toast.error(err.msg || t("base.userInfo.applyFailed"))
                        })
                        finishButtonContext.loading(false)
                    }
                })
            }}>{t("base.userInfo.addFriend")}</Button>
        } else {
            if (!vm.vercode || vm.vercode === "") { // 没有验证码，不显示添加好友按钮
                return undefined
            }
            content = <Button onClick={() => {
                // 好友申请默认文案里的自我介绍走 selfDisplayName()，
                // 已实名用户用 "我是..." + real_name，对端更容易识别。
                const myDisplayName = WKApp.loginInfo.selfDisplayName()
                let msg = t("base.userInfo.selfIntro", {
                    values: { name: myDisplayName },
                })
                if (vm.fromChannelInfo) {
                    msg = t("base.userInfo.groupSelfIntro", {
                        values: {
                            group: vm.fromChannelInfo.title,
                            name: myDisplayName,
                        },
                    })
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
                    title: t("base.userInfo.applyAddFriend"),
                    showFinishButton: true,
                    onFinishContext: (ctx) => {
                        finishButtonContext = ctx
                        finishButtonContext.disable(false)
                    },
                    onFinish: async () => {
                        if (!finishButtonContext) return
                        finishButtonContext.loading(true)
                        await WKApp.dataSource.commonDataSource.friendApply({
                            uid: vm.uid,
                            remark: msg,
                            vercode: vm.vercode || ""
                        }).then(() => {
                            WKApp.shared.baseContext.hideUserInfo()
                        }).catch((err) => {
                            Toast.error(err.msg)
                        })
                        finishButtonContext.loading(false)
                    }
                })
            }} >{t("base.userInfo.addFriend")}</Button>
        }

        return <div className="wk-userInfo-footer">
            <div className="wk-userinfo-footer-sendbutton">
                {content}
            </div>
        </div>
    }

    render() {
        const { uid, onClose, fromChannel, vercode } = this.props
        const { t } = this.context

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
                                            <WKAvatarPreviewImage channel={new Channel(uid, ChannelTypePerson)} />
                                        </div>
                                        <div className="wk-userinfo-user-info">
                                            <div className="wk-userinfo-user-info-name">
                                                {vm.displayName()}
                                                {vm.channelInfo?.orgData?.robot === 1 && <AiBadge />}
                                                {vm.isRealnameVerified() && <RealnameVerifiedBadge />}
                                            </div>
                                            <div className="wk-userinfo-user-info-others">
                                                <ul>
                                                    {
                                                        vm.showNickname() ? <li>
                                                            {t("base.userInfo.nickname")} {vm.channelInfo?.title}
                                                        </li> : undefined
                                                    }
                                                    {
                                                        vm.showChannelNickname() ? <li>
                                                            {t("base.userInfo.groupNickname")} {vm.fromSubscriberOfUser?.remark}
                                                        </li> : undefined
                                                    }
                                                    {
                                                        vm.shouldShowShort() ? <li>
                                                            {t("base.userInfo.shortNo", {
                                                                values: { appName: WKApp.config.appName },
                                                            })} {vm.channelInfo?.orgData.short_no || ''}
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
                        this.getBottomPanel(vm, context)
                    }

                </div>
            }}></RoutePage>
        }}></Provider>

    }
}
