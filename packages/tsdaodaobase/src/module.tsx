import { Channel, ChannelTypePerson, WKSDK, Message, MessageContentType, ConversationAction, ChannelTypeGroup, ChannelInfo,CMDContent, MessageText  } from "wukongimjssdk";
import React, { ElementType } from "react";
import WKApp, { FriendApply, FriendApplyState, ThemeMode } from "./App";
import ChannelQRCode from "./Components/ChannelQRCode";
import { ChannelSettingRouteData } from "./Components/ChannelSetting/context";
import { IndexTableItem } from "./Components/IndexTable";
import { InputEdit } from "./Components/InputEdit";
import { ListItem, ListItemButton, ListItemButtonType, ListItemIcon, ListItemMuliteLine, ListItemSwitch, ListItemSwitchContext, ListItemTip } from "./Components/ListItem";
import { Subscribers } from "./Components/Subscribers";
import UserSelect, { ContactsSelect } from "./Components/UserSelect";
import { Card, CardCell } from "./Messages/Card";
import { GifCell, GifContent } from "./Messages/Gif";
import { HistorySplitCell, HistorySplitContent } from "./Messages/HistorySplit";
import { ImageCell, ImageContent } from "./Messages/Image";
import { SignalMessageCell, SignalMessageContent } from "./Messages/SignalMessage/signalmessage";
import { SystemCell } from "./Messages/System";
import { TextCell } from "./Messages/Text";
import { TimeCell } from "./Messages/Time";
import { UnknownCell } from "./Messages/Unknown";
import { UnsupportCell, UnsupportContent } from "./Messages/Unsupport";
import { ChannelTypeCustomerService, EndpointCategory, EndpointID, GroupRole, MessageContentTypeConst, unsupportMessageTypes, UserRelation } from "./Service/Const";
import RouteContext, { FinishButtonContext, RouteContextConfig } from "./Service/Context";
import { ChannelField } from "./Service/DataSource/DataSource";
import { IModule } from "./Service/Module";
import { Row, Section } from "./Service/Section";
import { VoiceCell, VoiceContent } from './Messages/Voice';
import { VideoCell, VideoContent } from "./Messages/Video";
import { TypingCell } from "./Messages/Typing";
import { LottieSticker, LottieStickerCell } from "./Messages/LottieSticker";
import { LocationCell, LocationContent } from "./Messages/Location";
import { Toast } from "@douyinfe/semi-ui";
import { ChannelSettingManager } from "./Service/ChannelSetting";
import { DefaultEmojiService } from "./Service/EmojiService";
import IconClick from "./Components/IconClick";
import EmojiToolbar from "./Components/EmojiToolbar";
import MergeforwardContent, { MergeforwardCell } from "./Messages/Mergeforward";
import ChannelManagerList from "./Components/ChannelManagerList";
import ChannelBlacklist from "./Components/ChannelBlacklist";
import { UserInfoRouteData } from "./Components/UserInfo/vm";
import { IconAlertCircle } from "@douyinfe/semi-icons";
import { TypingManager } from "./Service/TypingManager";
import APIClient from "./Service/APIClient";
import { ChannelAvatar } from "./Components/ChannelAvatar";
import { ScreenshotCell, ScreenshotContent } from "./Messages/Screenshot";

