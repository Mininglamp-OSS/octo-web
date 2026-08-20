import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Dap 安全契约单测(对应 PR #1320 review 的 P0 项):
 *   - fail-closed:未启用时不落盘设备标识、不发任何请求(P0-1)。
 *   - kill switch:setEnabled(false) 后连"停采前已捕获、排入重试的批次"也不再 POST(P0-2)。
 *   - 隐私边界:normalizePath 收窄脱敏文件名 / percent-encoded 段;HTTP 只采第一方同源(P0-3)。
 *   - same-origin:上报恒发相对路径 /v1/e/b,不出跨域(P0-4)。
 * 每个用例用 resetModules + 动态 import 拿到全新单例,避免共享状态串扰。
 */

const DEVICE_ID_KEY = 'octo_track_device_id'
const BATCH_PATH = '/v1/e/b'

type FetchMock = ReturnType<typeof vi.fn>

async function freshTracker() {
    vi.resetModules()
    const mod = await import('../Dap')
    return mod
}

function okFetch(): FetchMock {
    return vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
}

describe('Dap — fail-closed (P0-1)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })

    it('disabled: emits nothing and never persists a device id', async () => {
        const { Dap } = await freshTracker()
        // 默认 disabled
        Dap.shared.track('some_event', { a: 1 })
        Dap.shared.pageView('page-x')
        Dap.shared.flush()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull()
    })

    it('enabled: sends to the same-origin relative /v1/e/b and only then creates the device id', async () => {
        const { Dap } = await freshTracker()
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull() // 构造后、启用前不落盘
        Dap.shared.setEnabled(true)
        Dap.shared.track('evt', { k: 'v' })
        Dap.shared.flush()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe(BATCH_PATH) // 相对路径,恒同源(P0-4)
        expect((init as RequestInit).method).toBe('POST')
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeTruthy()
    })
})

describe('Dap — app_launched 延后至登录后(六审 P2 / owner 决策 b)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })

    it('enabled 但无 token(匿名登录页):不发 app_launched、不落盘 device id、不上报', async () => {
        const { Dap } = await freshTracker()
        // appconfig 回调在登录页就会 setEnabled(true),但此刻还没登录(无 token)
        Dap.shared.setEnabled(true)
        Dap.shared.flush()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull()
    })

    it('登录拿到 token 后:首个事件触发 app_launched 一次,且排在该事件之前', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        // 登录:接上 token provider
        Dap.shared.setTokenProvider(() => 'tok-abc')
        Dap.shared.track('first_evt', {})
        Dap.shared.flush()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [, init] = fetchMock.mock.calls[0]
        const body = JSON.parse((init as RequestInit).body as string)
        const events: Array<{ event_name: string }> = body.events ?? body
        const names = events.map((e) => e.event_name)
        expect(names.filter((n) => n === 'app_launched')).toHaveLength(1)
        // app_launched 排在触发它的事件之前
        expect(names.indexOf('app_launched')).toBeLessThan(names.indexOf('first_evt'))
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeTruthy()
    })

    it('整生命周期仅一次:第二个事件不再补发 app_launched', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.setTokenProvider(() => 'tok-abc')
        Dap.shared.track('e1', {})
        Dap.shared.track('e2', {})
        Dap.shared.flush()

        const allNames: string[] = []
        for (const call of fetchMock.mock.calls) {
            const body = JSON.parse((call[1] as RequestInit).body as string)
            const events: Array<{ event_name: string }> = body.events ?? body
            allNames.push(...events.map((e) => e.event_name))
        }
        expect(allNames.filter((n) => n === 'app_launched')).toHaveLength(1)
    })
})

