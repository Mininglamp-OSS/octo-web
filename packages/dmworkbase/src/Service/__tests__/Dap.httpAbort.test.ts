import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * http_request 原始事件已按 Option A 停发(前端不再上报「HTTP 请求」这条原始埋点,只保留
 * 2xx 命中的 mapped 业务事件)。fetch/XHR 包裹里的取消判定(isAbortError / XHR abort 标记)
 * 依旧保留 —— 它挡的是「被取消的在途请求不该被当成一次完成的请求处理」,但取消 / 失败本就落不到
 * 2xx,不再有任何 telemetry 产出。
 *
 * 本文件作为回归护栏,盯两组仍存活的路径:
 *   (A) 三种收尾(2xx 完成 / 用户取消 / 真实网络失败)都**不得**再产出原始 http_request。
 *   (B) **XHR 完成 loadend 仍会走 emit() 补发 2xx 映射事件**(path 通道 / body 通道),
 *       且被取消的 XHR(即便 status 落在 2xx)不得补发 —— 这正是本 PR 编辑到、但一度被
 *       误删测试守护的 XHR 上报路径(installHttpWrap 的 onLoadEnd → emit)。删掉该 emit,
 *       或删掉 `!aborted` 门,下面的断言即变红(delete-the-fix)。
 * 单独成文件:vitest 默认按文件隔离(全新 jsdom)。
 */

const BATCH_PATH = '/v1/e/b'
type FetchMock = ReturnType<typeof vi.fn>

async function freshTracker() {
    vi.resetModules()
    return import('../Dap')
}

function httpEvents(fetchMock: FetchMock): Array<{ props?: Record<string, unknown> }> {
    const out: Array<{ props?: Record<string, unknown> }> = []
    for (const c of fetchMock.mock.calls) {
        if (c[0] !== BATCH_PATH) continue
        const body = JSON.parse((c[1] as RequestInit).body as string)
        for (const e of body.events as Array<{ event_name: string; props?: Record<string, unknown> }>) {
            if (e.event_name === 'http_request') out.push(e)
        }
    }
    return out
}

/** 上报批次里的全部事件名(跨所有 /v1/e/b 批次)。 */
function batchEventNames(fetchMock: FetchMock): string[] {
    const names: string[] = []
    for (const c of fetchMock.mock.calls) {
        if (c[0] !== BATCH_PATH) continue
        const body = JSON.parse((c[1] as RequestInit).body as string)
        for (const e of body.events as Array<{ event_name: string }>) names.push(e.event_name)
    }
    return names
}

/**
 * 驱动一个 XHR 走完 open→send→(abort?)→loadend 的收尾。
 * jsdom 无真实响应:status 由测试显式钉住(shadow 掉原型 getter),loadend 手动派发,
 * 这与 wrapper「在 loadend 里读 this.status 决定是否补发映射」的真实路径完全一致。
 */
function driveXhr(
    method: string,
    url: string,
    opts: { status?: number; body?: string; abort?: boolean } = {},
): void {
    const x = new XMLHttpRequest()
    x.open(method, url)
    try {
        x.send(opts.body)
    } catch {
        /* jsdom 对无真实网络的 send 可能抛,不影响 wrapper 已挂好的监听 */
    }
    if (typeof opts.status === 'number') {
        Object.defineProperty(x, 'status', { value: opts.status, configurable: true })
    }
    // abort 必须先于 loadend 触发(与浏览器一致),wrapper 借此标记跳过。
    if (opts.abort) x.dispatchEvent(new Event('abort'))
    x.dispatchEvent(new Event('loadend'))
}

