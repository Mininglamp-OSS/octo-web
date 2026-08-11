/**
 * 消息类破例补点(octo-dap 采集方案 §5 / §5.4)
 * =================================================
 * 消息发送走 wukongimjssdk 二进制帧(不进 HTTP),蒙版的事件委托 / fetch 包裹都覆盖不到语义。
 * 必须在业务层 sendMessage / sendack / revoke 处极小破例,调 Dap 补点。
 *
 * 关键口径:
 *   - `message_sent` / `ai_mentioned` 质量只到 `submitted`(IM 服务端已受理入队),不冒充投递/已读。
 *   - sendack 时拿不到 mention / botfather 上下文,故在 sendMessage 记一份按 clientSeq 的轻量意图,
 *     sendack Normal 时消费。意图里**不含任何正文**,只含枚举 / 类型 / 布尔。
 *   - `bot_create_started`(§5.4):仅前端 started 语义,不追后端 completed;/newbot 只测前缀识别已知命令,
 *     绝不采集正文,只 emit 事件 + entry。
 *   - 一律不写 actor(user_id / actor_type),后端按凭证归一。
 */
import { Dap } from './Dap'
import { WKSDK, SendackPacket } from 'wukongimjssdk'

/** channelType → chat_type 枚举(§ Const.ts:ChannelTypePerson=1/Group=2/CommunityTopic=5/CustomerService=3) */
function chatTypeOf(channelType: number): string {
    switch (channelType) {
        case 1: return 'personal'
        case 2: return 'group'
        case 5: return 'thread'
        case 3: return 'customer_service'
        default: return 'unknown'
    }
}

interface SendIntent {
    /** 会话标识(join 用,非正文)。DM 为对端 id、群为群 id、botfather 为 "botfather" */
    channelId: string
    channelType: number
    mentionAis: boolean
    /** 命中 botfather /newbot 时置为入口枚举 'botfather_im',否则 undefined */
    botCreateEntry?: string
    /** 被 @ 的 AI bot 列表(供 ai_mentioned 补 bot_id/bot_type;type ∈ 'system'|'custom') */
    mentionedBots?: Array<{ id: string; type: string }>
}

/** 按 clientSeq 暂存发送意图,sendack 时消费。带上限防泄漏。 */
const intents = new Map<number, SendIntent>()
const MAX_INTENTS = 500

export function rememberSendIntent(clientSeq: number | undefined, intent: SendIntent): void {
    if (!clientSeq) return
    // sendack 到达前用户可能已切走频道,发送 VM 卸载、其 messageStatusListener 被摘,
    // 故消费 sendack 的监听必须**独立于任何 VM**。见 ensureGlobalAckListener。
    ensureGlobalAckListener()
    intents.set(clientSeq, intent)
    if (intents.size > MAX_INTENTS) {
        const oldest = intents.keys().next().value
        if (oldest !== undefined) intents.delete(oldest)
    }
}

/**
 * 常驻(与任何 ConversationVM 无关)的 sendack 监听:纯按 clientSeq 消费 intents。
 *
 * 此前 message_sent / ai_mentioned / bot_create_started 只在**发送会话自己**的 VM 的
 * sendack 回调里补点(updateMessageStatusBySendAck → findMessageWithClientSeq 需命中本 VM
 * 列表)。用户在 sendack 到达前切走频道时,发送 VM 已卸载、其 messageStatusListener 已摘,
 * 新挂载 VM 找不到该 clientSeq,message_sent 被静默丢弃——系统性少计"快速切频道 / 慢网"
 * 用户的旗舰事件(见 PR #1320 review P1-3)。
 *
 * intents 本就是模块级、跨 VM 存活;把消费点搬到一个常驻 chatManager 监听后,切频道再也
 * 吞不掉事件。trackMessageSent 消费即 delete,故即便与旧 VM 路径并存也天然去重、绝不双记;
 * 无 intent(如转发)则直接 no-op。幂等,仅注册一次。
 */
let ackListenerBound = false
function ensureGlobalAckListener(): void {
    if (ackListenerBound) return
    try {
        WKSDK.shared().chatManager.addMessageStatusListener((p: SendackPacket) => {
            // reasonCode===1 = IM 服务端已受理(submitted 口径),与原 VM 路径判据一致
            if (p && p.reasonCode === 1) trackMessageSent(p.clientSeq)
        })
        ackListenerBound = true
    } catch {
        /* WKSDK 尚未就绪等异常一律吞掉,不影响业务发送 */
    }
}

/** sendack Normal(reasonCode===1)时调:发 message_sent(+ ai_mentioned / bot_create_started)。 */
export function trackMessageSent(clientSeq: number | undefined): void {
    if (!clientSeq) return
    const intent = intents.get(clientSeq)
    if (!intent) return // 无意图(非本 vm 发送路径,如转发)不补点,避免歧义
    intents.delete(clientSeq)

    const chatType = chatTypeOf(intent.channelType)
    const base = {
        channel_id: intent.channelId,
        channel_type: intent.channelType,
        chat_type: chatType,
        object_id: String(clientSeq), // client_seq 作 object_id
    }
    Dap.shared.track('message_sent', base)
    const bots = intent.mentionedBots || []
    if (intent.mentionAis || bots.length > 0) {
        if (bots.length > 0) {
            // 每个被 @ 的 AI bot 一条,带 bot_id/bot_type(§B: 多AI协作/系统内置 vs 自建分布)
            for (const b of bots) {
                Dap.shared.track('ai_mentioned', {
                    channel_id: intent.channelId, chat_type: chatType, object_id: base.object_id,
                    bot_id: b.id, bot_type: b.type,
                })
            }
        } else {
            // @所有AI 但订阅列表未解析出具体 bot:退化为一条无 bot_id 的
            Dap.shared.track('ai_mentioned', { channel_id: intent.channelId, chat_type: chatType, object_id: base.object_id })
        }
    }
    if (intent.botCreateEntry) {
        // §5.4:started 语义,quality=submitted;进不了「创建成功」分母
        Dap.shared.track('bot_create_started', { entry: intent.botCreateEntry, object_id: base.object_id })
    }
}

/** revoke 成功后调:message_revoked(ui_action)。 */
export function trackMessageRevoked(clientSeq: number | undefined, channelType: number): void {
    Dap.shared.track('message_revoked', {
        channel_type: channelType,
        object_id: clientSeq ? String(clientSeq) : null,
    })
}