describe('Dap — kill switch cancels in-flight retries (P0-2)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('a failed batch does NOT retry once tracking is disabled before the retry timer fires', async () => {
        const { Dap } = await freshTracker()
        fetchMock = vi.fn(() => Promise.reject(new Error('network')))
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock

        Dap.shared.setEnabled(true)
        Dap.shared.track('evt', {})
        Dap.shared.flush() // send #1 → rejects → schedules retry at 500ms
        await vi.advanceTimersByTimeAsync(0) // 跑完 .catch 微任务,重试定时器已登记
        expect(fetchMock).toHaveBeenCalledTimes(1)

        Dap.shared.setEnabled(false) // kill switch:应清掉在途重试定时器
        await vi.advanceTimersByTimeAsync(5000) // 越过所有退避窗口
        expect(fetchMock).toHaveBeenCalledTimes(1) // 没有再发生重试
    })

    it('control: a failed batch DOES retry while still enabled (proves the guard is real)', async () => {
        const { Dap } = await freshTracker()
        fetchMock = vi
            .fn()
            .mockReturnValueOnce(Promise.reject(new Error('network')))
            .mockReturnValue(Promise.resolve({ ok: true, status: 200 } as Response))
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock

        Dap.shared.setEnabled(true)
        Dap.shared.track('evt', {})
        Dap.shared.flush()
        await vi.advanceTimersByTimeAsync(0)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(500) // 第一次退避
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})

describe('Dap — HTTP wrapper is first-party only and self-excludes (P0-3)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })

    it('captures same-origin requests (path redacted) but skips cross-origin, and never re-tracks its own batch', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init() // 首次 setEnabled(true) 已装采集机制;init 幂等,只补定时器/卸载兜底

        const origin = location.origin
        await globalThis.fetch(`${origin}/api/users/alice/files/report-2024.pdf`) // 同源 → 采
        await globalThis.fetch('https://cdn.example.com/bucket/secret.pdf') // 跨域 → 不采
        Dap.shared.flush()
        await Promise.resolve()

        // 找到上报批次(自身通道),解析其中的事件
        const batchCall = fetchMock.mock.calls.find((c) => c[0] === BATCH_PATH)
        expect(batchCall).toBeTruthy()
        const body = JSON.parse((batchCall![1] as RequestInit).body as string)
        const httpEvents = (body.events as Array<{ event_name: string; props?: Record<string, unknown> }>).filter(
            (e) => e.event_name === 'http_request',
        )
        // 只应有 1 条 http_request(同源那条),跨域被跳过
        expect(httpEvents).toHaveLength(1)
        // 路由骨架保留(api/users/files),但用户名与文件名段被脱敏,绝不出现原始值
        expect(httpEvents[0].props?.path).toBe('/api/users/:seg/files/:seg')
        // 自身上报通道(BATCH_PATH /v1/e/b)不被再次 track:上面只发了 1 个同源业务请求 +
        // N 个自身批次,httpEvents 恰为 1 已证明批次未被自采;这里再显式钉死其归一路径不出现。
        expect(httpEvents.some((e) => String(e.props?.path) === '/v1/:seg/:seg')).toBe(false)
    })

    it('never derives object_id from a URL path, and masks credential-shaped segments (P1)', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        const origin = location.origin
        // 一次性登录码拼在 path 里:既不能进 path,也不能被当成 object_id 取出
        await globalThis.fetch(`${origin}/user/login_authcode/k3mq7z1x9v2p`)
        Dap.shared.flush()
        await Promise.resolve()

        const batchCall = fetchMock.mock.calls.find((c) => c[0] === BATCH_PATH)
        const body = JSON.parse((batchCall![1] as RequestInit).body as string)
        const httpEvents = (
            body.events as Array<{ event_name: string; object_id?: string; props?: Record<string, unknown> }>
        ).filter((e) => e.event_name === 'http_request')
        expect(httpEvents).toHaveLength(1)
        // 路由词保留、凭证段脱敏
        expect(httpEvents[0].props?.path).toBe('/user/login_authcode/:seg')
        // http_request 不再单列 object_id —— 凭证不可能借这个字段外泄
        expect('object_id' in httpEvents[0]).toBe(false)
        // 兜底:整条事件里任何位置都不得出现原始凭证
        expect(JSON.stringify(httpEvents[0]).includes('k3mq7z1x9v2p')).toBe(false)
    })
})

