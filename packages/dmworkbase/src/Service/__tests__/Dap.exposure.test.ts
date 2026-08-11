import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 曝光事件的「按可见性」契约(对应 PR #1330 review 的 P1-1 blocking):
 *   - shell(MainContentLeft)把访问过的路由全留在 DOM 里、用 inline display:none 藏着。
 *     曝光观测器只监听 childList,隐藏子树里的节点重渲染 / setEnabled 补扫都会触发插入回调,
 *     若不判可见性就会给用户**根本没看到**的页面记一条 impression(虚高、同 page_leave 错记同类)。
 *   - 正确行为:祖先 inline display:none → 视为不可见,不发曝光;真正可见才发一次。
 *
 * 本用例**驱动真实 DOM 插入**并按生产顺序 init()→setEnabled(true)。去掉 fireExposure 里的
 * isHiddenByDisplay 闸,「隐藏节点」断言立即变红(delete-the-fix)。
 * 单独成文件:vitest 默认按文件隔离(全新 jsdom)。
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

describe('Dap — exposure fires only when the element is visible (P1-1)', () => {
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

    const tick = () => new Promise((r) => setTimeout(r, 0))

    function events(name: string): unknown[] {
        const out: unknown[] = []
        for (const c of fetchMock.mock.calls) {
            if (c[0] !== BATCH_PATH) continue
            const body = JSON.parse((c[1] as RequestInit).body as string)
            for (const e of body.events as Array<{ event_name: string }>) {
                if (e.event_name === name) out.push(e)
            }
        }
        return out
    }

    it('observer INSERT: emits for a visible [data-track-view] node but NOT for one under a display:none ancestor', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.init()
        Dap.shared.setEnabled(true)

        // 可见:直接挂在 body 下,无隐藏祖先 → 应记一条
        const visibleWrap = document.createElement('div')
        const shown = document.createElement('div')
        shown.setAttribute('data-track-view', 'exposed_visible')
        visibleWrap.appendChild(shown)
        document.body.appendChild(visibleWrap)
        await tick()

        // 隐藏:祖先 inline display:none(访问过但当前没在看的那条路由)→ 不应记
        const hiddenWrap = document.createElement('div')
        hiddenWrap.style.display = 'none'
        const dark = document.createElement('div')
        dark.setAttribute('data-track-view', 'exposed_hidden')
        hiddenWrap.appendChild(dark)
        document.body.appendChild(hiddenWrap)
        await tick()

        Dap.shared.flush()
        expect(events('exposed_visible')).toHaveLength(1)
        expect(events('exposed_hidden')).toHaveLength(0)
    })

    it('rescanCurrent at flag-flip:补采 visible 已存在元素,跳过 display:none 子树里的元素', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.init()

        // 开关到位前,DOM 里已同时存在「可见页」与「访问过但隐藏的页」
        const visibleWrap = document.createElement('div')
        const shown = document.createElement('div')
        shown.setAttribute('data-track-view', 'visible_at_flip')
        visibleWrap.appendChild(shown)
        document.body.appendChild(visibleWrap)

        const hiddenWrap = document.createElement('div')
        hiddenWrap.style.display = 'none'
        const dark = document.createElement('div')
        dark.setAttribute('data-track-view', 'hidden_at_flip')
        hiddenWrap.appendChild(dark)
        document.body.appendChild(hiddenWrap)

        // remoteConfig 异步到达 → setEnabled(true) 触发 rescanCurrent 补扫
        Dap.shared.setEnabled(true)
        await tick()

        Dap.shared.flush()
        expect(events('visible_at_flip')).toHaveLength(1)
        expect(events('hidden_at_flip')).toHaveLength(0)
    })
})
