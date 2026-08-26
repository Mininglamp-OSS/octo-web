import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * pagehide 结算契约(对应 PR #1330 review 的 P2:standalone pagehide 不结算最后一页):
 *   某些浏览器/场景下 pagehide 先于、或根本不伴随 visibilitychange→hidden。卸载兜底必须
 *   在 pagehide 路径上也结算当前页,否则该路径永无 page_leave。且卸载批次必须走 keepalive,
 *   普通 fetch 会随真实关页被浏览器取消。
 *
 * 单独成文件:tracker 在 document/window 上注册的卸载监听不随 vi.resetModules 摘除,
 * 与其它生命周期用例同文件会互相触发对方残留的 tracker(见 Dap.pageLifecycle.test.ts)。
 * vitest 默认按文件隔离(全新 jsdom),隔开即净。
 */

const BATCH_PATH = '/v1/e/b'
type FetchMock = ReturnType<typeof vi.fn>

async function freshTracker() {
    vi.resetModules()
    return import('../Dap')
}
function okFetch(): FetchMock {
    return vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
}

describe('Dap — standalone pagehide settles the last page via a keepalive batch (P2)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        document.body.innerHTML = ''
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    function leaveEnvs(): Array<{ page_id?: string; props?: { duration_ms?: number } }> {
        const out: Array<{ page_id?: string; props?: { duration_ms?: number } }> = []
        for (const c of fetchMock.mock.calls) {
            if (c[0] !== BATCH_PATH) continue
            const body = JSON.parse((c[1] as RequestInit).body as string)
            for (const e of body.events as Array<{ event_name: string; page_id?: string; props?: { duration_ms?: number } }>) {
                if (e.event_name === 'page_leave') out.push(e)
            }
        }
        return out
    }
    function firstLeaveRequest(): RequestInit | undefined {
        for (const c of fetchMock.mock.calls) {
            if (c[0] !== BATCH_PATH) continue
            const init = c[1] as RequestInit
            const body = JSON.parse(init.body as string)
            if ((body.events as Array<{ event_name: string }>).some((e) => e.event_name === 'page_leave')) return init
        }
        return undefined
    }

    it('emits page_leave for the last page and uses keepalive', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.init()
        Dap.shared.setEnabled(true)

        Dap.shared.pageView('/chat')
        vi.advanceTimersByTime(1500)

        // 只派发 pagehide(不先 visibilitychange→hidden)
        window.dispatchEvent(new Event('pagehide'))

        const out = leaveEnvs()
        expect(out).toHaveLength(1)
        expect(out[0].page_id).toBe('/chat')
        expect(out[0].props?.duration_ms).toBe(1500)
        expect(firstLeaveRequest()?.keepalive).toBe(true)
    })
})