describe('Dap — object_id join key is actually emitted (P1)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })

    it('emits top-level object_id and strips it from props for explicit events', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.track('message_sent', { object_id: 'seq-123', channel_id: 'c1', chat_type: 'group' })
        Dap.shared.flush()

        const batchCall = fetchMock.mock.calls.find((c) => c[0] === BATCH_PATH)
        expect(batchCall).toBeTruthy()
        const body = JSON.parse((batchCall![1] as RequestInit).body as string)
        const evt = (
            body.events as Array<{ event_name: string; object_id?: string; props?: Record<string, unknown> }>
        ).find((e) => e.event_name === 'message_sent')!
        // 关键:join key 真被 emit(此前 sanitizeProps 丢掉了它,导致所有声明式埋点无 object_id)
        expect(evt.object_id).toBe('seq-123')
        // object_id 提到 envelope 顶层,不重复留在 props 里
        expect(evt.props?.object_id).toBeUndefined()
        expect(evt.props?.channel_id).toBe('c1')
    })

    it('emits object_id from a declarative data-object-id click', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        const btn = document.createElement('button')
        btn.setAttribute('data-track', 'channel_opened')
        btn.setAttribute('data-object-id', 'ch-987')
        document.body.appendChild(btn)
        btn.click()
        Dap.shared.flush()

        const batchCall = fetchMock.mock.calls.find((c) => c[0] === BATCH_PATH)
        const body = JSON.parse((batchCall![1] as RequestInit).body as string)
        const evt = (body.events as Array<{ event_name: string; object_id?: string }>).find(
            (e) => e.event_name === 'channel_opened',
        )!
        expect(evt.object_id).toBe('ch-987')
        btn.remove()
    })
})

describe('Dap.normalizePath / isFirstParty (P0-3 helpers)', () => {
    it('keeps whitelisted route words but masks ids, filenames, usernames and credentials', async () => {
        const { __dapInternals } = await freshTracker()
        const { normalizePath } = __dapInternals
        // 静态路由词原样保留
        expect(normalizePath('/v1/common/appconfig')).toBe('/v1/common/appconfig')
        expect(normalizePath('/mail-api/webapi/v0/mailboxes')).toBe('/mail-api/webapi/v0/mailboxes')
        expect(normalizePath('/v1/mail-gateway/webapi/v0/agent-auth/requests/ABCD-1234')).toBe('/v1/mail-gateway/webapi/v0/agent-auth/requests/:seg')
        // id → :id;文件名 / percent-encoded 段 → :seg
        expect(normalizePath('/agent-cards/9987/files/report-2024.pdf')).toBe('/agent-cards/:id/files/:seg')
        expect(normalizePath('/x/memory%2F2026-05-07.md')).toBe('/:seg/:seg') // 'x' 非路由词 → :seg
        expect(normalizePath('/thread/550e8400-e29b-41d4-a716-446655440000')).toBe('/thread/:id')
        // 带 query 不泄:query 不进结果
        expect(normalizePath('/search?q=secret').includes('secret')).toBe(false)

        // 凭证 / 邀请码 / 用户名 一律不得穿过(reviewer P0):路由词留骨架,动态段全 :seg
        expect(normalizePath('/user/login_authcode/k3mq7z1x9v2p')).toBe('/user/login_authcode/:seg')
        expect(normalizePath('/space/invite/j7kq2mz9')).toBe('/space/invite/:seg')
        expect(normalizePath('/docs/invites/tq9mz3kx7v/accept')).toBe('/docs/invites/:seg/accept')
        expect(normalizePath('/groups/g-eng/transfer/uid_admin')).toBe('/groups/:seg/transfer/:seg')
        expect(normalizePath('/users/alice')).toBe('/users/:seg')
        // 未登记的新路由词只会塌成 :seg(丢粒度),不泄露
        expect(normalizePath('/workflows/abc/runs')).toBe('/:seg/:seg/:seg')
    })

    it('treats relative and same-origin as first-party, foreign origins as not', async () => {
        const { __dapInternals } = await freshTracker()
        const { isFirstParty } = __dapInternals
        expect(isFirstParty('/api/x')).toBe(true)
        expect(isFirstParty(`${location.origin}/api/x`)).toBe(true)
        expect(isFirstParty('https://cdn.example.com/x')).toBe(false)
    })

    it('prefers the apiPath route template over lossy whitelist normalization', async () => {
        vi.resetModules()
        // 关键:必须从与 Dap 同一个 fresh 模块图里拿 apiPath,二者共享同一 registry。
        const dap = await import('../Dap')
        const api = await import('../apiPath')
        const { normalizePath } = dap.__dapInternals

        // 无模板兜底:短 hex id `8f3a`(<16)在白名单归一里塌成 :seg —— 正是要修的丢失。
        expect(normalizePath('/api/v1/spaces/8f3a/categories/12')).toBe('/api/v1/spaces/:seg/categories/:id')

        // 登记 apiPath 模板后:字面段全可见、变量段统一 :id,同一 endpoint 稳定模板。
        const p = api.apiPath`/spaces/${'8f3a'}/categories/${'12'}`
        api.registerRequestTemplate(p, '/api/v1/')
        expect(normalizePath('/api/v1/spaces/8f3a/categories/12')).toBe('/api/v1/spaces/:id/categories/:id')

        // 模板里从不含变量原值 —— 隐私天然安全。
        expect(normalizePath('/api/v1/spaces/8f3a/categories/12').includes('8f3a')).toBe(false)
    })
})