export default class BaseModule implements IModule {
    id(): string {
        return "base"
    }
    init(): void {

        APIClient.shared.logoutCallback = () => {
            WKApp.shared.logout()
        }

        WKApp.endpointManager.setMethod(EndpointID.emojiService, () => DefaultEmojiService.shared)

        WKApp.messageManager.registerMessageFactor((contentType: number): ElementType | undefined => {

            switch (contentType) {
                case MessageContentType.text: // 文本消息
                    return TextCell
                case MessageContentType.image: // 图片消息
                    return ImageCell
                case MessageContentTypeConst.card: // 名片
                    return CardCell
                case MessageContentTypeConst.gif: // gif
                    return GifCell
                case MessageContentTypeConst.voice: // 语音
                    return VoiceCell
                case MessageContentTypeConst.mergeForward: // 合并转发
                    return MergeforwardCell
                case MessageContentTypeConst.smallVideo: // 小视频
                    return VideoCell
                case MessageContentTypeConst.historySplit: // 历史消息风格线
                    return HistorySplitCell
                case MessageContentTypeConst.time: // 时间消息
                    return TimeCell
                case MessageContentTypeConst.typing: // 输入中...
                    return TypingCell
                case MessageContentTypeConst.lottieSticker: // 动图
                case MessageContentTypeConst.lottieEmojiSticker:
                    return LottieStickerCell
                case MessageContentTypeConst.location: // 定位
                    return LocationCell
                case MessageContentTypeConst.screenshot:
                    return ScreenshotCell
                case MessageContentType.signalMessage: // 端对端加密错误消息
                case 98:
                    return SignalMessageCell
                default:
                    if (contentType <= 2000 && contentType >= 1000) {
                        return SystemCell
                    }
            }
        })

        WKSDK.shared().register(MessageContentType.image, () => new ImageContent()) // 图片

        WKSDK.shared().register(MessageContentTypeConst.card, () => new Card()) // 名片
        WKSDK.shared().register(MessageContentTypeConst.gif, () => new GifContent()) // gif动图
        WKSDK.shared().register(MessageContentTypeConst.voice, () => new VoiceContent()) // 语音正文
        WKSDK.shared().register(MessageContentTypeConst.smallVideo, () => new VideoContent()) // 视频正文
        WKSDK.shared().register(MessageContentTypeConst.historySplit, () => new HistorySplitContent()) // 历史分割线
        WKSDK.shared().register(MessageContentTypeConst.location, () => new LocationContent()) // 定位
        WKSDK.shared().register(MessageContentTypeConst.lottieSticker, () => new LottieSticker()) // 动图
        WKSDK.shared().register(MessageContentTypeConst.lottieEmojiSticker, () => new LottieSticker()) // 动图
        WKSDK.shared().register(MessageContentTypeConst.mergeForward, () => new MergeforwardContent()) // 合并转发
        WKSDK.shared().register(MessageContentTypeConst.screenshot, () => new ScreenshotContent())

        // 未知消息
        WKApp.messageManager.registerCell(MessageContentType.unknown, (): ElementType => {
            return UnknownCell
        })

        // 不支持的消息
        for (const unsupportMessageType of unsupportMessageTypes) {
            WKSDK.shared().register(unsupportMessageType, () => new UnsupportContent())
            WKApp.messageManager.registerCell(unsupportMessageType, (): ElementType => {
                return UnsupportCell
            })
        }

        WKSDK.shared().chatManager.addCMDListener((message: Message) => {
            console.log('收到CMD->', message)
            const cmdContent = message.content as CMDContent
            const param = cmdContent.param

            if (cmdContent.cmd === 'channelUpdate') { // 频道信息更新
                WKSDK.shared().channelManager.fetchChannelInfo(new Channel(param.channel_id, param.channel_type))
            } else if (cmdContent.cmd === "typing") {
                TypingManager.shared.addTyping(new Channel(cmdContent.param.channel_id, cmdContent.param.channel_type), cmdContent.param.from_uid, cmdContent.param.from_name)
            } else if (cmdContent.cmd === "groupAvatarUpdate") { // 群头像更新
                WKSDK.shared().channelManager.fetchChannelInfo(new Channel(param.group_no, ChannelTypeGroup))
            } else if (cmdContent.cmd === "unreadClear") { // 清除最近会话未读数量
                const channel = new Channel(param.channel_id, param.channel_type)
                const conversation = WKSDK.shared().conversationManager.findConversation(channel)
                let unread = 0
                if (param.unread > 0) {
                    unread = param.unread
                }
                if (conversation) {
                    conversation.unread = unread
                    WKSDK.shared().conversationManager.notifyConversationListeners(conversation, ConversationAction.update)
                }
            } else if (cmdContent.cmd === "conversationDeleted") { // 最近会话删除
                const channel = new Channel(param.channel_id, param.channel_type)
                WKSDK.shared().conversationManager.removeConversation(channel)
            } else if (cmdContent.cmd === "friendRequest") {  // 好友申请
                const friendApply = new FriendApply()
                friendApply.uid = param.apply_uid
                friendApply.name = param.apply_name
                friendApply.state = FriendApplyState.apply
                friendApply.remark = param.remark
                friendApply.token = param.token
                friendApply.unread = true
                friendApply.createdAt = message.timestamp
                WKApp.shared.addFriendApply(friendApply)
            } else if (cmdContent.cmd === "friendAccept") { // 接受好友申请
                const toUID = param.to_uid
                if (!toUID || toUID === "") {
                    return
                }
                if (param.from_uid) {
                    WKSDK.shared().channelManager.fetchChannelInfo(new Channel(param.from_uid, ChannelTypePerson))
                }

                WKApp.dataSource.contactsSync() // 同步联系人

                const friendApplys = WKApp.shared.getFriendApplys()
                if (friendApplys && friendApplys.length > 0) {
                    for (const friendApply of friendApplys) {
                        if (toUID === friendApply.uid) {
                            friendApply.unread = false
                            friendApply.state = FriendApplyState.accepted
                            WKApp.shared.updateFriendApply(friendApply)
                            WKApp.endpointManager.invokes(EndpointCategory.friendApplyDataChange)
                            break
                        }
                    }
                }
            } else if (cmdContent.cmd === "friendDeleted") {
                WKApp.dataSource.contactsSync() // 同步联系人
            } else if (cmdContent.cmd === "memberUpdate") { // 成员更新
                const channel = new Channel(cmdContent.param.group_no, ChannelTypeGroup)
                WKSDK.shared().channelManager.syncSubscribes(channel)
            } else if (cmdContent.cmd === "onlineStatus") { // 好友在线状态改变
                const channel = new Channel(cmdContent.param.uid, ChannelTypePerson)
                const online = param.online === 1
                const onlineChannelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)
                if (onlineChannelInfo) {
                    onlineChannelInfo.online = online
                    if (!online) {
                        onlineChannelInfo.lastOffline = new Date().getTime() / 1000
                    }
                    WKSDK.shared().channelManager.notifyListeners(onlineChannelInfo)
                } else {
                    WKSDK.shared().channelManager.fetchChannelInfo(channel)
                }
            } else if (cmdContent.cmd === "syncConversationExtra") { // 同步最近会话扩展
                WKSDK.shared().conversationManager.syncExtra()
            } else if (cmdContent.cmd === "syncReminders") { // 同步提醒项
                WKSDK.shared().reminderManager.sync()
            } else if (cmdContent.cmd === "messageRevoke") { // 消息撤回
                const channel = message.channel
                const messageID = param.message_id
                let conversation = WKSDK.shared().conversationManager.findConversation(channel)
                if (conversation && conversation.lastMessage && conversation.lastMessage?.messageID === messageID) {
                    conversation.lastMessage.remoteExtra.revoke = true
                    conversation.lastMessage.remoteExtra.revoker = message.fromUID
                    WKSDK.shared().conversationManager.notifyConversationListeners(conversation, ConversationAction.update)
                }
            }
        })

