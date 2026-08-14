import WKApp from "../App"
import { ChannelTypePerson, ChannelTypeGroup, Channel, Conversation, Message, WKSDK } from "wukongimjssdk"
import { hasSpacePrefix } from "./SpacePrefix"
import { ChannelTypeCommunityTopic } from "./Const"
import { parseThreadChannelId } from "./Thread"
import { getImChannelInfo, getImChannelSubscribers } from "../im-runtime/channelRuntime"
import { abortError, createAsyncCache } from "../Utils/asyncCache"
import type { RequestConfig } from "./APIClient"

export type JoinSpaceStatus = "NEED_APPROVAL" | "PENDING"

export interface JoinSpaceResult {
    space_id?: string
    status?: JoinSpaceStatus
}

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

    // SYSTEM_BOTS (BotFather) 是全局单例，所有 Space 都应可见
    // 消息级过滤由 filterPersonMessagesBySpace 处理
    if (SYSTEM_BOTS.has(conversation.channel.channelID)) return false

    const msgSpaceId = conversation.lastMessage?.content?.contentObj?.space_id
    if (msgSpaceId && msgSpaceId !== currentSpaceId) return true
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
 * GH dmworkim#1226: 若登录用户作为"外部成员"加入该群，返回其加入时的
 * 来源 Space ID（subscriber.orgData.source_space_id）。用于"群归属 Space 与当前
 * 查看 Space 不一致但我自己以当前 Space 身份加入"的场景下放行展示。
 *
 * 语义选择 source_space_id 而非 home_space_id：
 *   - source_space_id 是加入者绝对属性：只有 is_external=1 的成员才有非空值，
 *     内部成员永远为空串。正好对应"我是外部成员加入的吗"这一语义。
 *   - home_space_id 对内部成员会回落到 group.space_id（视角相对渲染字段），
 *     在"群不在当前 Space"分支虽然比较等价，但字段语义交叉容易误用；
 *     与后端 DB 列名对齐使用 source_space_id 更直观。
 *
 * 数据源优先级：
 *   1) WKApp.shared.channelMySourceSpaceMap —— octo-server PR#154+ 由
 *      conversation sync 响应的 my_source_space_id 字段预填，权威且即时。
 *   2) channelManager 的订阅者缓存（getSubscribes）—— 老后端或缓存预热前兜底。
 *      未缓存或未找到自己 → 返回 undefined（调用方应退化到原有判定）。
 */
function getMyMembershipSourceSpaceId(channel: Channel): string | undefined {
    if (!channel?.channelID) return undefined
    // 优先读 channelMySourceSpaceMap（由 conversation sync 预填，无须等 subscribers 拉取）
    const key = `${channel.channelID}_${channel.channelType}`
    const cached = WKApp.shared.channelMySourceSpaceMap.get(key)
    if (cached) return cached

    const myUid = WKApp.loginInfo?.uid
    if (!myUid) return undefined
    const subs = getImChannelSubscribers(WKSDK.shared(), channel)
    if (!subs || subs.length === 0) return undefined
    const mine = subs.find((s: any) => s?.uid === myUid) as any
    if (!mine) return undefined
    const sourceId = mine.orgData?.source_space_id
    if (typeof sourceId === "string" && sourceId.length > 0) {
        // 回填 map，避免每次都走 subscribers 数组扫描
        WKApp.shared.channelMySourceSpaceMap.set(key, sourceId)
        return sourceId
    }
    return undefined
}

