import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * message_sent 常驻监听契约(对应 PR #1320 review 的 P1-3 blocking):
 *   sendack 到达前用户可能已切走频道 → 发送会话的 VM 卸载、其 messageStatusListener 被摘,
 *   若 message_sent 只在该 VM 的 sendack 回调里补发,就会被静默丢弃(系统性少计"快速切频道 /
 *   慢网"用户的旗舰事件)。修法:把消费点搬到一个**与任何 VM 无关的常驻 chatManager 监听**,
 *   纯按 clientSeq 消费模块级 intents;消费即 delete,天然去重、绝不双记。
 *
 * 本用例 mock 掉 wukongimjssdk 捕获注册进 chatManager 的那个全局回调,再直接触发它(模拟
 * sendack 在"任何 VM 都不在场"时到达),断言 message_sent 仍被补发。若把 ensureGlobalAckListener
 * 去掉(退回 VM-only 路径),回调根本不会被注册 → 断言变红(delete-the-fix)。
 * 单独成文件:vitest 默认按文件隔离。
 */

const trackCalls: Array<{ name: string; props: Record<string, unknown> }> = []
let ackCb: ((p: { reasonCode: number; clientSeq: number }) => void) | null = null
let enabled = true
let disableHook: (() => void) | null = null

vi.mock('../Dap', () => ({
    Dap: {
        shared: {
            track: (name: string, props: Record<string, unknown>) => {
                trackCalls.push({ name, props })
            },
            isEnabled: () => enabled,
            onDisabled: (cb: () => void) => {
                disableHook = cb
            },
        },
    },
}))

vi.mock('wukongimjssdk', () => ({
    WKSDK: {
        shared: () => ({
            chatManager: {
                // 捕获常驻 sendack 监听:测试稍后手动触发它,模拟 sendack 到达
                addMessageStatusListener: (cb: (p: { reasonCode: number; clientSeq: number }) => void) => {
                    ackCb = cb
                },
            },
        }),
    },
    SendackPacket: class {},
}))

async function freshTrack() {
    vi.resetModules()
    return import('../trackMessage')
}

describe('trackMessage — global sendack listener survives channel switch (P1-3)', () => {
    beforeEach(() => {
        trackCalls.length = 0
        ackCb = null
        enabled = true
        disableHook = null
    })

    function named(name: string) {
        return trackCalls.filter((c) => c.name === name)
    }

    it('emits message_sent from the global listener even when no sending VM is present', async () => {
        const { rememberSendIntent } = await freshTrack()

        // 发送时记意图;此刻 ensureGlobalAckListener 应已把常驻监听注册进 chatManager
        rememberSendIntent(100, { channelId: 'g1', channelType: 2, mentionAis: false })
        expect(ackCb, 'rememberSendIntent 必须注册常驻 sendack 监听').toBeTruthy()

        // 模拟用户已切频道后 sendack 才到达:直接触发常驻回调(与任何 VM 无关)
        ackCb!({ reasonCode: 1, clientSeq: 100 })

        const sent = named('message_sent')
        expect(sent).toHaveLength(1)
        expect(sent[0].props).toMatchObject({
            channel_id: 'g1',
            chat_type: 'group',
            object_id: '100',
        })
    })

    it('consumes each intent once — a duplicate sendack does not double-count', async () => {
        const { rememberSendIntent } = await freshTrack()

        rememberSendIntent(101, { channelId: 'u1', channelType: 1, mentionAis: false })
        ackCb!({ reasonCode: 1, clientSeq: 101 })
        ackCb!({ reasonCode: 1, clientSeq: 101 }) // 重复 sendack

        expect(named('message_sent')).toHaveLength(1)
    })

    it('ignores non-accepted sendack (reasonCode !== 1)', async () => {
        const { rememberSendIntent } = await freshTrack()

        rememberSendIntent(102, { channelId: 'g2', channelType: 2, mentionAis: false })
        ackCb!({ reasonCode: 0, clientSeq: 102 })

        expect(named('message_sent')).toHaveLength(0)
    })

    it('emits ai_mentioned per @-ed bot alongside message_sent', async () => {
        const { rememberSendIntent } = await freshTrack()

        rememberSendIntent(103, {
            channelId: 'g3',
            channelType: 2,
            mentionAis: true,
            mentionedBots: [
                { id: 'bot-a', type: 'system' },
                { id: 'bot-b', type: 'custom' },
            ],
        })
        ackCb!({ reasonCode: 1, clientSeq: 103 })

        expect(named('message_sent')).toHaveLength(1)
        const mentioned = named('ai_mentioned')
        expect(mentioned).toHaveLength(2)
        expect(mentioned.map((m) => m.props.bot_id)).toEqual(['bot-a', 'bot-b'])
    })

    // ---- fail-closed(对应 PR #1330 review 的 blocker①):dark 态零常驻,停采清缓存 ----

    it('disabled: binds NO sendack listener and remembers no intent (fail-closed, zero resident)', async () => {
        const { rememberSendIntent } = await freshTrack()
        enabled = false // 采集未启用(默认 dark 态)

        rememberSendIntent(200, { channelId: 'g9', channelType: 2, mentionAis: false })
        // 去掉 rememberSendIntent 顶部的 isEnabled 门,这里就会绑定常驻监听 → 断言变红(delete-the-fix)
        expect(ackCb, '未启用时不得绑定常驻 sendack 监听').toBeNull()

        // 即便此后有人手动触发(不会发生,监听没绑),也不应补点
        enabled = true
        expect(named('message_sent')).toHaveLength(0)
    })

    it('kill switch: setEnabled(false) clears buffered intents so a late sendack emits nothing', async () => {
        const { rememberSendIntent } = await freshTrack()

        // 启用态记下意图并绑定监听 + 停采钩子
        rememberSendIntent(201, { channelId: 'g10', channelType: 2, mentionAis: false })
        expect(ackCb).toBeTruthy()
        expect(disableHook, '绑定监听时应同时注册停采钩子').toBeTruthy()

        // 停采:钩子清空 intents;之后 sendack 才到达
        enabled = false
        disableHook!()
        ackCb!({ reasonCode: 1, clientSeq: 201 })

        // intents 被清 + trackMessageSent 的 isEnabled 门,双保险:一条都不发
        expect(named('message_sent')).toHaveLength(0)
    })
})

/**
 * message_revoked 单通道契约(对应四审 P1-1 blocking):
 *   撤回原先同时挂在 fetch 通道(FetchRules POST /message/revoke)与命令式 trackMessageRevoked 上,
 *   会话菜单入口双发(fetch 空属性 + 命令式富属性),既双计又属性不一致。
 *   修法:删除 fetch 规则,撤回的唯一活入口 vm.revokeMessage 调 trackMessageRevoked,统一收口到命令式
 *   单通道(六审已删除从未接线的气泡 onMessageRevoke 死入口)。此处断言每次撤回恰好补发一条、且带富属性。
 */
describe('trackMessage — message_revoked 命令式单通道 (四审 P1-1)', () => {
    beforeEach(() => {
        trackCalls.length = 0
        enabled = true
    })

    function named(name: string) {
        return trackCalls.filter((c) => c.name === name)
    }

    it('emits exactly one message_revoked with rich props per revoke', async () => {
        const { trackMessageRevoked } = await freshTrack()

        trackMessageRevoked(555, 2)

        const revoked = named('message_revoked')
        expect(revoked).toHaveLength(1)
        expect(revoked[0].props).toEqual({ channel_type: 2, object_id: '555' })
    })

    it('object_id is null when clientSeq is missing (no content leak)', async () => {
        const { trackMessageRevoked } = await freshTrack()

        trackMessageRevoked(undefined, 1)

        const revoked = named('message_revoked')
        expect(revoked).toHaveLength(1)
        expect(revoked[0].props).toEqual({ channel_type: 1, object_id: null })
    })
})
