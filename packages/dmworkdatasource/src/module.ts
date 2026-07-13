import { Convert, GroupRole, IModule, WKApp, hasSpacePrefix, ChannelTypeCommunityTopic, parseThreadChannelId } from "@octo/base"
import { Channel, ChannelTypeGroup, ChannelTypePerson, Conversation, WKSDK, Message, Subscriber, ConversationExtra, Reminder } from "wukongimjssdk";
import { MessageTask } from "wukongimjssdk";
import { ConversationProvider } from "./conversation";
import { ChannelDataSource, CommonDataSource } from "./datasource";
import { MediaMessageUploadTask } from "./task";
import { createChannelInfoCallback } from "./im-callbacks/channelInfo";

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
        WKSDK.shared().config.provider.syncSubscribersCallback = async function (channel: Channel, version: number): Promise<Array<Subscriber>> {
            // 子区（ChannelTypeCommunityTopic）使用父群聊 ID 拉取成员列表
            let groupId = channel.channelID
            if (channel.channelType === ChannelTypeCommunityTopic) {
                const parsed = parseThreadChannelId(channel.channelID)
                if (parsed) {
                    groupId = parsed.groupNo
                }
            }
            const resp = await WKApp.apiClient.get(`groups/${groupId}/membersync?version=${version}&limit=10000`);
            let members = [];
            if (resp) {
                for (let i = 0; i < resp.length; i++) {
                    let memberMap = resp[i];
                    let member = new Subscriber();
                    member.uid = memberMap.uid;
                    member.name = memberMap.name;
                    member.remark = memberMap.remark;
                    member.role = memberMap.role;
                    member.version = memberMap.version;
                    member.isDeleted = memberMap.is_deleted;
                    member.status = memberMap.status;
                    member.orgData = memberMap
                    member.orgData.bot_admin = memberMap.bot_admin || 0;
                    member.avatar = WKApp.shared.avatarUser(member.uid)
                    members.push(member);
                }
            }
            members.sort((a, b) => {
                const roleA = a.role === GroupRole.owner ? 999 : a.role;
                const roleB = b.role === GroupRole.owner ? 999 : b.role;
                return roleB - roleA;
            })

            // 将 robot 字段同步到 person channelInfo 缓存，确保消息列表能正确显示 AI 标识
            for (const member of members) {
                if (member.orgData?.robot === 1) {
                    const personChannel = new Channel(member.uid, ChannelTypePerson)
                    const existing = WKSDK.shared().channelManager.getChannelInfo(personChannel)
                    if (existing) {
                        existing.orgData = existing.orgData || {}
                        existing.orgData.robot = 1
                        WKSDK.shared().channelManager.setChannleInfoForCache(existing)
                    }
                }
            }

            return members;
        }
    }

    setMessageUploadTaskCallback() {
        // 消息上传任务
        WKSDK.shared().config.provider.messageUploadTaskCallback = (message: Message): MessageTask => {
            return new MediaMessageUploadTask(message)
        }
    }

    setSyncConversationExtrasCallback() {
        WKSDK.shared().config.provider.syncConversationExtrasCallback = async (version: number) => {
            let conversationExtras = new Array<ConversationExtra>();
            const results = await WKApp.apiClient.post("conversation/extra/sync", { "version": version })
            if (results) {
                for (const result of results) {
                    const channel = new Channel(result['channel_id'], result['channel_type'])
                    conversationExtras.push(Convert.toConversationExtra(channel, result))
                }
            }
            return conversationExtras
        }
    }

    setSyncMessageExtraCallback() {
        WKSDK.shared().config.provider.syncMessageExtraCallback = async (channel: Channel, extraVersion: number, limit: number) => {
            return WKApp.conversationProvider.syncMessageExtras(channel, extraVersion, limit)
        }
    }

    setSyncRemindersCallback() {
        WKSDK.shared().config.provider.syncRemindersCallback = async (version: number) => {
            let reminders = new Array<Reminder>();
            const channelIDs = new Array<string>()
            const conversations = WKSDK.shared().conversationManager.conversations
            if (conversations && conversations.length > 0) {
                for (const conversation of conversations) {
                    if (conversation.channel.channelType === ChannelTypeGroup || conversation.channel.channelType === ChannelTypeCommunityTopic) {
                        channelIDs.push(conversation.channel.channelID)
                    }
                }
            }
            const results = await WKApp.apiClient.post("message/reminder/sync", { "version": version, "limit": 100, "channel_ids": channelIDs })
            if (results) {
                for (const result of results) {
                    reminders.push(Convert.toReminder(result))
                }
            }
            return reminders
        }
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
        WKSDK.shared().config.provider.syncConversationsCallback = async (filter?: any): Promise<Array<Conversation>> => {
            let resp: any
            let conversations = new Array<Conversation>();
            const spaceId = WKApp.shared.currentSpaceId || ""
            const syncUrl = spaceId ? `conversation/sync?space_id=${encodeURIComponent(spaceId)}` : "conversation/sync"
            resp = await WKApp.apiClient.post(syncUrl, { "msg_count": 1, "recent_filter": true })
            if (resp) {
                // 防止快速切换 Space 时旧响应覆盖新缓存
                if (spaceId && WKApp.shared.currentSpaceId !== spaceId) return conversations
                // 只更新本次 sync 响应中包含的频道缓存，保留其他 Space 的缓存
                // （避免 clear() 导致切换 Space 后其他 Space 群聊缓存丢失）
                resp.conversations.forEach((conversationMap: any) => {
                    let model = Convert.toConversation(conversationMap);
                    conversations.push(model);
                    // 填充 channelSpaceMap / channelMySourceSpaceMap 缓存
                    // octo-server PR#154+ 在 conversation sync 响应里携带 resolved space_id
                    // （群表权威值）和 my_source_space_id（外部成员的 source Space）。
                    // 老后端字段为空时跳过，仍走 channelInfo.orgData / subscriber 兜底。
                    const key = `${conversationMap["channel_id"]}_${conversationMap["channel_type"]}`
                    const sid = conversationMap["space_id"]
                    if (sid) {
                        WKApp.shared.channelSpaceMap.set(key, sid)
                    }
                    const mySrc = conversationMap["my_source_space_id"]
                    if (mySrc) {
                        WKApp.shared.channelMySourceSpaceMap.set(key, mySrc)
                    }
                });
                const users = resp.users
                if (users && users.length > 0) {
                    for (const user of users) {
                        WKSDK.shared().channelManager.setChannleInfoForCache(Convert.userToChannelInfo(user))
                    }
                }
                const groups = resp.groups
                if (groups && groups.length > 0) {
                    for (const group of groups) {
                        WKSDK.shared().channelManager.setChannleInfoForCache(Convert.groupToChannelInfo(group))
                    }
                }
            }
            return conversations
        }
    }
}