describe('Dap — unsupported runtime stays disabled (desktop/file://)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('does not enable, send, or persist a device id under a file:// runtime', async () => {
        vi.stubGlobal('location', { protocol: 'file:', origin: 'null', href: 'file:///app/index.html' })
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true) // 桌面下发也应被吞掉
        Dap.shared.track('evt', { k: 'v' })
        Dap.shared.flush()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull()
    })

    it('isSupportedRuntime: true for http(s), false for file:', async () => {
        const { __dapInternals } = await freshTracker()
        expect(__dapInternals.isSupportedRuntime()).toBe(true) // jsdom 默认 http:
        vi.stubGlobal('location', { protocol: 'file:', origin: 'null' })
        expect(__dapInternals.isSupportedRuntime()).toBe(false)
    })
})

describe('Dap — 中央映射·path 通道(①):成功请求补发映射事件', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })

    /** 从自身上报批次里取所有事件名。 */
    function eventNamesFromBatch(): string[] {
        const batchCall = fetchMock.mock.calls.find((c) => c[0] === BATCH_PATH)
        if (!batchCall) return []
        const body = JSON.parse((batchCall[1] as RequestInit).body as string)
        return (body.events as Array<{ event_name: string }>).map((e) => e.event_name)
    }

    it('2xx 的第一方请求既发 http_request 又补发映射事件(POST /api/v1/user/login → user_login)', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        const origin = location.origin
        await globalThis.fetch(`${origin}/api/v1/user/login`, { method: 'POST' })
        Dap.shared.flush()
        await Promise.resolve()

        const names = eventNamesFromBatch()
        expect(names).toContain('http_request')
        expect(names).toContain('user_login')
    })

    it('4xx 不补发映射事件(动作未发生),但仍记 http_request', async () => {
        const { Dap } = await freshTracker()
        // 业务请求 404、自身上报批次 200:必须在 init 包裹前替换,否则包裹到的是旧 mock。
        fetchMock = vi.fn((url: string) =>
            Promise.resolve({ ok: url === BATCH_PATH, status: url === BATCH_PATH ? 200 : 404 } as Response),
        )
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        await globalThis.fetch(`${location.origin}/api/v1/message/revoke`, { method: 'POST' })
        Dap.shared.flush()
        await Promise.resolve()

        const names = eventNamesFromBatch()
        expect(names).toContain('http_request')
        expect(names).not.toContain('message_revoked')
    })

    it('跨域请求即使 2xx 也不映射(与 http_request 同源边界一致)', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        await globalThis.fetch('https://other.example.com/api/v1/message/revoke', { method: 'POST' })
        Dap.shared.flush()
        await Promise.resolve()

        expect(eventNamesFromBatch()).not.toContain('message_revoked')
    })
})

