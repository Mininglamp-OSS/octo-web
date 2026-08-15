import { describe, it, expect } from 'vitest'
import { FETCH_RULES, FETCH_IGNORE } from '../FetchRules'
import { BODY_RULES } from '../BodyRules'
import { TRACK_RULES } from '../TrackRules'

/**
 * 跨通道「一个事件只走一个通道」不变量守卫(dap350 二审 reviewer #8)。
 * =====================================================================
 * 三条中央映射通道各自的事件名集合**互不相交**——同一 event 若同时出现在 path 通道(①)、
 * body 通道(②)、DOM 锚点通道(③)里,一次真实动作就会被 2xx + body + click 多路重复上报
 * (「隐性双计」)。命令式 Dap.shared.track 站点不在表里、无法在此静态断言,但把三张**声明式规则表**
 * 钉成互斥,已封住绝大多数回归入口:后续有人把某个已在别处采集的事件又塞进某张表,立即红。
 *
 * FETCH_IGNORE 是哨兵(命中即静默、不产出事件),不是真实事件名,排除在外。
 */

/** 收集某张 body 规则表里出现的全部事件名(判别子 + 兜底)。 */
function bodyEventNames(): Set<string> {
    const s = new Set<string>()
    for (const r of BODY_RULES) {
        for (const d of r.discriminators) s.add(d.event)
        if (r.fallbackEvent) s.add(r.fallbackEvent)
    }
    return s
}

describe('中央映射通道 —— 事件名跨通道唯一(无隐性双计)', () => {
    const fetchEvents = new Set(FETCH_RULES.map((r) => r.event).filter((e) => e !== FETCH_IGNORE))
    const bodyEvents = bodyEventNames()
    const trackEvents = new Set(TRACK_RULES.map((r) => r.event))

    const tables: Array<[string, Set<string>]> = [
        ['FETCH_RULES', fetchEvents],
        ['BODY_RULES', bodyEvents],
        ['TRACK_RULES', trackEvents],
    ]

    it('任一事件名最多只出现在三张规则表中的一张(通道互斥)', () => {
        const collisions: string[] = []
        for (let i = 0; i < tables.length; i++) {
            for (let j = i + 1; j < tables.length; j++) {
                const [an, a] = tables[i]
                const [bn, b] = tables[j]
                for (const e of a) {
                    if (b.has(e)) collisions.push(`${e}: 同时在 ${an} 与 ${bn}`)
                }
            }
        }
        expect(collisions, collisions.join('\n')).toEqual([])
    })

    it('每张表内部事件名无重复(同一通道内不重复登记)', () => {
        // FETCH/TRACK 允许同名多条(不同 method/testid 指向同一事件),这里只钉「表内不出现空事件名」。
        for (const [name, set] of tables) {
            expect(set.size, `${name} 存在空事件名`).toBeGreaterThan(0)
            for (const e of set) expect(e.length, `${name} 空事件名`).toBeGreaterThan(0)
        }
    })
})
