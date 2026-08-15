import { describe, it, expect } from 'vitest'
import { BODY_RULES, buildBodyIndex, computeBodyEvent, type BodyRule } from '../BodyRules'

/**
 * BodyRules —— 中央映射·body 键通道(②)判别器 + 规则表守卫。
 * 重点:白名单门(非登记端点绝不解析 body)、只读顶层键/枚举值(不读其它值)、只解析 JSON 串体、
 * 顺序判别 + fallback,以及规则表本身覆盖 9 个 im/base 群设置事件的正确性。
 */

const idx = buildBodyIndex(BODY_RULES)
const put = (url: string, body: unknown) => computeBodyEvent(idx, 'PUT', url, body)

describe('BodyRules — 群资料/设置真实规则命中', () => {
    it('PUT /groups/:id name→改名, notice→改公告', () => {
        expect(put('/api/v1/groups/g1', JSON.stringify({ name: 'x' }))).toBe('group_name_edited')
        expect(put('/api/v1/groups/g1', JSON.stringify({ notice: 'x' }))).toBe('group_announcement_edited')
    })

    it('PUT incoming-webhooks/:id: 有 status→启停, 否则→编辑(fallback)', () => {
        expect(put('/api/v1/groups/g1/incoming-webhooks/w1', JSON.stringify({ status: 1 }))).toBe(
            'webhook_enabled_toggled',
        )
        expect(put('/api/v1/groups/g1/incoming-webhooks/w1', JSON.stringify({ name: 'hook' }))).toBe('webhook_edited')
    })

    it('PUT /groups/:id/setting 单键 → 各会话设置事件', () => {
        const s = (b: unknown) => put('/api/v1/groups/g1/setting', JSON.stringify(b))
        expect(s({ mute: 1 })).toBe('conversation_muted')
        expect(s({ top: 1 })).toBe('conversation_pinned')
        expect(s({ remark: 'vip' })).toBe('conversation_remark_edited')
        expect(s({ save: 1 })).toBe('conversation_saved_to_contacts')
        expect(s({ allow_no_mention: 1 })).toBe('group_bot_free_mention_toggled')
    })
})

describe('BodyRules — 隐私 / 边界', () => {
    const rules: BodyRule[] = [
        { method: 'PUT', path: '/api/v1/groups/:id', discriminators: [{ event: 'e_name', hasKeys: ['name'] }] },
        {
            method: 'POST',
            path: '/api/v1/foo/:id',
            discriminators: [{ event: 'e_enum', equals: { key: 'kind', values: ['a', 'b'] } }],
        },
    ]
    const i = buildBodyIndex(rules)

    it('非白名单端点:即使体是合法 JSON,也绝不解析/命中', () => {
        expect(computeBodyEvent(i, 'PUT', '/api/v1/secret/x', JSON.stringify({ name: 'y' }))).toBeUndefined()
    })

    it('只处理 JSON 字符串体:FormData/Blob/非串体一律跳过', () => {
        expect(computeBodyEvent(i, 'PUT', '/api/v1/groups/g1', { name: 'y' })).toBeUndefined()
        expect(computeBodyEvent(i, 'PUT', '/api/v1/groups/g1', undefined)).toBeUndefined()
        expect(computeBodyEvent(i, 'PUT', '/api/v1/groups/g1', new FormData())).toBeUndefined()
    })

    it('超大体(>64KB)不解析', () => {
        const big = JSON.stringify({ name: 'x'.repeat(70 * 1024) })
        expect(computeBodyEvent(i, 'PUT', '/api/v1/groups/g1', big)).toBeUndefined()
    })

    it('坏 JSON / 数组体 / 空体 → undefined(不抛)', () => {
        expect(computeBodyEvent(i, 'PUT', '/api/v1/groups/g1', '{bad')).toBeUndefined()
        expect(computeBodyEvent(i, 'PUT', '/api/v1/groups/g1', '[1,2]')).toBeUndefined()
        expect(computeBodyEvent(i, 'PUT', '/api/v1/groups/g1', '')).toBeUndefined()
    })

    it('method 大小写无关 / 未知 method → undefined', () => {
        expect(computeBodyEvent(i, 'put', '/api/v1/groups/g1', JSON.stringify({ name: 'y' }))).toBe('e_name')
        expect(computeBodyEvent(i, 'DELETE', '/api/v1/groups/g1', JSON.stringify({ name: 'y' }))).toBeUndefined()
    })

    it('equals:只白名单枚举值命中(值仅做相等比较,不外泄)', () => {
        expect(computeBodyEvent(i, 'POST', '/api/v1/foo/1', JSON.stringify({ kind: 'a' }))).toBe('e_enum')
        expect(computeBodyEvent(i, 'POST', '/api/v1/foo/1', JSON.stringify({ kind: 'zzz' }))).toBeUndefined()
    })

    it('顶层键缺失 → 不命中(presence-only,不误报)', () => {
        expect(computeBodyEvent(i, 'PUT', '/api/v1/groups/g1', JSON.stringify({ other: 1 }))).toBeUndefined()
    })
})

describe('BODY_RULES — 规则表不变量', () => {
    it('每条规则 method 大写 / path 以 / 开头 / 至少一个判别子', () => {
        for (const r of BODY_RULES) {
            expect(r.method).toBe(r.method.toUpperCase())
            expect(r.path.startsWith('/')).toBe(true)
            expect(r.discriminators.length).toBeGreaterThan(0)
            for (const d of r.discriminators) {
                expect(Boolean(d.hasKeys?.length || d.equals)).toBe(true)
                expect(d.event.length).toBeGreaterThan(0)
            }
        }
    })
})
