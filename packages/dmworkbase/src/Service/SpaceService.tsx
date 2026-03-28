import WKApp from "../App"
import { ChannelTypePerson, ChannelTypeGroup, Channel, Conversation, Message } from "wukongimjssdk"
import { hasSpacePrefix } from "./SpacePrefix"

export { hasSpacePrefix } from "./SpacePrefix"

// 系统 Bot channelID 集合
export const SYSTEM_BOTS = new Set(["botfather"])

/**
 * 判断 1:1 私聊会话的 lastMessage 是否不属于当前 Space。
 * - 非 Space 模式 → false（不跳过）
 * - 非 Person 频道 → false
 * - lastMessage 无 space_id → false（旧消息向前兼容）
 * - space_id 匹配当前 Space → false
 * - space_id 存在但不匹配 → true（跳过）
 */
export function shouldSkipPersonConversationForSpace(conversation: Conversation): boolean {
    const currentSpaceId = WKApp.shared.currentSpaceId
    if (!currentSpaceId) return false
    if (conversation.channel.channelType !== ChannelTypePerson) return false

    const msgSpaceId = conversation.lastMessage?.content?.contentObj?.space_id
    if (msgSpaceId && msgSpaceId !== currentSpaceId) return true
    // 系统 Bot 无 space_id 时跳过，避免空壳会话（有条目无内容）
    if (!msgSpaceId && SYSTEM_BOTS.has(conversation.channel.channelID)) return true
    return false
}

/**
 * 为 1:1 私聊会话的列表预览做 Space 过滤。
 * - 不在 Space 模式 → 返回原始 lastMessage
 * - 非 Person 频道 → 返回原始 lastMessage
 * - lastMessage.content.contentObj.space_id 匹配当前 Space → 返回原消息
 * - space_id 存在但不匹配 → 返回 undefined（不泄漏其他 Space 内容）
 * - 无 space_id：系统 Bot → undefined；普通私聊 → 原消息（旧消息兼容）
 */
export function getSpaceFilteredLastMessage(conversation: Conversation): Message | undefined {
    const currentSpaceId = WKApp.shared.currentSpaceId
    if (!currentSpaceId) return conversation.lastMessage

    if (conversation.channel.channelType !== ChannelTypePerson) return conversation.lastMessage

    const lastMsg = conversation.lastMessage
    if (!lastMsg) return conversation.lastMessage

    const spaceId = lastMsg.content?.contentObj?.space_id
    if (spaceId && spaceId === currentSpaceId) return lastMsg
    if (spaceId && spaceId !== currentSpaceId) return undefined
    // 无 space_id：系统 Bot 不展示，普通私聊向前兼容
    if (SYSTEM_BOTS.has(conversation.channel.channelID)) return undefined
    return conversation.lastMessage
}

/**
 * 判断一个 channel 是否不属于当前 Space，应从展示/计数中跳过。
 * - 无 currentSpaceId → 不过滤
 * - Person channel（私聊）→ 永远不过滤
 * - 有 Space 前缀（s{spaceId}_）的 channel → 前缀匹配
 * - 群聊（无前缀）→ 查 channelSpaceMap 缓存
 * - 缓存未命中 → fail-close（不放行）
 */
export function shouldSkipChannelForSpace(channel: Channel): boolean {
    const currentSpaceId = WKApp.shared.currentSpaceId
    if (!currentSpaceId) return false
    if (!channel?.channelID) return false

    const cid = channel.channelID

    // 有 Space 前缀的 channel（私聊 s{spaceId}_{uid} 或群聊 s{spaceId}_{groupNo}）
    if (hasSpacePrefix(cid)) {
        return !cid.startsWith(`s${currentSpaceId}_`)
    }

    // 无前缀的私聊 → 不过滤（旧数据兼容）
    if (channel.channelType === ChannelTypePerson) return false

    // 无前缀的群聊 → 查 channelSpaceMap 缓存
    if (channel.channelType === ChannelTypeGroup) {
        const key = `${cid}_${channel.channelType}`
        const cachedSpaceId = WKApp.shared.channelSpaceMap.get(key)
        if (cachedSpaceId) {
            return cachedSpaceId !== currentSpaceId // 匹配 → 放行，不匹配 → 跳过
        }
        return true // 缓存未命中 → fail-close，不放行
    }

    return false
}

