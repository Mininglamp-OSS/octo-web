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

    it('子区改名 PUT /groups/:g/threads/:t name→group_name_edited(十一审 🔴,与群改名归一)', () => {
        // updateChannelSettingThreadName → updateThread(PUT groups/:g/threads/:t {name});群级 body 规则
        // (3 段)不命中子区路径(5 段),原本漏计。按子区滚入策略发同一 group_name_edited。
        expect(put('/api/v1/groups/g1/threads/t1', JSON.stringify({ name: 'x' }))).toBe('group_name_edited')
        // 无 name 键(未来若新增其它子区单键 PUT)当前不命中,不误报。
        expect(put('/api/v1/groups/g1/threads/t1', JSON.stringify({ other: 1 }))).toBeUndefined()
    })

    it('PUT incoming-webhooks/:id: 有 status→启停, 否则→编辑(fallback)', () => {
        expect(put('/api/v1/groups/g1/incoming-webhooks/w1', JSON.stringify({ status: 1 }))).toBe(
            'webhook_enabled_toggled',
        )
        expect(put('/api/v1/groups/g1/incoming-webhooks/w1', JSON.stringify({ name: 'hook' }))).toBe('webhook_edited')
    })

    it('子区 thread 作用域 webhook PUT 同样区分启停/编辑(十审 🔴)', () => {
        // IncomingWebhookService.update 在 threadShortId 存在时切到 threads/:t 嵌套路径;群级 body 规则
        // 段数固定不命中,须有平行 thread 规则,否则子区 webhook 的 启停/编辑 漏计。
        expect(
            put('/api/v1/groups/g1/threads/t1/incoming-webhooks/w1', JSON.stringify({ status: 0 })),
        ).toBe('webhook_enabled_toggled')
        expect(
            put('/api/v1/groups/g1/threads/t1/incoming-webhooks/w1', JSON.stringify({ name: 'hook' })),
        ).toBe('webhook_edited')
    })

    it('PUT /groups/:id/setting 单键 → 各会话设置事件', () => {
        const s = (b: unknown) => put('/api/v1/groups/g1/setting', JSON.stringify(b))
        // mute/top 已改为 channelSettingActions 命令式补点,不再声明式命中(见 review M3/B4)。
        expect(s({ mute: 1 })).toBeUndefined()
        expect(s({ top: 1 })).toBeUndefined()
        expect(s({ remark: 'vip' })).toBe('conversation_remark_edited')
        expect(s({ save: 1 })).toBe('conversation_saved_to_contacts')
        // allow_no_mention→group_bot_free_mention_toggled 已改为 groupManagementActions 收口点命令式补点
        // (带 channel_id+enabled;body 通道拿不到这俩关键属性),不再声明式命中,避免双计(见 review B)。
        expect(s({ allow_no_mention: 1 })).toBeUndefined()
    })

    it('关闭(值=0)不得记成开启:save 用 equals[1] 判值(见六审 P1a)', () => {
        // */setting 的调用方对开关两个方向都发同一顶层键(channelSettingActions.ts:
        // saveChannel {save: on?1:0})。若判别子用 presence-only 的 hasKeys,{save:0} 会被记成
        // conversation_saved_to_contacts → 计数被反向操作虚增。改 equals{values:[1]} 后 0 值不命中。
        const g = (b: unknown) => put('/api/v1/groups/g1/setting', JSON.stringify(b))
        const u = (b: unknown) => put('/api/v1/users/u1/setting', JSON.stringify(b))
        const th = (b: unknown) => put('/api/v1/groups/g1/threads/t1/setting', JSON.stringify(b))
        for (const s of [g, u, th]) {
            expect(s({ save: 0 })).toBeUndefined()
        }
        // remark 是「编辑」语义、无关闭态,保持 presence-only,任何值都记一次编辑。
        expect(g({ remark: '' })).toBe('conversation_remark_edited')
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

    it('无「同 method + 同 path 形状」的重复规则(排序歧义 / 静默盖住的前提)', () => {
        // 同一 method 下,若两条规则编译出完全相同的段形状(字面段相同、通配位相同),
        // 谁先命中取决于表内顺序,是潜在的错归属源。钉死为唯一。
        const seen = new Map<string, string>()
        for (const r of BODY_RULES) {
            const shape = r.path
                .split('/')
                .filter((s) => s !== '')
                .map((s) => (s.charCodeAt(0) === 58 ? ':' : s))
                .join('/')
            const key = `${r.method.toUpperCase()} ${shape}`
            expect(seen.has(key), `重复规则形状: ${key}(与 ${seen.get(key)} 撞形)`).toBe(false)
            seen.set(key, r.path)
        }
    })

    it('most-specific-wins:同段数下字面规则先于通配 fallback 规则命中(排序生效)', () => {
        // 构造一条通配 fallbackEvent 规则 + 一条同段数字面规则,验证字面规则赢(不被通配 fallback 盖住)。
        const rules: BodyRule[] = [
            { method: 'PUT', path: '/api/v1/x/:id', discriminators: [{ event: 'wild_fallback', hasKeys: ['zzz'] }], fallbackEvent: 'wild_fallback' },
            { method: 'PUT', path: '/api/v1/x/lit', discriminators: [{ event: 'literal_hit', hasKeys: ['k'] }] },
        ]
        const i = buildBodyIndex(rules)
        // /x/lit 同时匹配两条(字面 + 通配),字面规则更具体应先命中其判别子;
        // body 不带 k 时字面规则判别子不中,但字面规则无 fallback → 落到通配规则 fallback。
        expect(computeBodyEvent(i, 'PUT', '/api/v1/x/lit', JSON.stringify({ k: 1 }))).toBe('literal_hit')
        // 通配规则仍对其它 id 生效。
        expect(computeBodyEvent(i, 'PUT', '/api/v1/x/other', JSON.stringify({ anything: 1 }))).toBe('wild_fallback')
    })
})

