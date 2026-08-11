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

vi.mock('../Dap', () => ({
    Dap: {
        shared: {
            track: (name: string, props: Record<string, unknown>) => {
                trackCalls.push({ name, props })
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
})
