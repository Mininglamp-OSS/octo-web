import { describe, it, expect } from 'vitest'
import { FETCH_RULES, buildFetchIndex, matchFetchEvent, rawPathname, type FetchRule } from '../FetchRules'

/**
 * FetchRules —— 中央映射·path 通道(①)的匹配器与规则表守卫。
 * 重点:段级通配 + most-specific-wins 的正确性;method 分桶;rawPathname 隐私(去 query/origin);
 * 以及规则表本身的两条不变量(同 method 无等具体度歧义、事件名/形状齐全)——它们是"0 残留碰撞"
 * 结论的运行时钉子,后续增删规则若破坏立即红。
 */

describe('FetchRules — matchFetchEvent 语义', () => {
    const rules: FetchRule[] = [
        { method: 'GET', path: '/fleet/api/v1/issues/search', event: 'task_board_filtered' },
        { method: 'GET', path: '/fleet/api/v1/issues/:id', event: 'task_opened' },
        { method: 'POST', path: '/fleet/api/v1/issues/:id/comments', event: 'task_commented' },
        { method: 'DELETE', path: '/fleet/api/v1/issues/:id', event: 'task_deleted' },
    ]
    const idx = buildFetchIndex(rules)

    it('字面段精确命中', () => {
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues/search')).toBe('task_board_filtered')
    })

    it('通配段匹配任意单段', () => {
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues/12345')).toBe('task_opened')
        expect(matchFetchEvent(idx, 'POST', '/fleet/api/v1/issues/abc/comments')).toBe('task_commented')
    })

    it('most-specific-wins:字面规则压过通配规则(/issues/search 不落到 :id)', () => {
        // search 同时能匹配 /issues/search 与 /issues/:id,取通配更少者。
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues/search')).toBe('task_board_filtered')
    })

    it('method 分桶:同 path 不同 verb 命中不同事件', () => {
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues/x')).toBe('task_opened')
        expect(matchFetchEvent(idx, 'DELETE', '/fleet/api/v1/issues/x')).toBe('task_deleted')
    })

    it('method 大小写无关', () => {
        expect(matchFetchEvent(idx, 'get', '/fleet/api/v1/issues/x')).toBe('task_opened')
    })

    it('段数不同 / 未知 method / 无命中 → undefined', () => {
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues/x/y')).toBeUndefined()
        expect(matchFetchEvent(idx, 'PUT', '/fleet/api/v1/issues/x')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/nope')).toBeUndefined()
    })
})

describe('FetchRules — rawPathname 只取路径(隐私:去 query / 去 origin)', () => {
    it('相对 URL', () => {
        expect(rawPathname('/api/v1/docs/42/view')).toBe('/api/v1/docs/42/view')
    })
    it('绝对 URL 去 origin', () => {
        expect(rawPathname('https://x.example.com/api/v1/docs/42/view')).toBe('/api/v1/docs/42/view')
    })
    it('去 query,不泄露 query 值', () => {
        const p = rawPathname('/api/v1/messages/_search_files?q=secret')
        expect(p).toBe('/api/v1/messages/_search_files')
        expect(p.includes('secret')).toBe(false)
    })
    it('空串经 base 解析为 "/"(无害:匹配不到任何规则)', () => {
        expect(rawPathname('')).toBe('/')
    })
})

describe('FETCH_RULES — 规则表不变量', () => {
    it('每条规则形状齐全(method 大写 / path 以 / 开头 / event 非空)', () => {
        for (const r of FETCH_RULES) {
            expect(r.method, r.event).toBe(r.method.toUpperCase())
            expect(r.path.startsWith('/'), `${r.event} path=${r.path}`).toBe(true)
            expect(r.event.length).toBeGreaterThan(0)
        }
    })

    it('同 method 下无"等具体度且路径重叠"的真歧义(most-specific-wins 可完全消歧)', () => {
        // 两条规则重叠 = 段数相同且逐段(字面相等 | 任一方通配);重叠且通配数相等 → 真歧义。
        const isWild = (s: string) => s.startsWith(':')
        const segs = (p: string) => p.split('/').filter(Boolean)
        const overlap = (a: string, b: string) => {
            const A = segs(a), B = segs(b)
            if (A.length !== B.length) return false
            return A.every((x, i) => isWild(x) || isWild(B[i]) || x === B[i])
        }
        const nWild = (p: string) => segs(p).filter(isWild).length
        const byMethod = new Map<string, FetchRule[]>()
        for (const r of FETCH_RULES) {
            const arr = byMethod.get(r.method) ?? []
            arr.push(r)
            byMethod.set(r.method, arr)
        }
        const ambiguous: string[] = []
        for (const arr of byMethod.values()) {
            for (let i = 0; i < arr.length; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    if (arr[i].event === arr[j].event) continue
                    if (overlap(arr[i].path, arr[j].path) && nWild(arr[i].path) === nWild(arr[j].path)) {
                        ambiguous.push(`${arr[i].method} ${arr[i].path}(${arr[i].event}) <> ${arr[j].path}(${arr[j].event})`)
                    }
                }
            }
        }
        expect(ambiguous, ambiguous.join('\n')).toEqual([])
    })

    it('每条真实规则都能被自身 path 的具体化实例命中(通配段代入具体值)', () => {
        const idx = buildFetchIndex(FETCH_RULES)
        for (const r of FETCH_RULES) {
            const concrete = r.path
                .split('/')
                .map((s) => (s.startsWith(':') ? '12345' : s))
                .join('/')
            // 命中的事件不一定是 r.event(可能有更具体的字面规则夺走),但必须有命中。
            expect(matchFetchEvent(idx, r.method, concrete), `${r.method} ${r.path}`).toBeTruthy()
        }
    })
})
