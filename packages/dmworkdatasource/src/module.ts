import { Convert, GroupRole, IModule, WKApp, hasSpacePrefix, ChannelTypeCommunityTopic, parseThreadChannelId } from "@octo/base"
import { Channel, ChannelInfo, ChannelTypeGroup, ChannelTypePerson, Conversation, WKSDK, Message, Subscriber, ConversationExtra, Reminder } from "wukongimjssdk";
import { MessageTask } from "wukongimjssdk";
import { ConversationProvider } from "./conversation";
import { ChannelDataSource, CommonDataSource } from "./datasource";
import { MediaMessageUploadTask } from "./task";

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
        WKSDK.shared().config.provider.channelInfoCallback = async function (channel: Channel): Promise<ChannelInfo> {
            let channelInfo = new ChannelInfo(),
                isUsers = channel.channelType === ChannelTypePerson;

            // 子区频道特殊处理
            if (channel.channelType === ChannelTypeCommunityTopic) {
                const parsed = parseThreadChannelId(channel.channelID);
                if (!parsed) {
                    channelInfo.channel = channel;
                    channelInfo.title = channel.channelID;
                    channelInfo.orgData = {};
                    return channelInfo;
                }
                try {
                    const thread = await WKApp.dataSource.channelDataSource.threadGet(parsed.groupNo, parsed.shortId);
                    channelInfo.channel = channel;
                    channelInfo.title = thread.name;
                    channelInfo.logo = `groups/${parsed.groupNo}/avatar`; // 使用父群头像
                    // channelInfo.mute 供 SDK listener 触发组件重渲染：
                    // 显式 mute=1 → true；其余（null 或 0）→ false
                    // effectiveMute 逻辑从 orgData.thread.mute 读 tri-state 原始值
                    channelInfo.mute = thread.mute === 1
                    channelInfo.orgData = {
                        displayName: thread.name,
                        thread: thread,
                        parentGroupNo: parsed.groupNo,
                        // GROUP.md 字段透传
                        has_thread_md: thread.has_thread_md,
                        thread_md_version: thread.thread_md_version,
                        thread_md_updated_at: thread.thread_md_updated_at,
                    };
                    return channelInfo;
                } catch (err) {
                    console.warn(`thread info not found: ${channel.channelID}`);
                    channelInfo.channel = channel;
                    channelInfo.title = channel.channelID;
                    channelInfo.orgData = {};
                    return channelInfo;
                }
            }

            const realUID = DataSourceModule.extractUID(channel.channelID);
            let resp: any;
            try {
                resp = await WKApp.apiClient.get(`channels/${realUID}/${channel.channelType}`);
            } catch (err) {
                // channel 不存在（400/404）或无权限访问：返回空 ChannelInfo，不重试。
                // title 不能用 channel.channelID（32 位 hex uid）兜底，否则渲染层会把
                // uid 当名字展示给用户；而上游 SDK 一旦缓存成功就不会再 fetch，导致
                // "一直显示 uid 直到刷新" 的 bug。群消息场景渲染层会优先从群成员列表
                // 取名字，这里留空不影响正常展示。
                console.warn(`channel info not found: ${channel.channelID}/${channel.channelType}`);
                channelInfo.channel = channel;
                channelInfo.title = "";
                channelInfo.orgData = {};
                return channelInfo;
            }

            const data = resp

            channelInfo.channel = new Channel(data.channel.channel_id, data.channel.channel_type);
            channelInfo.title = data.name;
            channelInfo.mute = data.mute === 1;
            channelInfo.top = data.stick === 1;
            channelInfo.online = data.online === 1;
            channelInfo.lastOffline = data.last_offline
            channelInfo.logo = data.logo
            if (!channelInfo.logo || channelInfo.logo === "") {
                if (channel.channelType === ChannelTypePerson) {
                    channelInfo.logo = `users/${realUID}/avatar`
                } else if (channel.channelType === ChannelTypeGroup) {
                    channelInfo.logo = `groups/${channel.channelID}/avatar`
                }
            }

            channelInfo.orgData = data.extra || {};
            channelInfo.orgData.remark = data.remark ?? "";
            channelInfo.orgData.displayName = data.remark && data.remark !== "" ? data.remark : channelInfo.title;

            channelInfo.orgData.receipt = data.receipt;
            // channels 接口可能不返回 robot 字段，从群成员缓存兜底
            if (data.robot != null) {
                channelInfo.orgData.robot = data.robot;
            } else if (channel.channelType === ChannelTypePerson) {
                // 遍历所有群的成员缓存，查找该 uid 是否标记为 robot
                const allSubscribers = WKSDK.shared().channelManager.subscribeCacheMap
                for (const subscribers of allSubscribers.values()) {
                    const matched = subscribers.find(s => s.uid === channel.channelID && s.orgData?.robot === 1)
                    if (matched) {
                        channelInfo.orgData.robot = 1
                        break
                    }
                }
            }
            channelInfo.orgData.status = data.status;
            channelInfo.orgData.follow = data.follow;
            channelInfo.orgData.category = data.category;
            channelInfo.orgData.be_deleted = data.be_deleted;
            channelInfo.orgData.be_blacklist = data.be_blacklist;
            channelInfo.orgData.notice = data.notice;

            if (channel.channelType === ChannelTypePerson) {
                channelInfo.orgData.shortNo = data.extra?.short_no ?? ""
            } else if (channel.channelType === ChannelTypeGroup) {
                channelInfo.orgData.forbidden = data.forbidden;
                channelInfo.orgData.invite = data.invite;
                channelInfo.orgData.forbiddenAddFriend = data.extra?.forbidden_add_friend;
                channelInfo.orgData.save = data.save;
                // 群级「允许免@回答」总开关：老数据无字段时回退 1（允许），零回归。
                channelInfo.orgData.allow_no_mention = (data.allow_no_mention ?? data.extra?.allow_no_mention) ?? 1;
                channelInfo.orgData.has_group_md = !!(data.has_group_md ?? data.extra?.has_group_md);
                channelInfo.orgData.group_md_version = data.group_md_version || data.extra?.group_md_version || 0;
                channelInfo.orgData.group_md_updated_at = data.group_md_updated_at || data.extra?.group_md_updated_at || null;
                channelInfo.orgData.can_edit_group_md = !!(data.can_edit_group_md ?? data.extra?.can_edit_group_md);
                channelInfo.orgData.can_manage_bot_admin = !!(data.can_manage_bot_admin ?? data.extra?.can_manage_bot_admin);
            }
            if (data.category === "system" || data.category === "customerService") { // 官方账号
                channelInfo.orgData.identityIcon = "./identity_icon/official.png"
                channelInfo.orgData.identitySize = { width: "18px", height: "18px" }
            } else if (data.category === "visitor") {
                channelInfo.orgData.identityIcon = "./identity_icon/visitor.png"
                channelInfo.orgData.identitySize = { width: "48px", height: "24px" }
            }
            // Note: robot/bot identities use <AiBadge /> component, not identityIcon

            return channelInfo
        }
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
