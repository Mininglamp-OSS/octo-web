import { Convert, IModule, WKApp, hasSpacePrefix, ChannelTypeCommunityTopic } from "@octo/base"
import { Channel, ChannelTypePerson, WKSDK, Message } from "wukongimjssdk";
import { MessageTask } from "wukongimjssdk";
import { ConversationProvider } from "./conversation";
import { ChannelDataSource, CommonDataSource } from "./datasource";
import { MediaMessageUploadTask } from "./task";
import { createChannelInfoCallback } from "./im-callbacks/channelInfo";
import { createSyncConversationExtrasCallback } from "./im-callbacks/conversationExtras";
import { createSyncConversationsCallback } from "./im-callbacks/conversations";
import { createSyncMessageExtraCallback } from "./im-callbacks/messageExtras";
import { createSyncRemindersCallback } from "./im-callbacks/reminders";
import { createSyncSubscribersCallback } from "./im-callbacks/subscribers";

export default class DataSourceModule implements IModule {
    id(): string {
        return "DataSource"
    }
    init(): void {

        WKApp.conversationProvider = new ConversationProvider()

        WKApp.dataSource.channelDataSource = new ChannelDataSource()
        WKApp.dataSource.commonDataSource = new CommonDataSource()

        this.setChannelInfoCallback() // 频道信息
        this.setSyncSubscribersCallback() // 订阅者同步
        this.setMessageUploadTaskCallback() // 消息上传任务
        this.setSyncConversationsCallback()  // 最近会话
        this.setSyncConversationExtrasCallback() // 最近会话扩展
        this.setSyncMessageExtraCallback() // 消息扩展
        this.setSyncRemindersCallback() // 同步提醒
        this.setReminderDoneCallback() // 提醒项完成
        this.setMessageReadedCallback() // 消息已读未读
    }

    // 从 Space channel_id (s{spaceId}_{uid}) 中提取真实 uid
    static extractUID(channelID: string): string {
        if (hasSpacePrefix(channelID)) {
            const idx = channelID.indexOf('_')
            return channelID.substring(idx + 1)
        }
        return channelID
    }

    setChannelInfoCallback() {
        WKSDK.shared().config.provider.channelInfoCallback = createChannelInfoCallback({
            getChannel: (path) => WKApp.apiClient.get(path),
            threadGet: (groupNo, shortId) =>
                WKApp.dataSource.channelDataSource.threadGet(groupNo, shortId),
            extractUID: DataSourceModule.extractUID,
            getSubscribeCacheMap: () => WKSDK.shared().channelManager.subscribeCacheMap,
        })
    }

    setSyncSubscribersCallback() {
        WKSDK.shared().config.provider.syncSubscribersCallback = createSyncSubscribersCallback({
            getMembers: (path) => WKApp.apiClient.get(path),
            avatarUser: (uid) => WKApp.shared.avatarUser(uid),
            getPersonChannelInfo: (uid) =>
                WKSDK.shared().channelManager.getChannelInfo(new Channel(uid, ChannelTypePerson)),
            setChannelInfoForCache: (channelInfo) =>
                WKSDK.shared().channelManager.setChannleInfoForCache(channelInfo),
        })
    }

    setMessageUploadTaskCallback() {
        // 消息上传任务
        WKSDK.shared().config.provider.messageUploadTaskCallback = (message: Message): MessageTask => {
            return new MediaMessageUploadTask(message)
        }
    }

    setSyncConversationExtrasCallback() {
        WKSDK.shared().config.provider.syncConversationExtrasCallback =
            createSyncConversationExtrasCallback({
                postConversationExtrasSync: (path, body) => WKApp.apiClient.post(path, body),
                toConversationExtra: (channel, conversationExtraMap) =>
                    Convert.toConversationExtra(channel, conversationExtraMap),
            })
    }

    setSyncMessageExtraCallback() {
        WKSDK.shared().config.provider.syncMessageExtraCallback = createSyncMessageExtraCallback({
            syncMessageExtras: (channel, extraVersion, limit) =>
                WKApp.conversationProvider.syncMessageExtras(channel, extraVersion, limit),
        })
    }

    setSyncRemindersCallback() {
        WKSDK.shared().config.provider.syncRemindersCallback = createSyncRemindersCallback({
            getConversations: () => WKSDK.shared().conversationManager.conversations,
            postReminderSync: (path, body) => WKApp.apiClient.post(path, body),
            toReminder: (reminderMap) => Convert.toReminder(reminderMap),
        })
    }

    setReminderDoneCallback() {
        WKSDK.shared().config.provider.reminderDoneCallback = async (ids: number[]) => {
            return WKApp.apiClient.post("message/reminder/done", ids)
        }
    }

    setMessageReadedCallback() {
        WKSDK.shared().config.provider.messageReadedCallback = async (channel: Channel, messages: Message[]) => {
            const messageIDs = []
            if (messages && messages.length > 0) {
                for (const message of messages) {
                    messageIDs.push(message.messageID)
                }
            }
            return WKApp.apiClient.post("message/readed", { "channel_id": channel.channelID, "channel_type": channel.channelType, "message_ids": messageIDs }).catch((err) => {
            })
        }
    }

    setSyncConversationsCallback() {
        WKSDK.shared().config.provider.syncConversationsCallback = createSyncConversationsCallback({
            postConversationSync: (path, body) => WKApp.apiClient.post(path, body),
            getCurrentSpaceId: () => WKApp.shared.currentSpaceId || "",
            setChannelSpace: (key, spaceId) => WKApp.shared.channelSpaceMap.set(key, spaceId),
            setChannelMySourceSpace: (key, sourceSpaceId) =>
                WKApp.shared.channelMySourceSpaceMap.set(key, sourceSpaceId),
            toConversation: (conversationMap) => Convert.toConversation(conversationMap),
            toUserChannelInfo: (user) => Convert.userToChannelInfo(user),
            toGroupChannelInfo: (group) => Convert.groupToChannelInfo(group),
            setChannelInfoForCache: (channelInfo) =>
                WKSDK.shared().channelManager.setChannleInfoForCache(channelInfo),
        })
    }
}