describe('Dap — 完成 / 取消 / 失败都不再产 http_request(Option A)', () => {
    beforeEach(() => {
        localStorage.clear()
        document.body.innerHTML = ''
    })
    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('fetch: 2xx / AbortError / 真实网络失败三种收尾都不产 http_request', async () => {
        const origin = location.origin
        // 上报通道恒 ok;/aborted 抛 AbortError(取消);/boom 抛普通错误(真实失败)
        const fetchMock: FetchMock = vi.fn((url: string) => {
            if (String(url).indexOf(BATCH_PATH) !== -1) return Promise.resolve({ ok: true, status: 200 } as Response)
            if (String(url).indexOf('/aborted') !== -1) {
                const e = new Error('aborted')
                e.name = 'AbortError'
                return Promise.reject(e)
            }
            if (String(url).indexOf('/boom') !== -1) return Promise.reject(new TypeError('network down'))
            return Promise.resolve({ ok: true, status: 200 } as Response)
        })
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock

        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        await globalThis.fetch(`${origin}/api/search`).catch(() => {}) // 正常 200 → 2xx
        await globalThis.fetch(`${origin}/api/search/aborted`).catch(() => {}) // 取消
        await globalThis.fetch(`${origin}/api/search/boom`).catch(() => {}) // 真实失败
        Dap.shared.flush()
        await Promise.resolve()

        // Option A:三种收尾都不再产出原始 http_request
        expect(httpEvents(fetchMock)).toHaveLength(0)
    })

    it('XHR: 完成 loadend 与取消都不产 http_request', async () => {
        const origin = location.origin
        const fetchMock: FetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock

        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        // 取消:abort 先于 loadend 触发 → wrapper 标记后 loadend 跳过
        driveXhr('GET', `${origin}/api/search/aborted`, { abort: true })
        // 完成:只走 loadend(无 abort)
        driveXhr('GET', `${origin}/api/other`, { status: 200 })

        Dap.shared.flush()
        await Promise.resolve()

        expect(httpEvents(fetchMock)).toHaveLength(0)
    })
})

describe('Dap — XHR loadend 仍走 emit 补发 2xx 映射事件(护栏:PR 编辑到的上报路径)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        document.body.innerHTML = ''
        fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })
    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('XHR: 2xx 命中 path 规则 → 补发映射事件(POST /api/v1/user/login → user_login)', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        // 走 XHR(非 fetch)完成一条命中 FETCH_RULES 的 2xx 请求:
        // onLoadEnd → emit(status=200) → path 通道 matchFetchEvent → track('user_login')。
        driveXhr('POST', `${location.origin}/api/v1/user/login`, { status: 200 })
        Dap.shared.flush()
        await Promise.resolve()

        const names = batchEventNames(fetchMock)
        expect(names).toContain('user_login') // 删掉 onLoadEnd 的 emit,这里立即变红
        expect(names).not.toContain('http_request') // 原始事件仍不产
    })

    it('XHR: 2xx 命中 body 规则 → 补发映射事件(PUT /groups/:id/setting {save:1} → conversation_saved_to_contacts)', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        // XHR body 通道:send 的字符串体在包裹处算出 bodyEvent,loadend(2xx)时经 emit 补发。
        driveXhr('PUT', `${location.origin}/api/v1/groups/g1/setting`, {
            status: 200,
            body: JSON.stringify({ save: 1, remark_secret: 'do-not-leak' }),
        })
        Dap.shared.flush()
        await Promise.resolve()

        const names = batchEventNames(fetchMock)
        expect(names).toContain('conversation_saved_to_contacts')
        expect(names).not.toContain('http_request')
        // 体里的任何值都不得随映射事件外泄
        const batchCall = fetchMock.mock.calls.find((c) => c[0] === BATCH_PATH)
        expect(JSON.stringify(batchCall![1]).includes('do-not-leak')).toBe(false)
    })

    it('XHR: 被取消(即便 status 落在 2xx)不补发映射事件(护栏 !aborted 门)', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        // 先产一条业务事件,保证有上报批次 —— 使「映射事件缺席」是真缺席,而非「压根没批次」。
        Dap.shared.track('_probe', {})
        // 命中 path 规则、status 200,但先 abort 再 loadend:wrapper 应标记跳过,不补发 user_login。
        driveXhr('POST', `${location.origin}/api/v1/user/login`, { status: 200, abort: true })
        Dap.shared.flush()
        await Promise.resolve()

        const names = batchEventNames(fetchMock)
        expect(names).toContain('_probe') // 批次确实发了
        expect(names).not.toContain('user_login') // 取消的请求不补发;删 `!aborted` 门这里变红
    })
})

