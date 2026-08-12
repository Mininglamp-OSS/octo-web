import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 页面停留时长契约(对应 PR #1320 review 的 P1-B blocking):
 *   - 切后台(visibilitychange→hidden)必须结算当前页的 page_leave(截到隐藏这一刻),
 *     否则会话最后一页永无 page_leave。
 *   - 回到前台(→visible)必须重置停留起点,后台挂机时长**不得**计入本页停留 ——
 *     否则「隐藏 8h 再回来切页」会记出一条 ~8h 的 page_leave(看着像超长阅读、实为无人在看,
 *     是「对的样子的错数据」)。
 *
 * 本用例用 fake timers 精确控 Date.now + stub visibilityState,驱动 hide/return/nav 时间线。
 * 去掉 hidden 分支的 settleLastPage 或 visible 分支的 enteredAt 重置,断言立即变红。
 * 单独成文件:vitest 默认按文件隔离(全新 jsdom)。
 */

const BATCH_PATH = '/v1/e/b'
const HOUR = 3600_000
type FetchMock = ReturnType<typeof vi.fn>

async function freshTracker() {
    vi.resetModules()
    return import('../Dap')
}
function okFetch(): FetchMock {
    return vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
}

describe('Dap — page_leave settles on hide and never charges background time (P1-B)', () => {
    let fetchMock: FetchMock
    let vis: DocumentVisibilityState
    beforeEach(() => {
        localStorage.clear()
        document.body.innerHTML = ''
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
        vis = 'visible'
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis })
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    const setVisibility = (v: DocumentVisibilityState) => {
        vis = v
        document.dispatchEvent(new Event('visibilitychange'))
    }

    function leaves(): Array<{ page_id?: string; props?: { duration_ms?: number } }> {
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

    // 返回携带 page_leave 的那次 fetch 的 RequestInit(用于断言卸载批次带 keepalive)
    function leaveRequests(): RequestInit[] {
        const out: RequestInit[] = []
        for (const c of fetchMock.mock.calls) {
            if (c[0] !== BATCH_PATH) continue
            const init = c[1] as RequestInit
            const body = JSON.parse(init.body as string)
            if ((body.events as Array<{ event_name: string }>).some((e) => e.event_name === 'page_leave')) out.push(init)
        }
        return out
    }

    it('emits page_leave for the last page on hide, and splits active time without counting 8h of background', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.init()
        Dap.shared.setEnabled(true)

        Dap.shared.pageView('/chat') // t0

        // 前台看 1s,然后切后台 → 必须结算 /chat(此前:最后一页永无 page_leave)
        vi.advanceTimersByTime(1000)
        setVisibility('hidden') // 触发 settleLastPage + keepalive flush

        const afterHide = leaves()
        expect(afterHide).toHaveLength(1)
        expect(afterHide[0].page_id).toBe('/chat')
        expect(afterHide[0].props?.duration_ms).toBe(1000)
        // 卸载批次必须走 keepalive——普通 fetch 会随真实关页被浏览器取消,最后一页 page_leave 就丢了
        // (这是 keepalive 从常规批次挪走后引入过的回归,断言钉死不得再退)
        expect(leaveRequests()[0]?.keepalive).toBe(true)

        // 后台挂机 8h,再回到前台(重置停留起点)
        vi.advanceTimersByTime(8 * HOUR)
        setVisibility('visible')

        // 回来看 0.5s 再切到 /contacts → 结算 /chat 的第二段(0.5s),而非 8h
        vi.advanceTimersByTime(500)
        Dap.shared.pageView('/contacts')
        Dap.shared.flush()

        const all = leaves().filter((e) => e.page_id === '/chat')
        // 两段活跃时长各自独立结算:1000 与 500,后台 8h 不计入任何一条
        expect(all.map((e) => e.props?.duration_ms)).toEqual([1000, 500])
        expect(all.every((e) => (e.props?.duration_ms ?? 0) < HOUR)).toBe(true)
    })
})