/**
 * 判断一条消息是否不属于当前 Space（用于通知/提示音过滤）。
 * 对普通 channel 退化为 shouldSkipChannelForSpace。
 * 对系统 Bot 消息，额外检查 message.content.contentObj.space_id。
 */
export function shouldSkipMessageForSpace(message: Message): boolean {
    // 先检查 channel 级过滤
    if (shouldSkipChannelForSpace(message.channel)) return true

    // 1:1 私聊额外检查消息级 space_id
    const currentSpaceId = WKApp.shared.currentSpaceId
    if (!currentSpaceId) return false
    if (message.channel.channelType !== ChannelTypePerson) return false

    const msgSpaceId = message.content?.contentObj?.space_id
    // 有 space_id 且不匹配 → 跳过
    if (msgSpaceId && msgSpaceId !== currentSpaceId) return true
    // 无 space_id：系统 Bot 跳过，普通私聊不过滤（旧消息兼容）
    if (!msgSpaceId && SYSTEM_BOTS.has(message.channel.channelID)) return true

    return false
}

export interface Space {
    space_id: string
    name: string
    description: string
    logo: string
    member_count: number
    max_users: number // 0 means unlimited
    role: number // 1: owner, 2: admin, 3: member
    created_at: string
}

export interface SpaceMember {
    uid: string
    name: string
    avatar: string
    role: number // 1: owner, 2: admin, 3: member
    robot: number // 0: user, 1: bot
    created_at: string
}

export interface SpaceCreateResp {
    space_id: string
}

export interface InviteResp {
    invite_code: string
    invite_url: string
}

export class SpaceService {
    static shared = new SpaceService()

    async getMySpaces(): Promise<Space[]> {
        const resp = await WKApp.apiClient.get("space/my")
        return resp || []
    }

    async createSpace(name: string, description: string): Promise<SpaceCreateResp> {
        return WKApp.apiClient.post("space/create", { name, description })
    }

    async getSpace(spaceId: string): Promise<Space> {
        return WKApp.apiClient.get(`space/${spaceId}`)
    }

    async getMembers(spaceId: string, page: number = 1, limit: number = 50): Promise<SpaceMember[]> {
        const resp = await WKApp.apiClient.get(`space/${spaceId}/members?page=${page}&limit=${limit}`)
        return resp || []
    }

    async createInvite(spaceId: string): Promise<InviteResp> {
        return WKApp.apiClient.post(`space/${spaceId}/invite`, {})
    }

    async getInviteInfo(inviteCode: string): Promise<{
        invite_code: string;
        space_id: string;
        space_name: string;
        member_count: number;
        max_users: number;
    }> {
        return WKApp.apiClient.get(`space/invite/${inviteCode}`)
    }

    async joinSpace(inviteCode: string): Promise<void> {
        return WKApp.apiClient.post("space/join", { invite_code: inviteCode })
    }

    async leaveSpace(spaceId: string): Promise<void> {
        return WKApp.apiClient.post(`space/${spaceId}/leave`, {})
    }

    async updateSpace(spaceId: string, data: { name?: string; description?: string }): Promise<void> {
        return WKApp.apiClient.put(`space/${spaceId}`, data)
    }

    async removeMembers(spaceId: string, uids: string[]): Promise<void> {
        return WKApp.apiClient.delete(`space/${spaceId}/members`, { data: { uids } })
    }

    async disbandSpace(spaceId: string): Promise<void> {
        return WKApp.apiClient.delete(`space/${spaceId}`, {})
    }

    async updateMemberRole(spaceId: string, uid: string, role: number): Promise<void> {
        return WKApp.apiClient.put(`space/${spaceId}/members/${uid}/role`, { role })
    }
}