describe('Dap — 中央映射·body 键通道(②):按请求体顶层键补发映射事件', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })

    function eventNamesFromBatch(): string[] {
        const batchCall = fetchMock.mock.calls.find((c) => c[0] === BATCH_PATH)
        if (!batchCall) return []
        const body = JSON.parse((batchCall[1] as RequestInit).body as string)
        return (body.events as Array<{ event_name: string }>).map((e) => e.event_name)
    }

    it('PUT /api/v1/groups/:id/setting {save} → conversation_saved_to_contacts(2xx 补发,不泄露体值)', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        await globalThis.fetch(`${location.origin}/api/v1/groups/g1/setting`, {
            method: 'PUT',
            body: JSON.stringify({ save: 1, remark_secret: 'do-not-leak' }),
        })
        Dap.shared.flush()
        await Promise.resolve()

        const names = eventNamesFromBatch()
        expect(names).toContain('http_request')
        expect(names).toContain('conversation_saved_to_contacts')
        // 体里的任何值都不得出现在上报里
        const batchCall = fetchMock.mock.calls.find((c) => c[0] === BATCH_PATH)
        expect(JSON.stringify(batchCall![1]).includes('do-not-leak')).toBe(false)
    })

    it('body 通道优先于 path 通道(不重复计事件)', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()
        // PUT /groups/:id 只在 body 表(name→改名);path 表无此项 → 只应有一个映射事件。
        await globalThis.fetch(`${location.origin}/api/v1/groups/g1`, {
            method: 'PUT',
            body: JSON.stringify({ name: 'newname' }),
        })
        Dap.shared.flush()
        await Promise.resolve()

        const names = eventNamesFromBatch()
        expect(names.filter((n) => n === 'group_name_edited')).toHaveLength(1)
    })

    it('非白名单端点不读体、不映射', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()
        await globalThis.fetch(`${location.origin}/api/v1/not-whitelisted/x`, {
            method: 'PUT',
            body: JSON.stringify({ save: 1 }),
        })
        Dap.shared.flush()
        await Promise.resolve()

        // save 在 */setting 白名单端点才映射;非白名单端点即便体里有 save 也不读、不映射。
        expect(eventNamesFromBatch()).not.toContain('conversation_saved_to_contacts')
    })

    it('4xx 不补发 body 映射事件', async () => {
        const { Dap } = await freshTracker()
        fetchMock = vi.fn((url: string) =>
            Promise.resolve({ ok: url === BATCH_PATH, status: url === BATCH_PATH ? 200 : 403 } as Response),
        )
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
        Dap.shared.setEnabled(true)
        Dap.shared.init()
        await globalThis.fetch(`${location.origin}/api/v1/groups/g1/setting`, {
            method: 'PUT',
            body: JSON.stringify({ save: 1 }),
        })
        Dap.shared.flush()
        await Promise.resolve()

        // 白名单端点 + 体里有 save,但 4xx → 不补发(只 2xx 才映射 body 事件)。
        expect(eventNamesFromBatch()).not.toContain('conversation_saved_to_contacts')
    })
})

describe('TrackRules — buildIndex / matchRoute (pure)', () => {
    it('buildIndex splits testid rules into the Map and role-only rules into loose', async () => {
        const { buildIndex } = await import('../TrackRules')
        const idx = buildIndex([
            { event: 'a', testid: 'x' },
            { event: 'b', testid: 'x' }, // 同 testid → 同桶
            { event: 'c', role: 'switch' }, // 无 testid → loose
            { event: '', testid: 'skip' }, // 无 event → 丢弃
        ])
        expect(idx.byTestid.get('x')?.map((r) => r.event)).toEqual(['a', 'b'])
        expect(idx.byTestid.has('skip')).toBe(false)
        expect(idx.loose.map((r) => r.event)).toEqual(['c'])
    })

    it('matchRoute: absent route always matches; else exact or segment-boundary prefix', async () => {
        const { matchRoute } = await import('../TrackRules')
        expect(matchRoute(undefined, '/anything')).toBe(true)
        expect(matchRoute('/automation', '/automation')).toBe(true)
        expect(matchRoute('/automation', '/automation/rules')).toBe(true)
        expect(matchRoute('/automation', '/automationX')).toBe(false) // 段边界,不误配
        expect(matchRoute(['/a', '/b'], '/b/c')).toBe(true)
    })
})