/**
 * 判断一个 channel 是否不属于当前 Space，应从展示/计数中跳过。
 * - 无 currentSpaceId → 不过滤
 * - Person channel（私聊）→ 永远不过滤
 * - 有 Space 前缀（s{spaceId}_）的 channel → 前缀匹配
 * - 群聊（无前缀）→ 查 channelSpaceMap 缓存 → channelInfo.orgData.space_id
 * - 都未命中 → fail-closed（先跳过；channelInfo 回调拿到权威 space_id 后
 *              channelListener 会二次检查并补回）。
 * - CommunityTopic（子区）→ 跟父群走（用父群 channelSpaceMap 缓存）。
 *              父群缓存未命中 → fail-open（子区不能 fail-closed，否则永久隐藏）。
 *
 * GH octo-web#107: 由 fail-open 改为 fail-closed（仅 Group 类型）。fail-open
 * 会让实时 WS 推送的、归属其他 Space 的群短暂出现在当前 Space 视图（即使
 * channelInfo 后续把它移除）。新策略下，octo-server PR#154+ 的 conversation
 * sync 已经在 channelSpaceMap / channelMySourceSpaceMap 里预填了权威值，命中率
 * 覆盖绝大多数场景；只有真正全新的 WS 推送会暂时被过滤，等 channelInfo 到达
 * 后通过 channelListener 的待定队列恢复显示。Person / CommunityTopic 保持
 * fail-open（私聊从来不过滤；子区不能在父群尚未确权时永久消失）。
 *
 * 外部群兼容：当群归属 Space 与当前 Space 不一致时，额外检查自己是否
 * 以"当前 Space"身份加入了该群（subscriber.orgData.source_space_id === currentSpaceId）。
 * 命中则不过滤 —— 外部加入者在自己的 Space 视角下应该看到这个外部群。
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
            if (cachedSpaceId === currentSpaceId) return false
            // 群归属其他 Space：检查自己是否以当前 Space 身份加入的外部成员
            if (getMyMembershipSourceSpaceId(channel) === currentSpaceId) return false
            return true
        }
        // 缓存未命中 → 尝试从已缓存的 channelInfo 获取 space_id
        const channelInfo = getImChannelInfo(WKSDK.shared(), channel)
        const infoSpaceId = channelInfo?.orgData?.space_id
        if (infoSpaceId) {
            // 回填 channelSpaceMap 避免下次再查
            WKApp.shared.channelSpaceMap.set(key, infoSpaceId)
            if (infoSpaceId === currentSpaceId) return false
            if (getMyMembershipSourceSpaceId(channel) === currentSpaceId) return false
            return true
        }
        // channelInfo 也没有 → fail-closed：暂时跳过。channelListener 拿到
        // 权威 space_id 后会通过 _pendingSpaceConversations 把会话补回展示。
        return true
    }

    // 子区（CommunityTopic）→ 跟父群走，fail-open。
    // channelID 形如 `${groupNo}____${shortId}`，父群的 channelSpaceMap key
    // 是 `${groupNo}_${ChannelTypeGroup}`。
    // - 父群缓存命中 → 跟父群结论（父群在当前 Space → 子区也在）
    // - 父群缓存未命中 → fail-open（return false），与改造前一致：子区
    //   永远跟父群展示，避免 fail-closed 永久隐藏子区会话/通知。
    if (channel.channelType === ChannelTypeCommunityTopic) {
        const parsed = parseThreadChannelId(cid)
        if (!parsed) return false
        const parentKey = `${parsed.groupNo}_${ChannelTypeGroup}`
        const parentSpaceId = WKApp.shared.channelSpaceMap.get(parentKey)
        if (parentSpaceId) {
            if (parentSpaceId === currentSpaceId) return false
            // 父群归属其他 Space：检查我是否以当前 Space 身份加入父群（外部成员）
            const parentChannel = new Channel(parsed.groupNo, ChannelTypeGroup)
            if (getMyMembershipSourceSpaceId(parentChannel) === currentSpaceId) return false
            return true
        }
        // 父群 channelInfo 兜底
        const parentChannel = new Channel(parsed.groupNo, ChannelTypeGroup)
        const parentInfo = getImChannelInfo(WKSDK.shared(), parentChannel)
        const parentInfoSpaceId = parentInfo?.orgData?.space_id
        if (parentInfoSpaceId) {
            WKApp.shared.channelSpaceMap.set(parentKey, parentInfoSpaceId)
            if (parentInfoSpaceId === currentSpaceId) return false
            if (getMyMembershipSourceSpaceId(parentChannel) === currentSpaceId) return false
            return true
        }
        // 父群缓存 / channelInfo 都没有 → fail-open（子区跟父群，
        // 父群 channelInfo 到达后由 channelListener 二次纠正）。
        return false
    }

    // 非 Person / 非 Group / 非 CommunityTopic 频道 → fail-closed，避免泄漏。
    return true
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

/**
 * 名册缓存的存活时长。30s 量级足以覆盖「打开转发面板 → 关闭 → 再打开」以及
 * 多个消费面在同一屏内并发拉取，同时把成员变动的可见延迟控制在可接受范围。
 * 本 Service 内的写操作会主动失效，所以这个窗口只对外部来源的变更生效。
 */
const SPACE_ROSTER_TTL_MS = 30_000
/**
 * 单页条数。取 10000（与 Contacts / docs octoweb 既有实现一致），大多数空间
 * 一趟拉完。不用 getAllMembers 的默认 100：那会退化成 800 人 8 趟串行请求，
 * 且 100×50 的上限只有 5000，低于已知的 5760 人空间。
 */
const SPACE_ROSTER_PAGE_LIMIT = 10_000
/** 兜底防异常空间无限循环（20×10000 = 20 万，远超任何真实空间）。 */
const SPACE_ROSTER_MAX_PAGES = 20

const rosterCache = createAsyncCache<SpaceMember[]>({
    ttlMs: SPACE_ROSTER_TTL_MS,
    clone: (members) => [...members],
})

export class SpaceService {
    static shared = new SpaceService()

    async getMySpaces(
        config?: Pick<RequestConfig, "suppressAuthExpiredLogout">,
    ): Promise<Space[]> {
        const resp = await WKApp.apiClient.get("space/my", config)
        return resp || []
    }

    async createSpace(name: string, description: string, joinMode: number = 0): Promise<SpaceCreateResp> {
        return WKApp.apiClient.post("space/create", { name, description, join_mode: joinMode })
    }

    async getSpace(spaceId: string): Promise<Space> {
        return WKApp.apiClient.get(`space/${spaceId}`)
    }