describe('BODY_RULES — fleet(Loop)body 键通道真实命中', () => {
    const idx = buildBodyIndex(BODY_RULES)
    const j = JSON.stringify

    it('POST issues:带 parent_issue_id=子任务,否则兜底=新建任务', () => {
        expect(computeBodyEvent(idx, 'POST', '/fleet/api/v1/issues', j({ parent_issue_id: 'i1', title: 'x' }))).toBe('task_subtask_created')
        expect(computeBodyEvent(idx, 'POST', '/fleet/api/v1/issues', j({ title: 'x' }))).toBe('task_created')
        // undefined 键被 JSON.stringify 省略,presence 判别不误命中。
        expect(computeBodyEvent(idx, 'POST', '/fleet/api/v1/issues', j({ title: 'x', parent_issue_id: undefined }))).toBe('task_created')
    })

    it('PUT issues/:id:单键 inline patch 各归属,其余兜底=详情编辑', () => {
        expect(computeBodyEvent(idx, 'PUT', '/fleet/api/v1/issues/i1', j({ status: 'done' }))).toBe('task_status_changed')
        expect(computeBodyEvent(idx, 'PUT', '/fleet/api/v1/issues/i1', j({ priority: 2 }))).toBe('task_priority_changed')
        expect(computeBodyEvent(idx, 'PUT', '/fleet/api/v1/issues/i1', j({ assignee_id: 'u1', assignee_type: 'user' }))).toBe('task_assignee_changed')
        expect(computeBodyEvent(idx, 'PUT', '/fleet/api/v1/issues/i1', j({ project_id: 'p1' }))).toBe('task_project_changed')
        expect(computeBodyEvent(idx, 'PUT', '/fleet/api/v1/issues/i1', j({ title: 'new', description: 'd' }))).toBe('task_detail_edited')
        // 改父任务无独立事件,落兜底。
        expect(computeBodyEvent(idx, 'PUT', '/fleet/api/v1/issues/i1', j({ parent_issue_id: 'i0' }))).toBe('task_detail_edited')
    })

    it('PATCH autopilots/:id:status 枚举=启停,其余单键各归属,无兜底', () => {
        expect(computeBodyEvent(idx, 'PATCH', '/fleet/api/v1/autopilots/a1', j({ status: 'paused' }))).toBe('automation_enabled_toggled')
        expect(computeBodyEvent(idx, 'PATCH', '/fleet/api/v1/autopilots/a1', j({ status: 'active' }))).toBe('automation_enabled_toggled')
        expect(computeBodyEvent(idx, 'PATCH', '/fleet/api/v1/autopilots/a1', j({ description: 'x' }))).toBe('automation_instruction_saved')
        expect(computeBodyEvent(idx, 'PATCH', '/fleet/api/v1/autopilots/a1', j({ title: 'x' }))).toBe('automation_renamed')
        expect(computeBodyEvent(idx, 'PATCH', '/fleet/api/v1/autopilots/a1', j({ assignee_type: 'expert', assignee_id: 'e1' }))).toBe('automation_executor_changed')
        expect(computeBodyEvent(idx, 'PATCH', '/fleet/api/v1/autopilots/a1', j({ project_id: 'p1' }))).toBe('automation_target_project_changed')
        // status 非枚举值(如非启停语义)不误命中启停,无兜底 → undefined。
        expect(computeBodyEvent(idx, 'PATCH', '/fleet/api/v1/autopilots/a1', j({ status: 'archived' }))).toBeUndefined()
    })

    it('PATCH autopilots/:id/triggers/:id(段数 7,与 autopilots/:id 互斥):编辑 vs 启停', () => {
        expect(computeBodyEvent(idx, 'PATCH', '/fleet/api/v1/autopilots/a1/triggers/t1', j({ cron_expression: '0 9 * * *', timezone: 'UTC' }))).toBe('automation_trigger_edited')
        expect(computeBodyEvent(idx, 'PATCH', '/fleet/api/v1/autopilots/a1/triggers/t1', j({ enabled: false }))).toBe('automation_trigger_toggled')
    })

    it('POST squads/:id/members:presence 打 expert_team_member_added', () => {
        expect(computeBodyEvent(idx, 'POST', '/fleet/api/v1/squads/s1/members', j({ member_id: 'm1', member_type: 'user', role: 'x' }))).toBe('expert_team_member_added')
    })

    it('POST webhook-subscriptions:带 project_id=项目 webhook,否则兜底=工作区 webhook', () => {
        expect(computeBodyEvent(idx, 'POST', '/fleet/api/v1/webhook-subscriptions', j({ project_id: 'p1', url: 'u' }))).toBe('project_webhook_added')
        expect(computeBodyEvent(idx, 'POST', '/fleet/api/v1/webhook-subscriptions', j({ url: 'u' }))).toBe('workspace_webhook_added')
    })

    it('白名单门:未登记端点不读 body,返回 undefined', () => {
        expect(computeBodyEvent(idx, 'POST', '/fleet/api/v1/projects', j({ name: 'x' }))).toBeUndefined()
        expect(computeBodyEvent(idx, 'PUT', '/fleet/api/v1/skills/sk1', j({ name: 'x' }))).toBeUndefined()
    })
})