/**
 * app_launched 守护（DAP-184，设计 v3 §6 / §5.1）：删 http_request 后仍必须可靠补发一次
 * app_launched。双触发 A（setEnabled 首启）+ B（emit 任意已完成的第一方请求），共用 token 门
 * 的幂等 maybeTrackLaunch()。为使每个补发点的变异可证伪,测试须把「另一条路径」隔离掉:
 *   - 隔离 A = setTokenProvider 在 setEnabled 之前就绪 → A 首启即锚定,不驱动任何请求(T0)。
 *   - 隔离 B = 先无 token setEnabled(A 首启即 no-op、此后不再触发)→ 再置 token → 驱动请求(T1/T2/T3/T5)。
 * 变异矩阵:删 A→T0 红;删 B→T1/T2 红;删 emit 的 isFirstParty 门→T5 与 B-2 红;
 *           删 maybeTrackLaunch 的 !currentToken() 门→T4 红。
 */
const DEVICE_ID_KEY = 'octo_track_device_id'

describe('Dap — app_launched 双触发守护(DAP-184 §6:A=setEnabled 首启 / B=emit)', () => {
    let fetchMock: FetchMock
    // 同文件内多个 setEnabled(true) 会在共享的 XMLHttpRequest.prototype 上层层叠加 emit 包裹
    // (installHttpWrap 幂等是**每实例**的,resetModules 换新单例但不卸旧包裹)。本组用例给不同
    // Dap 实例注入了 token,若不隔离,前一用例遗留的「已启用 + 有 token + launchTracked 未置位」
    // 实例会被后一用例的第一方 XHR loadend 触发,误发 app_launched / 误写 device_id(T4 会假红)。
    // 故在每个用例前后快照 / 还原原型方法,使每次至多只叠加本用例这一层。
    let baseOpen: typeof XMLHttpRequest.prototype.open
    let baseSend: typeof XMLHttpRequest.prototype.send
    beforeEach(() => {
        localStorage.clear()
        document.body.innerHTML = ''
        baseOpen = XMLHttpRequest.prototype.open
        baseSend = XMLHttpRequest.prototype.send
        fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })
    afterEach(() => {
        XMLHttpRequest.prototype.open = baseOpen
        XMLHttpRequest.prototype.send = baseSend
        document.body.innerHTML = ''
    })

    it('T0 — setEnabled 首启锚定(隔离 A,正向):token 先就绪 → setEnabled(true) → 不驱动任何请求 → 含 app_launched', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setTokenProvider(() => 'tok') // token 先就绪 → A 首启即锚定
        Dap.shared.setEnabled(true)
        Dap.shared.init()
        // 不驱动任何第一方请求:app_launched 只可能来自 A。
        Dap.shared.flush()
        await Promise.resolve()

        // 删 A(setEnabled 的 maybeTrackLaunch())→ 无任何触发 → 批次为空 → 本断言变红。
        expect(batchEventNames(fetchMock)).toContain('app_launched')
    })

    it('T1 — 未映射第一方 2xx 锚定(隔离 B,正向):先无 token 启用 → 再置 token → GET space/my 200 → 含 app_launched', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true) // 无 token → A 首启即 no-op、此后不再触发
        Dap.shared.init()
        Dap.shared.setTokenProvider(() => 'tok') // token 晚到 → 由 B 接手
        // 未映射端点(不在 FETCH_RULES)→ 唯一可能的事件是 B 的 maybeTrackLaunch。
        driveXhr('GET', `${location.origin}/api/v1/space/my`, { status: 200 })
        Dap.shared.flush()
        await Promise.resolve()

        // 删 B(emit 的 maybeTrackLaunch())→ 无任何触发(A 已被隔离)→ 批次为空 → 本断言变红。
        expect(batchEventNames(fetchMock)).toContain('app_launched')
    })

    it('T2 — 失败路径锚定(隔离 B,正向):先无 token 启用 → 再置 token → 未映射 4xx → 含 app_launched', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true) // 无 token → A no-op
        Dap.shared.init()
        Dap.shared.setTokenProvider(() => 'tok')
        // 非 abort 的失败(4xx)仍进 emit → 锚定 launch(无视 status);未映射端点故无 mapped 事件。
        driveXhr('GET', `${location.origin}/api/v1/space/my`, { status: 404 })
        Dap.shared.flush()
        await Promise.resolve()

        // 删 B → 失败路径不再锚定 → 批次为空 → 本断言变红。
        expect(batchEventNames(fetchMock)).toContain('app_launched')
    })

    it('T3 — abort 不锚定(负向):先无 token 启用(A no-op)→ 再置 token → abort → 不含 app_launched', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true) // 无 token → A no-op
        Dap.shared.init()
        Dap.shared.setTokenProvider(() => 'tok')
        // abort 先于 loadend → wrapper 标记跳过,emit 不执行 → maybeTrackLaunch 不触发。
        driveXhr('GET', `${location.origin}/api/v1/space/my`, { status: 200, abort: true })
        // 取消不入 emit → 无任何入队;A 已被隔离,故此负断言真实有效。
        expect(Dap.shared.getStats().queued).toBe(0)
        Dap.shared.flush()
        await Promise.resolve()
        expect(batchEventNames(fetchMock)).not.toContain('app_launched')
    })

    it('T4 — 匿名不锚定 + 不落盘(负向 + 正控):全程无 token → 未映射第一方 2xx → 不含 app_launched、无批次、无 device_id', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setTokenProvider(() => undefined) // 全程无 token
        Dap.shared.setEnabled(true)
        Dap.shared.init()
        // 端点必须未映射:mapped 端点的 2xx track 是无 token 门的业务事件,会真产批次 + 写 device_id,与断言冲突。
        driveXhr('GET', `${location.origin}/api/v1/space/my`, { status: 200 })
        Dap.shared.flush()
        await Promise.resolve()

        // 删 maybeTrackLaunch 的 !currentToken() 门 → A 与 B 都会误发 app_launched + 误写 device_id → 三条断言全红。
        expect(batchEventNames(fetchMock)).not.toContain('app_launched')
        expect(fetchMock.mock.calls.some((c) => c[0] === BATCH_PATH)).toBe(false) // 无批次产生
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull() // 匿名不落盘
    })

    it('T5 — 跨域第一方门守护(隔离 A,负向 + 正控):先无 token 启用 → 再置 token → 跨域 mapped 200 → 门存在时 queued=0 且无 device_id', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true) // 无 token → A 首启即 no-op,此后 A 分支不再触发
        Dap.shared.init()
        Dap.shared.setTokenProvider(() => 'tok') // token 就绪
        // 跨域 mapped 请求:isFirstParty 门在场 → 既不过 B 的 maybeTrackLaunch、也不过 mapped track,什么都不入队。
        driveXhr('POST', 'https://other.example.com/api/v1/user/login', { status: 200 })
        // 在补任何控制事件之前断言 —— 门存在时跨域请求零副作用。
        expect(Dap.shared.getStats().queued).toBe(0)
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull()
        // 删 isFirstParty 门 → 跨域请求同时触发 B(app_launched)与 mapped track(user_login)→ 上两断言变红。

        // 补一个控制事件验证 flush 通道正常(排除「因队列整体坏掉而空」的假绿)。
        Dap.shared.track('_probe', {})
        Dap.shared.flush()
        await Promise.resolve()
        expect(batchEventNames(fetchMock)).toContain('_probe')
    })

    it('B-2(a) — XHR 跨域第一方门守护(无 token):_probe 控制 → 跨域 mapped 200 → 含 _probe、不含 user_login', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()
        // 无 token:maybeTrackLaunch 恒 no-op,把变异证据聚焦到 isFirstParty 门对 mapped track 的拦截。
        Dap.shared.track('_probe', {}) // 控制事件保证有批次
        driveXhr('POST', 'https://other.example.com/api/v1/user/login', { status: 200 })
        Dap.shared.flush()
        await Promise.resolve()

        const names = batchEventNames(fetchMock)
        expect(names).toContain('_probe')
        // 删 isFirstParty 门 → 跨域 mapped 请求补发 user_login → 本断言变红。
        expect(names).not.toContain('user_login')
    })
})