    async getMembers(spaceId: string, page: number = 1, limit: number = 50, signal?: AbortSignal): Promise<SpaceMember[]> {
        const path = `space/${spaceId}/members?page=${page}&limit=${limit}`
        try {
            // 仅在调用方给了 signal 时才带 config，保持既有调用形态不变。
            const resp = signal ? await WKApp.apiClient.get(path, { signal }) : await WKApp.apiClient.get(path)
            return resp || []
        } catch (err) {
            // 请求进行中被取消时，axios 抛 ERR_CANCELED，而 normalizeApiError
            // （apiError.ts:96-109）只归类 ECONNABORTED / ERR_NETWORK，取消会被
            // 包装成「未知错误」——调用方无从识别，还会弹错误提示。这里按
            // signal.aborted 判定而非匹配错误码：请求被取消时该标志必然为真，
            // 不依赖 APIClient 包装后的错误形状。
            if (signal?.aborted) throw abortError()
            throw err
        }
    }

    // 拉取一个 space 的全部成员（分页循环到取空/达上限）。收敛此前散落在
    // dmloop directory / SettingsPage 各自复制的分页逻辑，
    // 避免翻页上限相互漂移。
    //
    // 注意默认上限是 100×50 = 5000。已知有 5760 人的空间（见外部 Docs
    // 模块的 picker 截断修复），所以需要完整名册的调用方应改用 getRoster，
    // 或显式传更大的 pageLimit。
    async getAllMembers(spaceId: string, pageLimit: number = 100, maxPages: number = 50, signal?: AbortSignal): Promise<SpaceMember[]> {
        if (!spaceId) return []
        const acc: SpaceMember[] = []
        for (let page = 1; page <= maxPages; page++) {
            // 请求进行中被取消由 getMembers 翻译成 AbortError 抛出。
            const batch = await this.getMembers(spaceId, page, pageLimit, signal)
            acc.push(...batch)
            // 这一层只兜「abort 落在两页之间」（无请求在飞）的窗口。抛错而不是
            // break 返回半份名册——半份会被上层当成完整结果，静默丢人。
            if (signal?.aborted) throw abortError()
            if (!batch || batch.length < pageLimit) break
        }
        return acc
    }

    /**
     * 带缓存的全量成员名册。
     *
     * 与 getAllMembers 的区别：结果按 spaceId 缓存，TTL 内的并发/重复调用共享
     * 同一次请求。`space/{id}/members` 目前被转发面板、通讯录、Chat 侧栏、docs
     * 成员选择器和企业模块各自全量拉取且互不复用，此方法是它们的统一入口。
     *
     * 翻页参数用 10000×20（与 Contacts / docs 既有实现一致），而非
     * getAllMembers 的 100×50 —— 后者上限 5000，低于已知的 5760 人空间。
     */
    async getRoster(spaceId: string, options?: { maxAgeMs?: number; signal?: AbortSignal }): Promise<SpaceMember[]> {
        if (!spaceId) return []
        return rosterCache.get(
            spaceId,
            () => this.getAllMembers(spaceId, SPACE_ROSTER_PAGE_LIMIT, SPACE_ROSTER_MAX_PAGES),
            options,
        )
    }

    /** 同步读已缓存的名册（不触发请求），用于首帧兜底。 */
    peekRoster(spaceId: string): SpaceMember[] | undefined {
        return rosterCache.peek(spaceId)
    }

    /** 失效名册缓存。不传 spaceId 则清空全部（例如登出）。 */
    invalidateRoster(spaceId?: string): void {
        rosterCache.invalidate(spaceId)
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

    async joinSpace(inviteCode: string): Promise<JoinSpaceResult> {
        return WKApp.apiClient.post("space/join", { invite_code: inviteCode })
    }

    async leaveSpace(spaceId: string): Promise<void> {
        const result = await WKApp.apiClient.post(`space/${spaceId}/leave`, {})
        // 自己退出是 removeMembers 的对称操作，同样要失效名册，否则 TTL 窗口内
        // 还能读到把自己算在内的旧名册。（joinSpace 只有邀请码，拿不到 spaceId，
        // 无法在此失效。）
        rosterCache.invalidate(spaceId)
        return result
    }

    async updateSpace(spaceId: string, data: { name?: string; description?: string }): Promise<void> {
        return WKApp.apiClient.put(`space/${spaceId}`, data)
    }

    async removeMembers(spaceId: string, uids: string[]): Promise<void> {
        const result = await WKApp.apiClient.delete(`space/${spaceId}/members`, { data: { uids } })
        // 写后失效：否则 TTL 窗口内会读回自己刚移除的成员。
        rosterCache.invalidate(spaceId)
        return result
    }

    async disbandSpace(spaceId: string): Promise<void> {
        const result = await WKApp.apiClient.delete(`space/${spaceId}`, {})
        rosterCache.invalidate(spaceId)
        return result
    }

    async updateMemberRole(spaceId: string, uid: string, role: number): Promise<void> {
        const result = await WKApp.apiClient.put(`space/${spaceId}/members/${uid}/role`, { role })
        rosterCache.invalidate(spaceId)
        return result
    }
}
