import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 切页 observer 的行为契约(对应 PR #1320 review 的 P1 blocking):
 *   - route 首次访问时页节点是「新插入」(childList)而非 style 翻转 —— observer 必须
 *     监听 childList 才能采到首访 page_view;只听 style 会整条漏掉。
 *   - page_leave.duration_ms 必须归属到「真正打开过」的那一页,不能把漏采页面的停留
 *     时间错记到别页(看着对、其实错的数据)。
 *
 * 关键:本用例**驱动 observer 本身**(往容器里插入节点),而不是直接调 pageView() ——
 * 这正是 Dap.test.ts 缺失、导致该缺陷survive九轮 review 的那类测试。去掉 installPageObserver
 * 里的 `childList: true`,本用例立即变红(delete-the-fix)。
 *
 * 单独成文件:vitest 默认按文件隔离(全新 jsdom),避免其它用例 init() 遗留在共享
 * document 上、未断开的 MutationObserver 串扰本用例。
 */

const BATCH_PATH = '/track/batch'
type FetchMock = ReturnType<typeof vi.fn>

async function freshTracker() {
    vi.resetModules()
    return import('../Dap')
}

function okFetch(): FetchMock {
    return vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response))
}

describe('Dap — page observer drives page_view/page_leave on route INSERT (P1)', () => {
    let fetchMock: FetchMock
    beforeEach(() => {
        localStorage.clear()
        document.body.innerHTML = ''
        fetchMock = okFetch()
        // @ts-expect-error test stub
        globalThis.fetch = fetchMock
    })
    afterEach(() => {
        document.body.innerHTML = ''
    })

    // MutationObserver 回调异步(microtask)投递;setTimeout(0) 是宏任务,等它时回调必已跑完。
    const tick = () => new Promise((r) => setTimeout(r, 0))

    function events(name: string): Array<{ page_id?: string; props?: Record<string, unknown> }> {
        const out: Array<{ page_id?: string; props?: Record<string, unknown> }> = []
        for (const c of fetchMock.mock.calls) {
            if (c[0] !== BATCH_PATH) continue
            const body = JSON.parse((c[1] as RequestInit).body as string)
            for (const e of body.events as Array<{
                event_name: string
                page_id?: string
                props?: Record<string, unknown>
            }>) {
                if (e.event_name === name) out.push(e)
            }
        }
        return out
    }

    it('emits page_view for a route node INSERTED with display:block, and attributes page_leave to the page actually open', async () => {
        // 容器先于 init 存在,installPageObserver 直接 scoped 观测它
        const root = document.createElement('div')
        root.className = 'wk-layout-content-left'
        document.body.appendChild(root)

        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        // 首访 A:节点「新插入且已 display:block」,不是 style 翻转。
        // 旧实现只监听 style → 整条漏掉这次 page_view(delete-the-fix:去掉 childList 即变红)。
        const a = document.createElement('div')
        a.setAttribute('data-page-id', 'page-a')
        a.style.display = 'block'
        root.appendChild(a)
        await tick()

        // 首访 B:再插一个可见页 → 结算 A 的 page_leave + 触发 B 的 page_view
        const b = document.createElement('div')
        b.setAttribute('data-page-id', 'page-b')
        b.style.display = 'block'
        root.appendChild(b)
        await tick()

        Dap.shared.flush()

        // 两次首访都被观测到(不是只有挂载那刻可见的那页)
        expect(events('page_view').map((e) => e.page_id)).toEqual(['page-a', 'page-b'])
        // page_leave 恰好一条,且归属到真正打开过的 A —— 不把 A 的停留错记到别页
        const leaves = events('page_leave')
        expect(leaves).toHaveLength(1)
        expect(leaves[0].page_id).toBe('page-a')
        expect(typeof leaves[0].props?.duration_ms).toBe('number')
    })
})
