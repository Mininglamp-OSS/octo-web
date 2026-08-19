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

    // 命令式:任意 `.track('literal'|"literal", ...)` —— 既含 Dap.shared.track(页面站点),也含
    // Dap 内部 this.track('app_launched'|'http_request')。四审只钉 Dap.shared.前缀,漏了 this.track,
    // 于是 app_launched 这类内部命令式事件不进互斥集合、无法防回归(六审 P4)。放宽到 `.track(` 后
    // 仍要求首参为字面量,只多抓 this.track / 别名调用,不会误纳无关调用(需带引号事件名)。
    const IMPERATIVE_RE = /\.track\(\s*['"]([a-zA-Z0-9_]+)['"]/g
    // DOM:data-track="literal" 或 JSX data-track={ cond ? "literal" : undefined }。
    // 放宽以容忍可选的 `{` 包裹与「点号标识符 ? 」三元前缀(前缀本身不含引号,不会误吞比较字面量);
    // 纯变量表达式 data-track={settingKey} 无引号 → 不匹配(本就无法静态抽取),安全跳过。
    const DATATRACK_RE = /data-track=(?:\s*\{)?\s*(?:[\w.]+\s*\?\s*)?['"]([a-zA-Z0-9_]+)['"]/g

    const imperativeEvents = new Set<string>()
    const dataTrackEvents = new Set<string>()
    for (const f of files) {
        let src: string
        try { src = readFileSync(f, 'utf8') } catch { continue }
        for (const m of src.matchAll(IMPERATIVE_RE)) imperativeEvents.add(m[1])
        for (const m of src.matchAll(DATATRACK_RE)) dataTrackEvents.add(m[1])
    }

    it('扫描确实覆盖到源码(自检:抽到了已知的命令式事件)', () => {
        // 反测:若扫描根算错 / 正则失配,集合会空 → 守卫形同虚设。用稳定存在的命令式事件兜底。
        expect(files.length).toBeGreaterThan(50)
        expect(imperativeEvents.has('smart_summary_started')).toBe(true)
        expect(imperativeEvents.has('message_revoked')).toBe(true)
        // 六审 P4:钉死放宽后的正则确实抓到 Dap 内部 this.track('app_launched')(旧 `Dap.shared.` 前缀抓不到)。
        expect(imperativeEvents.has('app_launched')).toBe(true)
        // 十二审:五类移出 path 通道、改命令式的事件必须被扫描抓到 —— 否则下面的「命令式 ⊥ 规则表」
        // 互斥断言对它们形同虚设(有人把它们再塞回 FETCH_RULES 时不会红)。逐一钉死扫描确有覆盖。
        expect(imperativeEvents.has('conversation_cleared')).toBe(true)      // channelSettingActions + Chat/vm
        expect(imperativeEvents.has('apps_module_entered')).toBe(true)       // Main/index + tab_low_screen(apps/web)
        expect(imperativeEvents.has('space_join_new')).toBe(true)           // SpaceService + Layout + InviteLanding
        expect(imperativeEvents.has('group_avatar_edited')).toBe(true)       // ChannelAvatar 两个编辑分支
        expect(imperativeEvents.has('settings_secrets_opened')).toBe(true)   // SecretsSettingsPanel 挂载
        expect(imperativeEvents.has('settings_voice_toggled')).toBe(true)    // settings center voice toggle/consent handlers
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

/**
 * 十一审 🔴 相似问题守卫:同一张表内「一个手势 → 一个事件」——除非在显式白名单里(有意的滚入/别名)。
 * =====================================================================
 * 跨通道互斥已由上面两块钉死。但**同一张表内**允许多条规则映射到同一事件(如群/子区滚入、登录别名),
 * 这类「有意的多对一」若不显式登记,回归时新塞的重复无法与「有意滚入」区分。本块把每张表里
 * 「事件 → 命中它的不同端点(method+path)集合」算出来,凡集合 >1 的事件**必须**出现在该表白名单,
 * 且白名单里的每一项**必须**当前确为重复(双向相等)——既防新增未登记的重复,也防白名单腐烂(留下
 * 早已不重复的陈项)。任一方向不符立即红,逼迫作者在白名单里写下「为什么这个事件由多条规则发」。
 *
 * 白名单语义 = 该事件的多条规则是**同一次用户手势的不同作用域/入口**,产品上就该记同一事件:
 *   - 群/子区滚入(subchannel-inclusion policy,见 FetchRules 头):webhook_* / group_md_edited / group_name_edited
 *   - 会话设置跨群/DM/子区三作用域同构:conversation_remark_edited / _saved_to_contacts
 *     (mute/pin 已改命令式补点、退出 BODY 表,故不在此列;见 review M3/B4)
 *   - 登录双入口(账号 / 邮箱)同为一次登录:user_login
 *   - 密钥「配置」= 新建(POST)或更新(PUT)同一动作:settings_secrets_configured
 *   - 市场「发布」跨 mcp / skill 两个目录同一手势:market_manual_publish_submitted
 *
 * 仅覆盖 FETCH / BODY 两条**后端调用驱动**通道:一次真实后端调用被两条同事件规则命中 = 真·双计。
 * TRACK(DOM 锚点)**不在此约束**:一个事件在 DOM 层锚到多个 testid(工具栏 + 菜单等不同入口)是常态,
 * 单次点击只命中一个元素 → 一个 testid → 一次 event,不同 testid 是互斥手势,不构成双计(见头块
 * 「FETCH/TRACK 允许同名多条」)。故 TRACK 的表内重名由 TrackRules 自身语义保证,不进本守卫。
 */
describe('中央映射通道 —— 表内「一手势一事件」守卫(重复映射须显式登记,十一审 🔴)', () => {
    // 收集「事件 → 命中它的不同端点(method+path)」。FETCH_IGNORE 是哨兵不计。
    const endpointsByEvent = (pairs: Array<{ event: string; method: string; path: string }>) => {
        const m = new Map<string, Set<string>>()
        for (const p of pairs) {
            if (p.event === FETCH_IGNORE) continue
            const s = m.get(p.event) ?? new Set<string>()
            s.add(`${p.method.toUpperCase()} ${p.path}`)
            m.set(p.event, s)
        }
        return m
    }
    const dupEvents = (m: Map<string, Set<string>>) =>
        new Set([...m.entries()].filter(([, s]) => s.size > 1).map(([e]) => e))

    // 各表当前「有意的多对一」白名单(改动这里 = 承认新增了一处滚入/别名,须在上方注释写明理由)。
    const cases: Array<{ name: string; dup: Set<string>; allow: Set<string> }> = [
        {
            name: 'FETCH_RULES',
            dup: dupEvents(endpointsByEvent(FETCH_RULES.map((r) => ({ event: r.event, method: r.method, path: r.path })))),
            allow: new Set([
                'user_login',
                'settings_secrets_configured',
                'market_manual_publish_submitted',
                'group_md_edited',
                'webhook_created',
                'webhook_url_reset',
                'webhook_tested',
                'webhook_deleted',
            ]),
        },
        {
            name: 'BODY_RULES',
            dup: dupEvents(
                endpointsByEvent(
                    BODY_RULES.flatMap((r) => {
                        const evs = [...r.discriminators.map((d) => d.event), ...(r.fallbackEvent ? [r.fallbackEvent] : [])]
                        return evs.map((event) => ({ event, method: r.method, path: r.path }))
                    })
                )
            ),
            allow: new Set([
                'group_name_edited',
                'conversation_remark_edited',
                'conversation_saved_to_contacts',
                'webhook_enabled_toggled',
                'webhook_edited',
            ]),
        },
    ]

    for (const c of cases) {
        it(`${c.name}:未登记的重复映射立即红(新增滚入必须写进白名单)`, () => {
            const unlisted = [...c.dup].filter((e) => !c.allow.has(e)).sort()
            expect(unlisted, `${c.name} 出现未登记的多对一映射:\n${unlisted.join('\n')}`).toEqual([])
        })

        it(`${c.name}:白名单不得腐烂(登记项必须当前确为重复)`, () => {
            const stale = [...c.allow].filter((e) => !c.dup.has(e)).sort()
            expect(stale, `${c.name} 白名单存在已不再重复的陈项(应删除):\n${stale.join('\n')}`).toEqual([])
        })
    }
})
