import { ChannelTypeCommunityTopic, parseThreadChannelId } from "@octo/base"
import {
    Channel,
    ChannelInfo,
    ChannelTypeGroup,
    ChannelTypePerson,
    Subscriber,
} from "wukongimjssdk"

export interface ChannelInfoCallbackDeps {
    getChannel: (path: string) => Promise<any>
    threadGet: (groupNo: string, shortId: string) => Promise<any>
    extractUID: (channelID: string) => string
    getSubscribeCacheMap: () => Map<string, Subscriber[]>
    warn?: (message?: any, ...optionalParams: any[]) => void
}

export function createChannelInfoCallback(deps: ChannelInfoCallbackDeps) {
    const warn = deps.warn || console.warn

    return async function channelInfoCallback(channel: Channel): Promise<ChannelInfo> {
        const channelInfo = new ChannelInfo()

        // 子区频道特殊处理
        if (channel.channelType === ChannelTypeCommunityTopic) {
            const parsed = parseThreadChannelId(channel.channelID)
            if (!parsed) {
                channelInfo.channel = channel
                channelInfo.title = channel.channelID
                channelInfo.orgData = {}
                return channelInfo
            }
            try {
                const thread = await deps.threadGet(parsed.groupNo, parsed.shortId)
                channelInfo.channel = channel
                channelInfo.title = thread.name
                channelInfo.logo = `groups/${parsed.groupNo}/avatar`
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
                }
                return channelInfo
            } catch (err) {
                warn(`thread info not found: ${channel.channelID}`)
                channelInfo.channel = channel
                channelInfo.title = channel.channelID
                channelInfo.orgData = {}
                return channelInfo
            }
        }

        const realUID = deps.extractUID(channel.channelID)
        let resp: any
        try {
            resp = await deps.getChannel(`channels/${realUID}/${channel.channelType}`)
        } catch (err) {
            // channel 不存在（400/404）或无权限访问：返回空 ChannelInfo，不重试。
            // title 不能用 channel.channelID（32 位 hex uid）兜底，否则渲染层会把
            // uid 当名字展示给用户；而上游 SDK 一旦缓存成功就不会再 fetch，导致
            // "一直显示 uid 直到刷新" 的 bug。群消息场景渲染层会优先从群成员列表
            // 取名字，这里留空不影响正常展示。
            warn(`channel info not found: ${channel.channelID}/${channel.channelType}`)
            channelInfo.channel = channel
            channelInfo.title = ""
            channelInfo.orgData = {}
            return channelInfo
        }

        const data = resp

        channelInfo.channel = new Channel(data.channel.channel_id, data.channel.channel_type)
        channelInfo.title = data.name
        channelInfo.mute = data.mute === 1
        channelInfo.top = data.stick === 1
        channelInfo.online = data.online === 1
        channelInfo.lastOffline = data.last_offline
        channelInfo.logo = data.logo
        if (!channelInfo.logo || channelInfo.logo === "") {
            if (channel.channelType === ChannelTypePerson) {
                channelInfo.logo = `users/${realUID}/avatar`
            } else if (channel.channelType === ChannelTypeGroup) {
                channelInfo.logo = `groups/${channel.channelID}/avatar`
            }
        }

        channelInfo.orgData = data.extra || {}
        channelInfo.orgData.remark = data.remark ?? ""
        channelInfo.orgData.displayName =
            data.remark && data.remark !== "" ? data.remark : channelInfo.title

        channelInfo.orgData.receipt = data.receipt
        // channels 接口可能不返回 robot 字段，从群成员缓存兜底
        if (data.robot != null) {
            channelInfo.orgData.robot = data.robot
        } else if (channel.channelType === ChannelTypePerson) {
            // 遍历所有群的成员缓存，查找该 uid 是否标记为 robot
            const allSubscribers = deps.getSubscribeCacheMap()
            for (const subscribers of allSubscribers.values()) {
                const matched = subscribers.find(
                    (s) => s.uid === channel.channelID && s.orgData?.robot === 1
                )
                if (matched) {
                    channelInfo.orgData.robot = 1
                    break
                }
            }
        }
        channelInfo.orgData.status = data.status
        channelInfo.orgData.follow = data.follow
        channelInfo.orgData.category = data.category
        channelInfo.orgData.be_deleted = data.be_deleted
        channelInfo.orgData.be_blacklist = data.be_blacklist
        channelInfo.orgData.notice = data.notice

        if (channel.channelType === ChannelTypePerson) {
            channelInfo.orgData.shortNo = data.extra?.short_no ?? ""
        } else if (channel.channelType === ChannelTypeGroup) {
            channelInfo.orgData.forbidden = data.forbidden
            channelInfo.orgData.invite = data.invite
            channelInfo.orgData.forbiddenAddFriend = data.extra?.forbidden_add_friend
            channelInfo.orgData.save = data.save
            // 群级「允许免@回答」总开关：老数据无字段时回退 1（允许），零回归。
            channelInfo.orgData.allow_no_mention =
                (data.allow_no_mention ?? data.extra?.allow_no_mention) ?? 1
            channelInfo.orgData.has_group_md = !!(data.has_group_md ?? data.extra?.has_group_md)
            channelInfo.orgData.group_md_version =
                data.group_md_version || data.extra?.group_md_version || 0
            channelInfo.orgData.group_md_updated_at =
                data.group_md_updated_at || data.extra?.group_md_updated_at || null
            channelInfo.orgData.can_edit_group_md = !!(
                data.can_edit_group_md ?? data.extra?.can_edit_group_md
            )
            channelInfo.orgData.can_manage_bot_admin = !!(
                data.can_manage_bot_admin ?? data.extra?.can_manage_bot_admin
            )
        }
        if (data.category === "system" || data.category === "customerService") {
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
