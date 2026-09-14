import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FETCH_RULES, FETCH_IGNORE } from '../FetchRules'
import { BODY_RULES } from '../BodyRules'
import { TRACK_RULES, matchRoute } from '../TrackRules'

/**
 * 收敛物一致性守卫(DAP-94 缺陷 D1/D2 的回归防线)。
 * =====================================================================
 * DAP_EVENTS.md 自称是「Review this table, not the diff」的单一收敛物 —— 前提是它枚举了每一个
 * 已 wire 的 octo-web-native 事件。dap350(#1443)把 100+ 个 fleet/doc 事件写进三张中央规则表
 * (FetchRules / BodyRules / TrackRules)后,DAP_EVENTS.md 一度严重滞后(计数/PR 号/范围表述失真、
 * 108 条 fleet/doc + webhook_edited 缺行),而 channelUniqueness 只 import 三张规则表、从不读收敛物,
 * 没有任何守卫会因此变红 —— 收敛物滞后被 CI 静默放过(DAP-94 D1)。
 *
 * 本守卫补上这条边:**每一个出现在三张规则表里的事件名,都必须在 DAP_EVENTS.md 里有一行文档**
 * (首列 `event` 反引号单元格)。有人日后往规则表新增一条规则却忘了补收敛物 → 立即红,逼其同步。
 *
 * 方向是单向的(规则表 ⊆ 收敛物):收敛物里还额外文档化了 imperative / helper / data-track / infra
 * 事件,它们不在规则表内、也无法在此静态枚举其站点,故不作反向断言。FETCH_IGNORE 是抑制哨兵、
 * 非事件名,排除。
 */

/** 三张规则表的事件名并集(排除 FETCH_IGNORE 哨兵)。 */
function ruleTableEvents(): Set<string> {
    const s = new Set<string>()
    for (const r of FETCH_RULES) if (r.event !== FETCH_IGNORE) s.add(r.event)
    for (const r of BODY_RULES) {
        for (const d of r.discriminators) s.add(d.event)
        if (r.fallbackEvent) s.add(r.fallbackEvent)
    }
    for (const r of TRACK_RULES) s.add(r.event)
    return s
}

/** 定位 DAP_EVENTS.md:从 cwd 起向上找,兼容「从包目录跑」与「从仓库根跑」两种 cwd。 */
function findDapEventsMd(): string {
    let dir = process.cwd()
    for (let i = 0; i < 8; i++) {
        for (const rel of ['src/Service/DAP_EVENTS.md', 'packages/dmworkbase/src/Service/DAP_EVENTS.md']) {
            const p = join(dir, rel)
            if (existsSync(p)) return p
        }
        const parent = resolve(dir, '..')
        if (parent === dir) break
        dir = parent
    }
    throw new Error('找不到 DAP_EVENTS.md')
}

/** 从 DAP_EVENTS.md 抽取「已文档化的事件名」= 每张表首列 `\`event\`` 反引号单元格。 */
function documentedEvents(): Set<string> {
    const md = readFileSync(findDapEventsMd(), 'utf8')
    const s = new Set<string>()
    for (const m of md.matchAll(/^\|\s*`([a-zA-Z0-9_]+)`\s*\|/gm)) s.add(m[1])
    return s
}

describe('DAP_EVENTS.md 收敛物一致性(D1/D2 回归守卫)', () => {
    const documented = documentedEvents()

    it('自检:收敛物被找到并解析出足够多的事件行(否则守卫形同虚设)', () => {
        // 反测:若路径算错 / 正则失配,集合会空 → 下面的 ⊆ 断言恒真。用一个稳定阈值 + 已知事件兜底。
        expect(documented.size).toBeGreaterThan(200)
        expect(documented.has('user_login')).toBe(true) // §1 fetch
        expect(documented.has('webhook_edited')).toBe(true) // D2:im/base body fallback
        expect(documented.has('task_opened')).toBe(true) // §6 fleet(R6 起为 imperative(loop) 行,仍文档化)
        expect(documented.has('document_created')).toBe(true) // §6 doc fetch
    })

    it('每个中央规则表事件都在 DAP_EVENTS.md 有文档行(规则表 ⊆ 收敛物)', () => {
        const undocumented = [...ruleTableEvents()].filter((e) => !documented.has(e)).sort()
        expect(
            undocumented,
            `以下规则表事件在 DAP_EVENTS.md 无文档行(新增规则须同步补收敛物):\n${undocumented.join('\n')}`,
        ).toEqual([])
    })
})

