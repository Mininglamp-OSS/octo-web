import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Dap 安全契约单测(对应 PR #1320 review 的 P0 项):
 *   - fail-closed:未启用时不落盘设备标识、不发任何请求(P0-1)。
 *   - kill switch:setEnabled(false) 后连"停采前已捕获、排入重试的批次"也不再 POST(P0-2)。
 *   - 隐私边界:normalizePath 收窄脱敏文件名 / percent-encoded 段;HTTP 只采第一方同源(P0-3)。
 *   - same-origin:上报恒发相对路径 /track/batch,不出跨域(P0-4)。
 * 每个用例用 resetModules + 动态 import 拿到全新单例,避免共享状态串扰。
 */

const DEVICE_ID_KEY = 'octo_track_device_id'
const BATCH_PATH = '/track/batch'

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

    it('enabled: sends to the same-origin relative /track/batch and only then creates the device id', async () => {
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
        Dap.shared.init() // 安装 fetch/XHR 包裹(包裹当前的 fetchMock 为 orig)

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
        // 自身上报通道 /track/batch 不被再次 track
        expect(httpEvents.some((e) => String(e.props?.path).includes('track/batch'))).toBe(false)
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
