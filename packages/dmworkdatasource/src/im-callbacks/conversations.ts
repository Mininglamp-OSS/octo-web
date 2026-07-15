import { ChannelInfo, Conversation } from "wukongimjssdk"

export interface SyncConversationsCallbackDeps {
    postConversationSync: (path: string, body: Record<string, any>) => Promise<any>
    getCurrentSpaceId: () => string
    setChannelSpace: (key: string, spaceId: string) => void
    setChannelMySourceSpace: (key: string, sourceSpaceId: string) => void
    toConversation: (conversationMap: any) => Conversation
    toUserChannelInfo: (user: any) => ChannelInfo
    toGroupChannelInfo: (group: any) => ChannelInfo
    setChannelInfoForCache: (channelInfo: ChannelInfo) => void
}

export function createSyncConversationsCallback(deps: SyncConversationsCallbackDeps) {
    return async function syncConversationsCallback(_filter?: any): Promise<Array<Conversation>> {
        let resp: any
        const conversations = new Array<Conversation>()
        const spaceId = deps.getCurrentSpaceId() || ""
        const syncUrl = spaceId
            ? `conversation/sync?space_id=${encodeURIComponent(spaceId)}`
            : "conversation/sync"

        resp = await deps.postConversationSync(syncUrl, {
            "msg_count": 1,
            "recent_filter": true,
        })
        if (resp) {
            // 防止快速切换 Space 时旧响应覆盖新缓存
            if (spaceId && deps.getCurrentSpaceId() !== spaceId) return conversations
            // 只更新本次 sync 响应中包含的频道缓存，保留其他 Space 的缓存
            // （避免 clear() 导致切换 Space 后其他 Space 群聊缓存丢失）
            resp.conversations.forEach((conversationMap: any) => {
                const model = deps.toConversation(conversationMap)
                conversations.push(model)
                // 填充 channelSpaceMap / channelMySourceSpaceMap 缓存
                // octo-server PR#154+ 在 conversation sync 响应里携带 resolved space_id
                // （群表权威值）和 my_source_space_id（外部成员的 source Space）。
                // 老后端字段为空时跳过，仍走 channelInfo.orgData / subscriber 兜底。
                const key = `${conversationMap["channel_id"]}_${conversationMap["channel_type"]}`
                const sid = conversationMap["space_id"]
                if (sid) {
                    deps.setChannelSpace(key, sid)
                }
                const mySrc = conversationMap["my_source_space_id"]
                if (mySrc) {
                    deps.setChannelMySourceSpace(key, mySrc)
                }
            })
            const users = resp.users
            if (users && users.length > 0) {
                for (const user of users) {
                    deps.setChannelInfoForCache(deps.toUserChannelInfo(user))
                }
            }
            const groups = resp.groups
            if (groups && groups.length > 0) {
                for (const group of groups) {
                    deps.setChannelInfoForCache(deps.toGroupChannelInfo(group))
                }
            }
        }
        return conversations
    }
}
