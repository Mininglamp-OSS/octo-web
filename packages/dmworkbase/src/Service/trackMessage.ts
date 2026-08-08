/**
 * 消息类破例补点(octo-dap 采集方案 §5 / §5.4)
 * =================================================
 * 消息发送走 wukongimjssdk 二进制帧(不进 HTTP),蒙版的事件委托 / fetch 包裹都覆盖不到语义。
 * 必须在业务层 sendMessage / sendack / revoke 处极小破例,调 Tracker 补点。
 *
 * 关键口径:
 *   - `message_sent` / `ai_mentioned` 质量只到 `submitted`(IM 服务端已受理入队),不冒充投递/已读。
 *   - sendack 时拿不到 mention / botfather 上下文,故在 sendMessage 记一份按 clientSeq 的轻量意图,
 *     sendack Normal 时消费。意图里**不含任何正文**,只含枚举 / 类型 / 布尔。
 *   - `bot_create_started`(§5.4):仅前端 started 语义,不追后端 completed;/newbot 只测前缀识别已知命令,
 *     绝不采集正文,只 emit 事件 + entry。
 *   - 一律不写 actor(user_id / actor_type),后端按凭证归一。
 */
import { Tracker } from './Tracker'

interface SendIntent {
    /** 会话标识(join 用,非正文)。DM 为对端 id、群为群 id、botfather 为 "botfather" */
    channelId: string
    channelType: number
    mentionAis: boolean
    /** 命中 botfather /newbot 时置为入口枚举 'botfather_im',否则 undefined */
    botCreateEntry?: string
}

/** 按 clientSeq 暂存发送意图,sendack 时消费。带上限防泄漏。 */
const intents = new Map<number, SendIntent>()
const MAX_INTENTS = 500

export function rememberSendIntent(clientSeq: number | undefined, intent: SendIntent): void {
    if (!clientSeq) return
    intents.set(clientSeq, intent)
    if (intents.size > MAX_INTENTS) {
        const oldest = intents.keys().next().value
        if (oldest !== undefined) intents.delete(oldest)
    }
}

/** sendack Normal(reasonCode===1)时调:发 message_sent(+ ai_mentioned / bot_create_started)。 */
export function trackMessageSent(clientSeq: number | undefined): void {
    if (!clientSeq) return
    const intent = intents.get(clientSeq)
    if (!intent) return // 无意图(非本 vm 发送路径,如转发)不补点,避免歧义
    intents.delete(clientSeq)

    const base = {
        channel_id: intent.channelId,
        channel_type: intent.channelType,
        object_id: String(clientSeq), // client_seq 作 object_id
    }
    Tracker.shared.track('message_sent', base)
    if (intent.mentionAis) {
        // 消息真发出后才报(§5.2):与 input_mention_ai_selected 不同名
        Tracker.shared.track('ai_mentioned', { channel_id: intent.channelId, object_id: base.object_id })
    }
    if (intent.botCreateEntry) {
        // §5.4:started 语义,quality=submitted;进不了「创建成功」分母
        Tracker.shared.track('bot_create_started', { entry: intent.botCreateEntry, object_id: base.object_id })
    }
}

/** revoke 成功后调:message_revoked(ui_action)。 */
export function trackMessageRevoked(clientSeq: number | undefined, channelType: number): void {
    Tracker.shared.track('message_revoked', {
        channel_type: channelType,
        object_id: clientSeq ? String(clientSeq) : null,
    })
}