        WKSDK.shared().chatManager.addMessageListener((message: Message) => {
            console.log('收到消息->', message)

            if (TypingManager.shared.hasTyping(message.channel)) {
                TypingManager.shared.removeTyping(message.channel)
            }
            switch (message.contentType) {
                case MessageContentTypeConst.channelUpdate:
                    WKSDK.shared().channelManager.fetchChannelInfo(message.channel)
                    break
                case MessageContentTypeConst.addMembers:
                case MessageContentTypeConst.removeMembers:
                    WKSDK.shared().channelManager.syncSubscribes(message.channel)
                    break;
            }

            if (this.allowNotify(message)) {
                let from = ""
                if (message.channel.channelType === ChannelTypeGroup) {
                    const fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(message.fromUID, ChannelTypePerson))
                    if (fromChannelInfo) {
                        from = `${fromChannelInfo?.orgData.displayName}: `
                    }

                }
                this.sendNotification(message, `${from}${message.content.conversationDigest}`)
            }
        })

        WKSDK.shared().channelManager.addListener((channelInfo: ChannelInfo) => {
            if (channelInfo.channel.channelType === ChannelTypePerson) {
                if (WKApp.loginInfo.uid === channelInfo.channel.channelID) {
                    WKApp.loginInfo.name = channelInfo.title;
                    WKApp.loginInfo.shortNo = channelInfo.orgData.short_no;
                    WKApp.loginInfo.sex = channelInfo.orgData.sex;
                    WKApp.loginInfo.save()
                }
            }

        })


        this.registerChatMenus() // 注册开始菜单

        this.registerUserInfo() // 注册用户资料功能

        this.registerChannelSettings() // 注册频道设置功能
        this.registerChannelManages() // 注册频道管理功能
        this.registerMessageContextMenus() // 注册消息上下文菜单

        this.registerChatToolbars() // 注册聊天工具栏


    }

    allowNotify(message: Message) {
        if (WKApp.shared.notificationIsClose) { // 用户关闭了通知
            return false
        }
        if (WKSDK.shared().isSystemMessage(message.contentType)) { // 系统消息不发通知
            return false
        }
        if (message.fromUID === WKApp.loginInfo.uid) { // 自己发的消息不发通知
            return false
        }

        return true
    }

    sendNotification(message: Message, description?: string) {
        let channelInfo = WKSDK.shared().channelManager.getChannelInfo(message.channel)
        if (channelInfo && channelInfo.mute) {
            return
        }


        if (window.Notification && Notification.permission !== "denied") {
            const notify = new Notification(channelInfo ? channelInfo.orgData.displayName : "通知", {
                body: description,
                icon: WKApp.shared.avatarChannel(message.channel),
                lang: 'zh-CN',
                tag: "tag",
                renotify: true,
            });

            notify.onclick = () => {
                notify.close();
                window.focus();
                WKApp.endpoints.showConversation(message.channel)
            }
            notify.onshow = () => {
                //5秒后关闭消息框
                setTimeout(function () {
                    notify.close();
                }, 5000);
            }

        }
    }

    registerChatToolbars() {
        WKApp.endpoints.registerChatToolbar("chattoolbar.emoji", (ctx) => {
            return <EmojiToolbar conversationContext={ctx} icon={require("./assets/toolbars/func_face_normal.svg").default}></EmojiToolbar>
        })

        WKApp.endpoints.registerChatToolbar("chattoolbar.mention", (ctx) => {
            const channel = ctx.channel()
            if (channel.channelType === ChannelTypePerson) {
                return undefined
            }
            return <IconClick icon={require("./assets/toolbars/func_mention_normal.svg").default} onClick={() => {
                ctx.messageInputContext().insertText("@")
            }}></IconClick>
        })

        WKApp.endpoints.registerChatToolbar("chattoolbar.screenshot", (ctx) => {

            return <IconClick icon={require("./assets/toolbars/func_screenshot.svg").default} onClick={() => {
                window.open("https://jietu.qq.com")
            }}></IconClick>
        })


    }

    registerChatMenus() {
        WKApp.shared.chatMenusRegister("chatmenus.startchat", (param) => {
            const isDark = WKApp.config.themeMode === ThemeMode.dark
            return {
                title: "发起群聊",
                icon: require(`${isDark ? "./assets/popmenus_startchat_dark.png" : "./assets/popmenus_startchat.png"}`).default,
                onClick: () => {
                    var selectItems: IndexTableItem[]
                    var finishButtonContext: FinishButtonContext
                    WKApp.routeLeft.push(<ContactsSelect showFinishButton={true} onFinishButtonContext={(context) => {
                        finishButtonContext = context
                    }} onSelect={(items) => {
                        selectItems = items
                    }} showHeader={true} onBack={() => {
                        WKApp.routeLeft.pop()
                    }} onFinished={() => {
                        if (selectItems && selectItems.length > 0) {
                            finishButtonContext.loading(true)
                            WKApp.dataSource.channelDataSource.createChannel(selectItems.map((item) => {
                                return item.id
                            })).then(() => {
                                finishButtonContext.loading(false)
                                WKApp.routeLeft.pop()
                            }).catch((err) => {
                                Toast.error(err.msg)
                                finishButtonContext.loading(false)
                            })
                        }
                    }}></ContactsSelect>)
                }
            }
        })
    }

    registerMessageContextMenus() {
        WKApp.endpoints.registerMessageContextMenus("contextmenus.copy", (message) => {
            if (message.contentType !== MessageContentType.text) {
                return null
            }

            return {
                title: "复制", onClick: () => {
                    (function (s) {
                        document.oncopy = function (e) {
                            e.clipboardData?.setData('text', s);
                            e.preventDefault();
                            document.oncopy = null;
                        }
                    })((message.content as MessageText).text || "");
                    document.execCommand('Copy');
                }
            }
        }, 1000)

        WKApp.endpoints.registerMessageContextMenus("contextmenus.forward", (message, context) => {
            if (WKApp.shared.notSupportForward.includes(message.contentType)) {
                return null
            }


            return {
                title: "转发", onClick: () => {
                    context.fowardMessageUI(message)
                }
            }
        }, 2000)
        WKApp.endpoints.registerMessageContextMenus("contextmenus.reply", (message, context) => {
            return {
                title: "回复", onClick: () => {
                    context.reply(message)
                }
            }
        })
        WKApp.endpoints.registerMessageContextMenus("contextmenus.muli", (message, context) => {
            return {
                title: "多选", onClick: () => {
                    context.setEditOn(true)
                }
            }
        }, 3000)
        WKApp.endpoints.registerMessageContextMenus("contextmenus.revoke", (message, context) => {
            if (message.messageID == "") {
                return null
            }

            let isManager = false
            if (message.channel.channelType == ChannelTypeGroup) {
                const sub = WKSDK.shared().channelManager.getSubscribeOfMe(message.channel)
                if (sub?.role == GroupRole.manager || sub?.role == GroupRole.owner) {
                    isManager = true;
                }
            }

            if (!isManager) {
                if (!message.send) {
                    return null
                }
                let revokeSecond = WKApp.remoteConfig.revokeSecond
                if (revokeSecond > 0) {
                    const messageTime = new Date().getTime() / 1000 - message.timestamp
                    if (messageTime > revokeSecond) { //  超过两分钟则不显示撤回
                        return null
                    }
                }
            }
            return {
                title: "撤回", onClick: () => {
                    context.revokeMessage(message).catch((err) => {
                        Toast.error(err.msg)
                    })
                }
            }
        }, 4000)
    }

    registerUserInfo() {
        WKApp.shared.userInfoRegister("userinfo.remark", (context: RouteContext<UserInfoRouteData>) => {
            const data = context.routeData()
            const channelInfo = data.channelInfo
            const fromSubscriberOfUser = data.fromSubscriberOfUser

            if (data.isSelf) {
                return
            }

            const rows = new Array()
            rows.push(new Row({
                cell: ListItem,
                properties: {
                    title: "设置备注",
                    onClick: () => {
                        this.inputEditPush(context, channelInfo?.orgData?.remark, async (value) => {
                            await WKApp.dataSource.commonDataSource.userRemark(data.uid, value).catch((err) => {
                                Toast.error(err.msg)
                            })
                            return
                        }, "设置备注")
                    }
                }
            }))
            if (fromSubscriberOfUser) {
                let joinDesc = `${fromSubscriberOfUser.orgData.created_at.substr(0, 10)}`
                if (fromSubscriberOfUser.orgData?.invite_uid && fromSubscriberOfUser.orgData?.invite_uid !== "") {
                    const inviterChannel = new Channel(fromSubscriberOfUser.orgData?.invite_uid, ChannelTypePerson)
                    const inviteChannelInfo = WKSDK.shared().channelManager.getChannelInfo(inviterChannel)
                    if (inviteChannelInfo) {
                        joinDesc += ` ${inviteChannelInfo.title}邀请入群`
                    } else {
                        WKSDK.shared().channelManager.fetchChannelInfo(inviterChannel)
                    }
                } else {
                    joinDesc += "加入群聊"
                }
                rows.push(new Row({
                    cell: ListItem,
                    properties: {
                        title: "进群方式",
                        subTitle: joinDesc,
                    }
                }))
            }

            return new Section({
                rows: rows
            })
        })

        WKApp.shared.userInfoRegister("userinfo.others", (context: RouteContext<UserInfoRouteData>) => {
            const data = context.routeData()
            const channelInfo = data.channelInfo
            const relation = channelInfo?.orgData?.follow
            const status = channelInfo?.orgData.status

            console.log("userInfoRegister---refresh.....")
            if (data.isSelf) {
                return
            }
            console.log("userInfoRegister---refresh2.....", channelInfo)

            const rows = new Array()
            if (relation === UserRelation.friend) {
                rows.push(new Row({
                    cell: ListItem,
                    properties: {
                        title: "解除好友关系",
                        onClick: () => {
                            WKApp.shared.baseContext.showAlert({
                                content: `将联系人“${channelInfo?.orgData?.displayName}”删除，同时删除与该联系人的聊天记录`,
                                onOk: () => {
                                    WKApp.dataSource.commonDataSource.deleteFriend(data.uid).then(() => {
                                        const channel = new Channel(data.uid, ChannelTypePerson)
                                        const conversation = WKSDK.shared().conversationManager.findConversation(channel)
                                        if (conversation) {
                                            WKApp.conversationProvider.clearConversationMessages(conversation)
                                        }
                                        WKSDK.shared().conversationManager.removeConversation(channel)
                                        WKApp.endpointManager.invoke(EndpointID.clearChannelMessages, channel)

                                        WKSDK.shared().channelManager.fetchChannelInfo(new Channel(data.uid, ChannelTypePerson))

                                    }).catch((err) => {
                                        Toast.error(err.msg)
                                    })


                                }
                            })
                        }
                    }
                }))
            }

            rows.push(new Row({
                cell: ListItem,
                properties: {
                    title: status === UserRelation.blacklist ? "拉出黑名单" : "拉入黑名单",
                    onClick: () => {
                        if (status === UserRelation.blacklist) {
                            WKApp.dataSource.commonDataSource.blacklistRemove(data.uid).then(() => {
                                WKApp.dataSource.contactsSync()
                            }).catch((err) => {
                                Toast.error(err.msg)
                            })
                        } else {
                            WKApp.shared.baseContext.showAlert({
                                content: "加入黑名单，你将不再收到对方的消息。",
                                onOk: () => {
                                    WKApp.dataSource.commonDataSource.blacklistAdd(data.uid).then(() => {
                                        WKApp.dataSource.contactsSync()
                                    }).catch((err) => {
                                        Toast.error(err.msg)
                                    })
                                }
                            })
                        }

                    }
                }
            }))

            // rows.push(new Row({
            //     cell: ListItem,
            //     properties: {
            //         title: "投诉",
            //     }
            // }))
            console.log("userInfoRegister---refresh3.....", rows)
            return new Section({
                rows: rows
            })
        })

        WKApp.shared.userInfoRegister("userinfo.source", (context: RouteContext<UserInfoRouteData>) => {
            const data = context.routeData()
            const channelInfo = data.channelInfo
            const relation = channelInfo?.orgData?.follow
            if (data.isSelf) {
                return
            }
            if (relation !== UserRelation.friend) {
                return
            }
            return new Section({
                rows: [
                    new Row({
                        cell: ListItem,
                        properties: {
                            title: "来源",
                            subTitle: `${channelInfo?.orgData?.source_desc}`,
                        }
                    }),
                ]
            })
        })

        WKApp.shared.userInfoRegister("userinfo.blacklist.tip", (context: RouteContext<UserInfoRouteData>) => {
            const data = context.routeData()
            const channelInfo = data.channelInfo
            const status = channelInfo?.orgData?.status
            if (data.isSelf) {
                return
            }
            if (status !== UserRelation.blacklist) {
                return
            }
            return new Section({
                rows: [
                    new Row({
                        cell: ListItemTip,
                        properties: {
                            tip: <div style={{ "display": "flex", "width": "100%", "alignItems": "center", "justifyContent": "center" }}><IconAlertCircle size="small" style={{ "marginRight": "4px", "color": "red" }} />已添加至黑名单，你将不再收到对方的消息</div>,
                        }
                    }),
                ]
            })
        }, 99999)
    }

    inputEditPush(context: RouteContext<any>, defaultValue: string, onFinish: (value: string) => Promise<void>, placeholder?: string, maxCount?: number, allowEmpty?: boolean, allowWrap?: boolean) {
        let value: string
        let finishButtonContext: FinishButtonContext
        context.push(<InputEdit defaultValue={defaultValue} placeholder={placeholder} onChange={(v, exceeded) => {
            value = v
            if (!allowEmpty && (!value || value === "")) {
                finishButtonContext.disable(true)
            } else {
                finishButtonContext.disable(false)
            }
            if (exceeded) {
                finishButtonContext.disable(true)
            }
        }} maxCount={maxCount} allowWrap={allowWrap}></InputEdit>, new RouteContextConfig({
            showFinishButton: true,
            onFinishContext: (finishBtnContext) => {
                finishButtonContext = finishBtnContext
                finishBtnContext.disable(true)
            },
            onFinish: async () => {
                finishButtonContext.loading(true)
                await onFinish(value)
                finishButtonContext.loading(false)

                context.pop()
            }
        }))
    }

    registerChannelSettings() {

        WKApp.shared.channelSettingRegister("channel.subscribers", (context) => {
            const data = context.routeData() as ChannelSettingRouteData
            const channel = data.channel

            if (channel.channelType == ChannelTypeCustomerService) {
                return
            }

            let addFinishButtonContext: FinishButtonContext
            let removeFinishButtonContext: FinishButtonContext
            let addSelectItems: IndexTableItem[]
            let removeSelectItems: IndexTableItem[]
            const disableSelectList = data.subscribers.map((subscriber) => {
                return subscriber.uid
            })
            return new Section({
                rows: [
                    new Row({
                        cell: Subscribers,
                        properties: {
                            context: context,
                            key: channel.getChannelKey(),
                            onAdd: () => {
                                context.push(<ContactsSelect onSelect={(items) => {
                                    addSelectItems = items
                                    addFinishButtonContext.disable(items.length === 0)
                                }} disableSelectList={disableSelectList} ></ContactsSelect>, {
                                    title: "联系人选择",
                                    showFinishButton: true,
                                    onFinish: async () => {
                                        addFinishButtonContext.loading(true)

                                        if (channel.channelType === ChannelTypePerson) {
                                            const uids = new Array()
                                            uids.push(WKApp.loginInfo.uid || "")
                                            uids.push(channel.channelID)
                                            for (const item of addSelectItems) {
                                                uids.push(item.id)
                                            }

                                            const result = await WKApp.dataSource.channelDataSource.createChannel(uids).catch((err) => {
                                                Toast.error(err.msg)
                                            })
                                            if (result) {
                                                WKApp.endpoints.showConversation(new Channel(result.group_no, ChannelTypeGroup))
                                            }
                                        } else {
                                            await WKApp.dataSource.channelDataSource.addSubscribers(channel, addSelectItems.map((item) => {
                                                return item.id
                                            }))
                                            context.pop()
                                        }
                                        addFinishButtonContext.loading(false)

                                    },
                                    onFinishContext: (context) => {
                                        console.log("onFinishContext------>", context)
                                        addFinishButtonContext = context
                                        addFinishButtonContext.disable(true)
                                    }
                                })
                            },
                            onRemove: () => {
                                context.push(<UserSelect onSelect={(items) => {
                                    removeSelectItems = items
                                    removeFinishButtonContext.disable(items.length === 0)
                                }} users={data.subscribers.filter((subscriber) => subscriber.uid !== WKApp.loginInfo.uid).map((item) => {
                                    return new IndexTableItem(item.uid, item.name, item.avatar)
                                })}></UserSelect>, {
                                    title: "删除群成员",
                                    showFinishButton: true,
                                    onFinish: async () => {
                                        removeFinishButtonContext.loading(true)
                                        await WKApp.dataSource.channelDataSource.removeSubscribers(channel, removeSelectItems.map((item) => {
                                            return item.id
                                        }))
                                        removeFinishButtonContext.loading(false)
                                        context.pop()
                                    },
                                    onFinishContext: (context) => {
                                        removeFinishButtonContext = context
                                        removeFinishButtonContext.disable(true)
                                    }
                                })
                            }
                        }
                    })
                ],
            })
        })

        WKApp.shared.channelSettingRegister("channel.base.setting", (context) => {
            const data = context.routeData() as ChannelSettingRouteData
            const channelInfo = data.channelInfo
            const channel = data.channel
            if (channel.channelType !== ChannelTypeGroup) {
                return undefined
            }
            const rows = new Array()
            rows.push(new Row({
                cell: ListItem,
                properties: {
                    title: "群聊名称",
                    subTitle: channelInfo?.title,
                    onClick: () => {
                        if (!data.isManagerOrCreatorOfMe) {
                            Toast.warning("只有管理者才能修改群名字")
                            return
                        }
                        this.inputEditPush(context, channelInfo?.title || "", (value: string) => {
                            return WKApp.dataSource.channelDataSource.updateField(channel, ChannelField.channelName, value).catch((err) => {
                                Toast.error(err.msg)
                            })
                        }, "群名称", 20)
                    }
                },
            }))

            rows.push(new Row({
                cell: ListItemIcon,
                properties: {
                    title: "群头像",
                    icon: <img style={{ "width": "24px", "height": "24px", "borderRadius": "50%" }} src={WKApp.shared.avatarChannel(channel)}></img>,
                    onClick: () => {
                        context.push(<ChannelAvatar showUpload={data.isManagerOrCreatorOfMe} channel={channel} context={context} ></ChannelAvatar>, { title: "群头像" })
                    }
                },
            }))

            rows.push(new Row({
                cell: ListItemIcon,
                properties: {
                    title: "群二维码",
                    icon: <img style={{ "width": "24px", "height": "24px" }} src={require("./assets/icon_qrcode.png").default}></img>,
                    onClick: () => {
                        context.push(<ChannelQRCode channel={channel}></ChannelQRCode>, new RouteContextConfig({
                            title: "群二维码名片",
                        }))
                    }
                },
            }))
            rows.push(new Row({
                cell: ListItemMuliteLine,
                properties: {
                    title: "群公告",
                    subTitle: channelInfo?.orgData?.notice,
                    onClick: () => {
                        if (!data.isManagerOrCreatorOfMe) {
                            Toast.warning("只有管理者才能修改群公告")
                            return
                        }
                        this.inputEditPush(context, channelInfo?.orgData?.notice || "", (value: string) => {
                            return WKApp.dataSource.channelDataSource.updateField(channel, ChannelField.notice, value).catch((err) => {
                                Toast.error(err.msg)
                            })
                        }, "群公告", 400, false, true)
                    }
                },
            }))

            return new Section({
                rows: rows,
            })
        }, 1000)



        WKApp.shared.channelSettingRegister("channel.base.setting2", (context) => {
            const data = context.routeData() as ChannelSettingRouteData
            const channelInfo = data.channelInfo
            const channel = data.channel
            const rows = new Array<Row>()

            if (channel.channelType == ChannelTypeCustomerService) {
                return
            }

            rows.push(new Row({
                cell: ListItemSwitch,
                properties: {
                    title: "消息免打扰",
                    checked: channelInfo?.mute,
                    onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
                        ctx.loading = true
                        ChannelSettingManager.shared.mute(v, channel).then(() => {
                            ctx.loading = false
                            data.refresh()
                        }).catch(() => {
                            ctx.loading = false
                        })
                    }
                },
            }))

            rows.push(new Row({
                cell: ListItemSwitch,
                properties: {
                    title: "聊天置顶",
                    checked: channelInfo?.top,
                    onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
                        ctx.loading = true
                        ChannelSettingManager.shared.top(v, channel).then(() => {
                            ctx.loading = false
                            data.refresh()
                        }).catch(() => {
                            ctx.loading = false
                        })
                    }
                },
            }))

            if (channel.channelType == ChannelTypeGroup) {
                rows.push(new Row({
                    cell: ListItemSwitch,
                    properties: {
                        title: "保存到通讯录",
                        checked: channelInfo?.orgData.save === 1,
                        onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
                            ctx.loading = true
                            ChannelSettingManager.shared.save(v, channel).then(() => {
                                ctx.loading = false
                                data.refresh()
                            }).catch(() => {
                                ctx.loading = false
                            })
                        }
                    },
                }))
            }
            return new Section({
                rows: rows,
            })
        }, 3000)



        WKApp.shared.channelSettingRegister("channel.base.setting3", (context) => {
            const data = context.routeData() as ChannelSettingRouteData
            if (data.channel.channelType !== ChannelTypeGroup) {
                return undefined
            }

            let name = data.subscriberOfMe?.remark
            if (!name || name === "") {
                name = data.subscriberOfMe?.name
            }

            return new Section({
                rows: [
                    new Row({
                        cell: ListItem,
                        properties: {
                            title: "我在本群的昵称",
                            subTitle: name,
                            onClick: () => {
                                this.inputEditPush(context, name || "", (value: string) => {
                                    return WKApp.dataSource.channelDataSource.subscriberAttrUpdate(data.channel, WKApp.loginInfo.uid || "", { "remark": value })
                                }, "在这里可以设置你在这个群里的昵称。这个昵称只会在此群内显示。", 10, true)
                            }
                        },
                    }),
                ],
            })
        }, 4000)

        // WKApp.shared.channelSettingRegister("channel.notify.setting.screen", (context) => {
        //     return new Section({
        //         subtitle: "在对话中的截屏，各方均会收到通知",
        //         rows: [
        //             new Row({
        //                 cell: ListItemSwitch,
        //                 properties: {
        //                     title: "截屏通知",
        //                 },
        //             }),
        //         ],
        //     })
        // })
        // WKApp.shared.channelSettingRegister("channel.notify.setting.revokemind", (context) => {
        //     return new Section({
        //         subtitle: "在对话中的消息撤回，各方均会收到通知",
        //         rows: [
        //             new Row({
        //                 cell: ListItemSwitch,
        //                 properties: {
        //                     title: "撤回通知",
        //                 },
        //             }),
        //         ],
        //     })
        // })
        // WKApp.shared.channelSettingRegister("channel.base.setting5", (context) => {
        //     return new Section({
        //         rows: [
        //             new Row({
        //                 cell: ListItem,
        //                 properties: {
        //                     title: "投诉",
        //                 },
        //             }),
        //         ],
        //     })
        // })

        WKApp.shared.channelSettingRegister("channel.base.setting6", (context) => {
            const data = context.routeData() as ChannelSettingRouteData
            if (data.channel.channelType !== ChannelTypeGroup) {
                return undefined
            }
            return new Section({
                rows: [
                    new Row({
                        cell: ListItemButton,
                        properties: {
                            title: "清空聊天记录",
                            type: ListItemButtonType.warn,
                            onClick: () => {
                                WKApp.shared.baseContext.showAlert({
                                    content: "是否清空此会话的所有消息？",
                                    onOk: async () => {
                                        const conversation = WKSDK.shared().conversationManager.findConversation(data.channel)
                                        if (!conversation) {
                                            return
                                        }
                                        await WKApp.conversationProvider.clearConversationMessages(conversation)
                                        conversation.lastMessage = undefined
                                        WKApp.endpointManager.invoke(EndpointID.clearChannelMessages, data.channel)
                                    }
                                })
                            }
                        },
                    }),
                    new Row({
                        cell: ListItemButton,
                        properties: {
                            title: "删除并退出",
                            type: ListItemButtonType.warn,
                            onClick: () => {
                                WKApp.shared.baseContext.showAlert({
                                    content: "退出后不会通知群里其他成员，且不会再接收此群聊消息",
                                    onOk: async () => {
                                        WKApp.dataSource.channelDataSource.exitChannel(data.channel).catch((err) => {
                                            Toast.error(err.msg)
                                        })
                                        WKApp.conversationProvider.deleteConversation(data.channel)
                                    }
                                })
                            }
                        },
                    }),
                ],
            })
        }, 90000)
    }

    registerChannelManages() {
        WKApp.shared.channelManageRegister("channel.setting.manage.invite", (context) => {
            const data = context.routeData() as ChannelSettingRouteData
            const channel = data.channel
            const channelInfo = data.channelInfo
            return new Section({
                subtitle: "启用后，群成员需要群主或管理员确认才能邀请朋友进群。扫描二维码进群将同时停用。",
                rows: [
                    new Row({
                        cell: ListItemSwitch,
                        properties: {
                            title: "群聊邀请确认",
                            checked: channelInfo?.orgData?.invite === 1,
                            onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
                                ctx.loading = true
                                ChannelSettingManager.shared.invite(v, channel).then(() => {
                                    ctx.loading = false
                                    data.refresh()
                                }).catch((err) => {
                                    ctx.loading = false
                                })
                            }
                        },
                    }),
                ],
            });
        })

        WKApp.shared.channelManageRegister("channel.setting.manage.transfer", (context) => {
            const data = context.routeData() as ChannelSettingRouteData
            const channel = data.channel
            const subscriberOfMe = data.subscriberOfMe
            if (!subscriberOfMe || subscriberOfMe.role !== GroupRole.owner) {
                return
            }
            return new Section({
                rows: [
                    new Row({
                        cell: ListItem,
                        properties: {
                            title: "群主管理权转让",
                            onClick: () => {
                                context.push(<UserSelect cantMulit={true} onSelect={(items) => {
                                    const item = items[0]
                                    WKApp.shared.baseContext.showAlert({
                                        content: "你将自动放弃群主身份",
                                        onOk: () => {
                                            WKApp.dataSource.channelDataSource.channelTransferOwner(channel, item.id).then(() => {
                                                context.popToRoot()
                                            }).catch((err) => {
                                                Toast.error(err.msg)
                                            })
                                        }
                                    })
                                }} users={data.subscribers.filter((subscriber) => !(subscriber.uid === WKApp.loginInfo.uid || subscriber.uid === WKApp.config.fileHelperUID || subscriber.uid === WKApp.config.systemUID)).map((item) => {
                                    return new IndexTableItem(item.uid, item.name, item.avatar)
                                })}></UserSelect>, {
                                    title: "选择新的群主",
                                    showFinishButton: false,
                                    onFinish: async () => {

                                        context.pop()
                                    },
                                    onFinishContext: (context) => {
                                    }
                                })
                            }
                        },
                    }),
                ],
            });
        })

        WKApp.shared.channelManageRegister("channel.setting.manage.mute", (context) => {
            const data = context.routeData() as ChannelSettingRouteData
            const channel = data.channel
            const channelInfo = data.channelInfo
            return new Section({
                title: "成员设置",
                subtitle: "全员禁言启用后，只允许群主和管理员发言。",
                rows: [
                    new Row({
                        cell: ListItemSwitch,
                        properties: {
                            title: "全员禁言",
                            checked: channelInfo?.orgData?.forbidden === 1,
                            onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
                                ctx.loading = true
                                ChannelSettingManager.shared.forbidden(v, channel).then(() => {
                                    ctx.loading = false
                                    data.refresh()
                                }).catch((err) => {
                                    ctx.loading = false
                                })
                            }
                        },
                    }),
                ],
            });
        })

        WKApp.shared.channelManageRegister("channel.setting.manage.prohibitAddFriend", (context) => {
            const data = context.routeData() as ChannelSettingRouteData
            const channel = data.channel
            const channelInfo = data.channelInfo
            return new Section({
                rows: [
                    new Row({
                        cell: ListItemSwitch,
                        properties: {
                            title: "禁止群成员互加好友",
                            checked: channelInfo?.orgData?.forbidden_add_friend === 1,
                            onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
                                ctx.loading = true
                                ChannelSettingManager.shared.forbiddenAddFriend(v, channel).then(() => {
                                    ctx.loading = false
                                    data.refresh()
                                }).catch((err) => {
                                    ctx.loading = false
                                })
                            }
                        },
                    }),
                ],
            });
        })
        WKApp.shared.channelManageRegister("channel.setting.manage.blacklist", (context) => {
            return new Section({
                rows: [
                    new Row({
                        cell: ListItem,
                        properties: {
                            title: "群黑名单",
                            onClick: () => {
                                context.push(<ChannelBlacklist routeContext={context}></ChannelBlacklist>, {
                                    title: "群黑名单",
                                })
                            }
                        },
                    }),
                ],
            });
        })
        WKApp.shared.channelManageRegister("channel.setting.manage.managerlist", (context) => {
            const data = context.routeData() as ChannelSettingRouteData
            const subscriberOfMe = data.subscriberOfMe
            if (subscriberOfMe?.role !== GroupRole.owner) {
                return
            }
            return new Section({
                title: "群主、管理员",
                rows: [
                    new Row({
                        cell: ChannelManagerList,
                        properties: {
                            routeContext: context,
                        },
                    }),
                ],
            });
        })
    }
}
