import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Tracker 安全契约单测(对应 PR #1320 review 的 P0 项):
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
    const mod = await import('../Tracker')
    return mod
}

function okFetch(): FetchMock {
    return vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
}

describe('Tracker — fail-closed (P0-1)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })

    it('disabled: emits nothing and never persists a device id', async () => {
        const { Tracker } = await freshTracker()
        // 默认 disabled
        Tracker.shared.track('some_event', { a: 1 })
        Tracker.shared.pageView('page-x')
        Tracker.shared.flush()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull()
    })

    it('enabled: sends to the same-origin relative /track/batch and only then creates the device id', async () => {
        const { Tracker } = await freshTracker()
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull() // 构造后、启用前不落盘
        Tracker.shared.setEnabled(true)
        Tracker.shared.track('evt', { k: 'v' })
        Tracker.shared.flush()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe(BATCH_PATH) // 相对路径,恒同源(P0-4)
        expect((init as RequestInit).method).toBe('POST')
        expect(localStorage.getItem(DEVICE_ID_KEY)).toBeTruthy()
    })
})

describe('Tracker — kill switch cancels in-flight retries (P0-2)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('a failed batch does NOT retry once tracking is disabled before the retry timer fires', async () => {
        const { Tracker } = await freshTracker()
        fetchMock = vi.fn(() => Promise.reject(new Error('network')))
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock

        Tracker.shared.setEnabled(true)
        Tracker.shared.track('evt', {})
        Tracker.shared.flush() // send #1 → rejects → schedules retry at 500ms
        await vi.advanceTimersByTimeAsync(0) // 跑完 .catch 微任务,重试定时器已登记
        expect(fetchMock).toHaveBeenCalledTimes(1)

        Tracker.shared.setEnabled(false) // kill switch:应清掉在途重试定时器
        await vi.advanceTimersByTimeAsync(5000) // 越过所有退避窗口
        expect(fetchMock).toHaveBeenCalledTimes(1) // 没有再发生重试
    })

    it('control: a failed batch DOES retry while still enabled (proves the guard is real)', async () => {
        const { Tracker } = await freshTracker()
        fetchMock = vi
            .fn()
            .mockReturnValueOnce(Promise.reject(new Error('network')))
            .mockReturnValue(Promise.resolve({ ok: true, status: 200 } as Response))
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock

        Tracker.shared.setEnabled(true)
        Tracker.shared.track('evt', {})
        Tracker.shared.flush()
        await vi.advanceTimersByTimeAsync(0)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(500) // 第一次退避
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})

describe('Tracker — HTTP wrapper is first-party only and self-excludes (P0-3)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })

    it('captures same-origin requests (path redacted) but skips cross-origin, and never re-tracks its own batch', async () => {
        const { Tracker } = await freshTracker()
        Tracker.shared.setEnabled(true)
        Tracker.shared.init() // 安装 fetch/XHR 包裹(包裹当前的 fetchMock 为 orig)

        const origin = location.origin
        await globalThis.fetch(`${origin}/api/things/report-2024.pdf`) // 同源 → 采
        await globalThis.fetch('https://cdn.example.com/bucket/secret.pdf') // 跨域 → 不采
        Tracker.shared.flush()
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
        // 文件名段被脱敏,绝不出现原始文件名
        expect(httpEvents[0].props?.path).toBe('/api/things/:seg')
        // 自身上报通道 /track/batch 不被再次 track
        expect(httpEvents.some((e) => String(e.props?.path).includes('track/batch'))).toBe(false)
    })
})

describe('Tracker.normalizePath / isFirstParty (P0-3 helpers)', () => {
    it('redacts filenames, percent-encoded segments, ids; keeps plain route tokens', async () => {
        const { __trackerInternals } = await freshTracker()
        const { normalizePath } = __trackerInternals
        expect(normalizePath('/v1/common/appconfig')).toBe('/v1/common/appconfig')
        expect(normalizePath('/agent-cards/9987/files/report-2024.pdf')).toBe('/agent-cards/:id/files/:seg')
        expect(normalizePath('/x/memory%2F2026-05-07.md')).toBe('/x/:seg')
        expect(normalizePath('/thread/550e8400-e29b-41d4-a716-446655440000')).toBe('/thread/:id')
        // 带 query 也不泄:query 不进结果
        expect(normalizePath('/search?q=secret').includes('secret')).toBe(false)
    })

    it('treats relative and same-origin as first-party, foreign origins as not', async () => {
        const { __trackerInternals } = await freshTracker()
        const { isFirstParty } = __trackerInternals
        expect(isFirstParty('/api/x')).toBe(true)
        expect(isFirstParty(`${location.origin}/api/x`)).toBe(true)
        expect(isFirstParty('https://cdn.example.com/x')).toBe(false)
    })
})
