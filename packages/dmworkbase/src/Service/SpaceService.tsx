import WKApp from "../App"
import { ChannelTypePerson, ChannelTypeGroup, Channel, Conversation } from "wukongimjssdk"
import { hasSpacePrefix } from "./SpacePrefix"

export { hasSpacePrefix } from "./SpacePrefix"

/**
 * 判断一个 channel 是否不属于当前 Space，应从展示/计数中跳过。
 * - 无 currentSpaceId → 不过滤
 * - Person channel（私聊）→ 永远不过滤
 * - 有 Space 前缀（s{spaceId}_）的 channel → 前缀匹配
 * - 群聊（无前缀）→ 查 channelSpaceMap 缓存
 * - 缓存未命中 → fail-open（放行）
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
        if (cachedSpaceId && cachedSpaceId !== currentSpaceId) {
            return true // 属于其他 Space → 跳过
        }
        // 缓存未命中或匹配 → 放行
    }

    return false
}

// 系统 Bot 列表（与 Conversation/vm.ts 中 SYSTEM_BOTS 一致）
const SYSTEM_BOTS = new Set(["botfather"])

/**
 * 判断系统 Bot（如 BotFather）的 DM 会话是否不属于当前 Space。
 * 只对 SYSTEM_BOTS 中的 Bot 生效，非系统 Bot 直接返回 false。
 * 检查 lastMessage 的 contentObj.space_id：
 *   - 无 lastMessage 或无 space_id（历史消息）→ 不跳过（向前兼容）
 *   - space_id 匹配当前 Space → 不跳过
 *   - space_id 不匹配 → 跳过
 */
export function shouldSkipSystemBotConversation(conversation: Conversation): boolean {
    const currentSpaceId = WKApp.shared.currentSpaceId
    if (!currentSpaceId) return false
    if (!SYSTEM_BOTS.has(conversation.channel?.channelID)) return false

    const spaceId = conversation.lastMessage?.content?.contentObj?.space_id
    if (!spaceId) return false // 无 space_id（历史消息）→ 向前兼容，不跳过
    return spaceId !== currentSpaceId
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