/**
 * TRACK_RULES 路由门不变量(R13 B5 pin)。
 * =====================================================================
 * route 门曾静默放错值(/docs vs /d):两条 doc 规则挂上门后事件三轮全死,而全部既有守卫
 * (channelUniqueness / 旧 dapEventsCoverage)只比事件名,看不见 route 字段 —— 门打错值、甚至把
 * 门整个删掉,套件都全绿。本守卫钉住两个方向:
 *   1. **可达性**:每条带 route 的规则,其门必须至少命中一个「已声明真实命名空间」样本
 *      (样本来自路由/场景判定的事实源,如 documentScene.ts 的 /d 与 /ppt/d)—— 门写错值即红;
 *   2. **文档一致**:该事件的 DAP_EVENTS.md 行必须逐 token 写明相同的门(反引号包裹)——
 *      收敛物行与代码门漂移(如行写 /docs 而门是 /d)即红。
 * 自检钉住「确有带门规则」,防规则全删 route 后守卫空转。
 */
describe('TRACK_RULES 路由门 —— 可达性 + 收敛物 token 一致(R13 B5 pin)', () => {
    // 已声明真实命名空间样本:与 documentScene.ts / 路由表对齐的宿主真实路径前缀。
    // 新增 route 门规则若落在未见命名空间,把该命名空间的真实样本路径补进来(须有事实源)。
    const REAL_PATH_SAMPLES = [
        '/d/d_abc123', // 标准独立文档(documentScene.ts STANDALONE_DOC_PATH)
        '/ppt/d/abc123', // slides 独立文档(documentScene.ts STANDALONE_PPT_DOC_PATH)
        '/docs', // 同壳文档列表页
        '/market', // 插件市场
        '/loop', // Loop 工作区(octo-loop-module dmloop/src/module.tsx route.register('/loop')):project-*/automation-* 控件宿主
        '/personal', // 个人工作区(octo-loop-module dmpersonal/src/module.tsx route.register('/personal')):runtime-*/skill-* 控件宿主
        '/fleet', // Loop 任务板
        '/projects', // 项目工作表
        '/s/share', // summary 分享页
    ]
    const gated = TRACK_RULES.filter((r) => r.route)

    it('自检:确有 route 门规则被覆盖(否则守卫空转)', () => {
        expect(gated.length).toBeGreaterThan(0)
    })

    it.each(gated.map((r) => [r.event, r.route] as const))(
        '%s 的 route 门至少命中一个已声明真实命名空间',
        (event, route) => {
            const ok = REAL_PATH_SAMPLES.some((p) => matchRoute(route, p))
            expect(
                ok,
                `${event} 的 route 门 ${JSON.stringify(route)} 不命中任何已声明真实命名空间 —— 该事件在这些命名空间下全部死亡`,
            ).toBe(true)
        },
    )

    it.each(gated.map((r) => [r.event, r.route] as const))(
        '%s 的 DAP_EVENTS.md 行逐 token 写明了相同的门',
        (event, route) => {
            const md = readFileSync(findDapEventsMd(), 'utf8')
            const row = md.match(new RegExp(`^\\|\\s*\\\`${event}\\\`\\s*\\|.*$`, 'm'))
            expect(row, `${event} 在 DAP_EVENTS.md 无文档行`).toBeTruthy()
            const tokens = Array.isArray(route) ? route : [route!]
            for (const t of tokens) {
                expect(
                    row![0].includes('`' + t + '`'),
                    `${event} 的收敛物行未写明门 token \`${t}\`(文档与代码门漂移)`,
                ).toBe(true)
            }
        },
    )
})
