import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

/**
 * 四审 P2-4:把「命令式 Dap.shared.track('<字面>')」与「data-track="<字面>"」两类站点也折进互斥断言。
 * =====================================================================
 * 原 channelUniqueness 只钉三张**声明式规则表**互斥,其头注自承「命令式站点不在表里、无法静态断言」——
 * 于是 message_revoked 这类「fetch 规则 + 命令式」跨通道双计能溜过守卫(四审 P1-1 即此类)。
 * 本块在测试期扫源码,抽出**字面量**事件名的命令式站点与 data-track 站点,与三张表凑成 5 个集合,
 * 断言两两不相交:任一事件只能落在唯一通道。若有人把某个已命令式采集的事件又塞进任一张表(或反之),立即红。
 *
 * 局限(与头注一致):只能抽**字符串字面量**。`Dap.shared.track(event, ...)`(变量,如 summaryApi 泛化收口、
 * botCommandEvent 映射)天然抽不到,不在本断言覆盖内——这类由各自的单一收口点 + 单测保证。
 */
function findRepoRoot(): string {
    let dir = process.cwd()
    for (let i = 0; i < 8; i++) {
        if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
        const parent = resolve(dir, '..')
        if (parent === dir) break
        dir = parent
    }
    throw new Error('找不到仓库根(pnpm-workspace.yaml)')
}

function collectSourceFiles(root: string): string[] {
    const roots = [
        join(root, 'packages'),
        join(root, 'apps'),
    ]
    const out: string[] = []
    const SKIP = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', '__tests__'])
    const walk = (dir: string) => {
        let entries: string[]
        try { entries = readdirSync(dir) } catch { return }
        for (const name of entries) {
            if (SKIP.has(name)) continue
            const full = join(dir, name)
            let st
            try { st = statSync(full) } catch { continue }
            if (st.isDirectory()) {
                walk(full)
            } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
                out.push(full)
            }
        }
    }
    for (const r of roots) {
        // 只进 <pkg>/src,避开配置/脚本
        let pkgs: string[]
        try { pkgs = readdirSync(r) } catch { continue }
        for (const p of pkgs) {
            const src = join(r, p, 'src')
            if (existsSync(src)) walk(src)
        }
    }
    return out
}

describe('中央映射通道 —— 命令式 / data-track 站点也与规则表互斥(四审 P2-4)', () => {
    const root = findRepoRoot()
    const files = collectSourceFiles(root)

    // 命令式:Dap.shared.track('literal' | "literal", ...)。只抽字面量首参。
    const IMPERATIVE_RE = /Dap\.shared\.track\(\s*['"]([a-zA-Z0-9_]+)['"]/g
    // DOM:data-track="literal"(与 data-testid 委托是两套机制;本仓当前约定不用 data-track,预期为空集)。
    const DATATRACK_RE = /data-track=\s*['"]([a-zA-Z0-9_]+)['"]/g

    const imperativeEvents = new Set<string>()
    const dataTrackEvents = new Set<string>()
    for (const f of files) {
        let src: string
        try { src = readFileSync(f, 'utf8') } catch { continue }
        for (const m of src.matchAll(IMPERATIVE_RE)) imperativeEvents.add(m[1])
        for (const m of src.matchAll(DATATRACK_RE)) dataTrackEvents.add(m[1])
    }

    it('扫描确实覆盖到源码(自检:抽到了已知的命令式事件)', () => {
        // 反测:若扫描根算错 / 正则失配,集合会空 → 守卫形同虚设。用两个稳定存在的命令式事件兜底。
        expect(files.length).toBeGreaterThan(50)
        expect(imperativeEvents.has('smart_summary_started')).toBe(true)
        expect(imperativeEvents.has('message_revoked')).toBe(true)
    })

    it('命令式站点事件名不得再出现在任何一张声明式规则表(否则跨通道双计)', () => {
        const fetchEvents = new Set(FETCH_RULES.map((r) => r.event).filter((e) => e !== FETCH_IGNORE))
        const bodyEvents = bodyEventNames()
        const trackEvents = new Set(TRACK_RULES.map((r) => r.event))
        const tableSets: Array<[string, Set<string>]> = [
            ['FETCH_RULES', fetchEvents],
            ['BODY_RULES', bodyEvents],
            ['TRACK_RULES(data-testid)', trackEvents],
        ]
        const collisions: string[] = []
        for (const ev of imperativeEvents) {
            for (const [name, set] of tableSets) {
                if (set.has(ev)) collisions.push(`${ev}: 命令式站点 与 ${name} 双通道`)
            }
        }
        expect(collisions, collisions.join('\n')).toEqual([])
    })

    it('data-track 站点事件名同样与三张表 + 命令式集合互斥', () => {
        const fetchEvents = new Set(FETCH_RULES.map((r) => r.event).filter((e) => e !== FETCH_IGNORE))
        const bodyEvents = bodyEventNames()
        const trackEvents = new Set(TRACK_RULES.map((r) => r.event))
        const others: Array<[string, Set<string>]> = [
            ['FETCH_RULES', fetchEvents],
            ['BODY_RULES', bodyEvents],
            ['TRACK_RULES(data-testid)', trackEvents],
            ['命令式', imperativeEvents],
        ]
        const collisions: string[] = []
        for (const ev of dataTrackEvents) {
            for (const [name, set] of others) {
                if (set.has(ev)) collisions.push(`${ev}: data-track 与 ${name} 双通道`)
            }
        }
        expect(collisions, collisions.join('\n')).toEqual([])
    })
})
