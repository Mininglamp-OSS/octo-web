import { ChannelTypeCommunityTopic, GroupRole, parseThreadChannelId } from "@octo/base"
import { Channel, ChannelInfo, Subscriber } from "wukongimjssdk"

export interface SyncSubscribersCallbackDeps {
    getMembers: (path: string) => Promise<any>
    avatarUser: (uid: string) => string
    getPersonChannelInfo: (uid: string) => ChannelInfo | undefined
    setChannelInfoForCache: (channelInfo: ChannelInfo) => void
}

function toSubscriber(memberMap: any, avatarUser: (uid: string) => string): Subscriber {
    const member = new Subscriber()
    member.uid = memberMap.uid
    member.name = memberMap.name
    member.remark = memberMap.remark
    member.role = memberMap.role
    member.version = memberMap.version
    member.isDeleted = memberMap.is_deleted
    member.status = memberMap.status
    member.orgData = memberMap
    member.orgData.bot_admin = memberMap.bot_admin || 0
    member.avatar = avatarUser(member.uid)
    return member
}

export function createSyncSubscribersCallback(deps: SyncSubscribersCallbackDeps) {
    return async function syncSubscribersCallback(
        channel: Channel,
        version: number,
    ): Promise<Array<Subscriber>> {
        // 子区（ChannelTypeCommunityTopic）使用父群聊 ID 拉取成员列表
        let groupId = channel.channelID
        if (channel.channelType === ChannelTypeCommunityTopic) {
            const parsed = parseThreadChannelId(channel.channelID)
            if (parsed) {
                groupId = parsed.groupNo
            }
        }
        const resp = await deps.getMembers(`groups/${groupId}/membersync?version=${version}&limit=10000`)
        const members = []
        if (resp) {
            for (let i = 0; i < resp.length; i++) {
                const memberMap = resp[i]
                members.push(toSubscriber(memberMap, deps.avatarUser))
            }
        }
        members.sort((a, b) => {
            const roleA = a.role === GroupRole.owner ? 999 : a.role
            const roleB = b.role === GroupRole.owner ? 999 : b.role
            return roleB - roleA
        })

        // 将 robot 字段同步到 person channelInfo 缓存，确保消息列表能正确显示 AI 标识
        for (const member of members) {
            if (member.orgData?.robot === 1) {
                const existing = deps.getPersonChannelInfo(member.uid)
                if (existing) {
                    existing.orgData = existing.orgData || {}
                    existing.orgData.robot = 1
                    deps.setChannelInfoForCache(existing)
                }
            }
        }

        return members
    }
}