describe('Dap — rule-table fallback (no data-track)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        document.body.innerHTML = ''
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })

    /** 从自身上报批次里取指定事件。 */
    function eventsFromBatch(name: string) {
        const batchCall = fetchMock.mock.calls.find((c) => c[0] === BATCH_PATH)
        if (!batchCall) return []
        const body = JSON.parse((batchCall[1] as RequestInit).body as string)
        return (body.events as Array<{ event_name: string; object_id?: string; props?: Record<string, unknown> }>).filter(
            (e) => e.event_name === name,
        )
    }

    it('fires the rule event for a data-testid node that has no data-track', async () => {
        const { Dap } = await freshTracker()
        const { TRACK_RULES } = await import('../TrackRules')
        TRACK_RULES.push({ event: 'automation_run_clicked', testid: 'automation-run-btn' })
        Dap.shared.setEnabled(true) // 安装点击委托时构建规则索引(读此刻的 TRACK_RULES)
        Dap.shared.init()

        const btn = document.createElement('button')
        btn.setAttribute('data-testid', 'automation-run-btn')
        document.body.appendChild(btn)
        btn.click()
        Dap.shared.flush()

        expect(eventsFromBatch('automation_run_clicked')).toHaveLength(1)
    })

    it('data-track wins: a node with BOTH data-track and a matching rule uses the data-track event', async () => {
        const { Dap } = await freshTracker()
        const { TRACK_RULES } = await import('../TrackRules')
        // 同一元素既有 data-track 又匹配规则:必须走 data-track,规则不得插手(零回归)。
        TRACK_RULES.push({ event: 'rule_event', testid: 'dual' })
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        const btn = document.createElement('button')
        btn.setAttribute('data-track', 'declared_event')
        btn.setAttribute('data-testid', 'dual')
        document.body.appendChild(btn)
        btn.click()
        Dap.shared.flush()

        expect(eventsFromBatch('declared_event')).toHaveLength(1)
        expect(eventsFromBatch('rule_event')).toHaveLength(0)
    })

    it('route constraint gates the fallback (only fires on a matching pathname)', async () => {
        const { Dap } = await freshTracker()
        const { TRACK_RULES } = await import('../TrackRules')
        // jsdom 默认 pathname='/':route:'/nope' 不命中,route:'/' 命中。
        TRACK_RULES.push({ event: 'gated_off', testid: 'r1', route: '/nope' })
        TRACK_RULES.push({ event: 'gated_on', testid: 'r2', route: '/' })
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        for (const id of ['r1', 'r2']) {
            const el = document.createElement('button')
            el.setAttribute('data-testid', id)
            document.body.appendChild(el)
            el.click()
        }
        Dap.shared.flush()

        expect(eventsFromBatch('gated_off')).toHaveLength(0)
        expect(eventsFromBatch('gated_on')).toHaveLength(1)
    })

    it('keyboard-activates a non-native role=button rule node (Enter), same as data-track', async () => {
        const { Dap } = await freshTracker()
        const { TRACK_RULES } = await import('../TrackRules')
        TRACK_RULES.push({ event: 'automation_toggle', testid: 'kb-toggle' })
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        const div = document.createElement('div') // 非原生可激活 → 浏览器不合成 click
        div.setAttribute('role', 'button')
        div.setAttribute('tabindex', '0')
        div.setAttribute('data-testid', 'kb-toggle')
        document.body.appendChild(div)
        div.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        Dap.shared.flush()

        expect(eventsFromBatch('automation_toggle')).toHaveLength(1)
    })

    it('data-track-ignore excludes a rule hit just like a data-track hit', async () => {
        const { Dap } = await freshTracker()
        const { TRACK_RULES } = await import('../TrackRules')
        TRACK_RULES.push({ event: 'row_opened', testid: 'auto-row' })
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        const row = document.createElement('div')
        row.setAttribute('data-testid', 'auto-row')
        const handle = document.createElement('span') // 行内拖拽柄:不代表本事件
        handle.setAttribute('data-track-ignore', '')
        row.appendChild(handle)
        document.body.appendChild(row)
        handle.click() // 点在 ignore 子控件上
        Dap.shared.flush()

        expect(eventsFromBatch('row_opened')).toHaveLength(0)
    })

    it('merges static rule props with data-* (object_id promoted), never leaks the testid', async () => {
        const { Dap } = await freshTracker()
        const { TRACK_RULES } = await import('../TrackRules')
        TRACK_RULES.push({ event: 'automation_edit', testid: 'auto-edit', props: { area: 'automation', action: 'edit' } })
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        const btn = document.createElement('button')
        btn.setAttribute('data-testid', 'auto-edit')
        btn.setAttribute('data-object-id', 'auto-42')
        document.body.appendChild(btn)
        btn.click()
        Dap.shared.flush()

        const evts = eventsFromBatch('automation_edit')
        expect(evts).toHaveLength(1)
        expect(evts[0].object_id).toBe('auto-42') // data-object-id 提到 envelope 顶层
        expect(evts[0].props?.area).toBe('automation') // 静态枚举 props
        expect(evts[0].props?.action).toBe('edit')
        // testid 绝不进 props(collectDatasetProps 只收 track*/object_id),object_id 不重复留 props
        expect('testid' in (evts[0].props ?? {})).toBe(false)
        expect(evts[0].props?.object_id).toBeUndefined()
    })
})
