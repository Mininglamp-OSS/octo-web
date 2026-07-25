import { Toast } from "@douyinfe/semi-ui";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
import React, { Component, type HTMLProps } from "react";
import { UserRelation } from "../../Service/Const";
import WKApp from "../../App";
import Provider from "../../Service/Provider";
import { Section } from "../../Service/Section";
import RoutePage from "../RoutePage";
import "./index.css"
import { UserInfoRouteData, UserInfoVM } from "../../bridge/profileDetail/UserInfoVM";
import FriendApplyUI from "../FriendApply";
import RouteContext, { type FinishButtonContext } from "../../Service/Context";
import { I18nContext } from "../../i18n";
import WKAvatarPreviewImage from "../WKAvatarPreviewImage";
import WKButton from "../WKButton";
import type { UserInfoMetaItem } from "./UserInfoMetaList";
import UserInfoView, { type UserInfoViewFooter } from "../../ui/profileDetail/UserInfoView";


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

    getRemark(vm: UserInfoVM) {
        return vm.getRemark();
    }

    startEditRemark = (vm: UserInfoVM) => {
        vm.startEditRemark();
    };

    cancelEditRemark = (vm: UserInfoVM) => {
        vm.cancelEditRemark();
    };

    saveRemark = async (vm: UserInfoVM) => {
        const { t } = this.context;
        const result = await vm.saveRemark();
        if (result === "ok") {
            Toast.success(t("base.userInfo.remarkUpdated"));
        } else if (result === "failed") {
            Toast.error(vm.remarkSaveError || t("base.userInfo.remarkUpdateFailed"));
        }
    };

    getVisibleSections(vm: UserInfoVM, context: RouteContext<UserInfoRouteData>) {
        const remarkTitle = this.context.t("base.module.userInfo.remark");
        return vm.sections(context)
            .map((section) => {
                const rows = section.rows?.filter((row) => {
                    return row.properties?.key !== "userinfo.remark" && row.properties?.title !== remarkTitle;
                });
                return new Section({
                    title: section.title,
                    rows,
                    subtitle: section.subtitle,
                });
            })
            .filter((section) => {
                return (section.rows && section.rows.length > 0) || !!section.title || !!section.subtitle;
            });
    }

    getFooter(vm: UserInfoVM, context: RouteContext<any>): UserInfoViewFooter | undefined {
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
            return { hint: t("base.userInfo.externalOnlyGroup") }
        }

        let content = <></>
        // Space 模式：成员间可直接发消息，但 Bot 需要先加好友
        const spaceId = WKApp.shared.currentSpaceId;
        const isBot = vm.channelInfo?.orgData?.robot === 1;
        const isFriend = vm.relation() === UserRelation.friend;
        if (spaceId && (!isBot || isFriend)) {
            // 非 Bot 成员或已加好友的 Bot：直接发消息
            content = <WKButton type="button" variant="primary" onClick={() => {
                WKApp.shared.baseContext.hideUserInfo()
                // WuKongIM DM 只认裸 uid
                WKApp.endpoints.showConversation(new Channel(vm.uid, ChannelTypePerson))
            }}>{t("base.userInfo.sendMessage")}</WKButton>
        } else if (isFriend) {
            content = <WKButton type="button" variant="primary" onClick={() => {
                WKApp.shared.baseContext.hideUserInfo()
                WKApp.endpoints.showConversation(new Channel(vm.uid, ChannelTypePerson))
            }}>{t("base.userInfo.sendMessage")}</WKButton>
        } else if (isBot) {
            // Bot 未加好友：走好友申请流程（BotFather 通知创建者审核）
            content = <WKButton type="button" variant="primary" onClick={() => {
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
                        await vm.applyFriend(msg, WKApp.shared.currentSpaceId).then(() => {
                            Toast.success(t("base.userInfo.friendApplySent"))
                            WKApp.shared.baseContext.hideUserInfo()
                        }).catch((err: any) => {
                            Toast.error(err.msg || t("base.userInfo.applyFailed"))
                        })
                        finishButtonContext.loading(false)
                    }
                })
            }}>{t("base.userInfo.addFriend")}</WKButton>
        } else {
            if (!vm.vercode || vm.vercode === "") { // 没有验证码，不显示添加好友按钮
                return undefined
            }
            content = <WKButton type="button" variant="secondary" onClick={() => {
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
                        await vm.applyFriend(msg, WKApp.shared.currentSpaceId).then(() => {
                            WKApp.shared.baseContext.hideUserInfo()
                        }).catch((err) => {
                            Toast.error(err.msg)
                        })
                        finishButtonContext.loading(false)
                    }
                })
            }} >{t("base.userInfo.addFriend")}</WKButton>
        }

        return { action: content }
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
                const footer = this.getFooter(vm, context)
                const sections = vm.channelInfo ? this.getVisibleSections(vm, context) : []
                const metaItems: UserInfoMetaItem[] = []
                if (vm.showNickname()) {
                    metaItems.push({
                        label: t("base.userInfo.nickname"),
                        value: vm.channelInfo?.title,
                    })
                }
                if (vm.showChannelNickname()) {
                    metaItems.push({
                        label: t("base.userInfo.groupNickname"),
                        value: vm.fromSubscriberOfUser?.remark,
                    })
                }
                if (vm.shouldShowShort()) {
                    metaItems.push({
                        label: t("base.userInfo.shortNo", {
                            values: { appName: WKApp.config.appName },
                        }),
                        value: vm.channelInfo?.orgData.short_no || "",
                    })
                }

                return <UserInfoView
                    loading={!vm.channelInfo}
                    avatar={<WKAvatarPreviewImage channel={new Channel(uid, ChannelTypePerson)} />}
                    displayName={vm.displayName()}
                    isBot={vm.channelInfo?.orgData?.robot === 1}
                    isRealnameVerified={vm.isRealnameVerified()}
                    metaItems={metaItems}
                    showRemarkEditor={!vm.isSelf()}
                    editingRemark={vm.editingRemark}
                    remark={this.getRemark(vm)}
                    remarkDraft={vm.remarkDraft}
                    savingRemark={vm.savingRemark}
                    sections={sections}
                    footerAction={footer?.action}
                    footerHint={footer?.hint}
                    labels={{
                        remark: t("base.userInfo.remark"),
                        remarkPlaceholder: t("base.userInfo.remarkPlaceholder"),
                        editRemark: t("base.userInfo.editRemark"),
                        cancel: t("base.common.cancel"),
                        save: t("base.common.save"),
                        notSet: t("base.common.notSet"),
                    }}
                    onRemarkDraftChange={(value) => vm.setRemarkDraft(value)}
                    onStartEditRemark={() => this.startEditRemark(vm)}
                    onCancelEditRemark={() => this.cancelEditRemark(vm)}
                    onSaveRemark={() => {
                        void this.saveRemark(vm)
                    }}
                />
            }}></RoutePage>
        }}></Provider>

    }
}
