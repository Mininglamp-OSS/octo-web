import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * http_request 的「取消 ≠ 失败」契约(对应 PR #1330 review 的 P1-2 blocking):
 *   - 搜索框每次按键都用 AbortController 取消在途请求(APIClient 的 AbortSignal 即为此)。
 *     被取消的 fetch reject(name==='AbortError'),被取消的 XHR 走 status 0 的 loadend。
 *     若把它们记成 status 0 → 'err',http_request 的错误率会被正常的取消行为打爆、不可用。
 *   - 正确行为:取消不发 http_request;真实网络失败仍记 'err'。
 *
 * 去掉 fetch 侧 isAbortError 跳过、或 XHR 侧 abort 标记,「取消不记」断言立即变红(delete-the-fix)。
 * 单独成文件:vitest 默认按文件隔离(全新 jsdom)。
 */

const BATCH_PATH = '/track/batch'
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

describe('Dap — aborted requests are not reported as http errors (P1-2)', () => {
    beforeEach(() => {
        localStorage.clear()
        document.body.innerHTML = ''
    })
    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('fetch: AbortError is skipped; a real network failure still records err', async () => {
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
        await globalThis.fetch(`${origin}/api/search/aborted`).catch(() => {}) // 取消 → 不记
        await globalThis.fetch(`${origin}/api/search/boom`).catch(() => {}) // 真实失败 → err
        Dap.shared.flush()
        await Promise.resolve()

        const evs = httpEvents(fetchMock)
        const buckets = evs.map((e) => e.props?.status_bucket).sort()
        // 正常 2xx + 真实失败 err;取消那条不出现
        expect(buckets).toEqual(['2xx', 'err'])
    })

    it('XHR: an aborted request emits nothing; a completed loadend still emits', async () => {
        const origin = location.origin
        const fetchMock: FetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock

        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        // 取消:abort 先于 loadend 触发 → wrapper 标记后 loadend 跳过,不记
        const aborted = new XMLHttpRequest()
        aborted.open('GET', `${origin}/api/search/aborted`)
        aborted.send()
        aborted.dispatchEvent(new Event('abort'))
        aborted.dispatchEvent(new Event('loadend'))

        // 完成:只走 loadend(无 abort) → 记一条(once 监听消费掉 jsdom 之后可能的真实事件)
        const done = new XMLHttpRequest()
        done.open('GET', `${origin}/api/other`)
        done.send()
        done.dispatchEvent(new Event('loadend'))

        Dap.shared.flush()
        await Promise.resolve()

        const evs = httpEvents(fetchMock)
        // 恰好一条(完成那条);取消那条不出现(两个 XHR,只应有一条 http_request)
        expect(evs).toHaveLength(1)
    })
})
