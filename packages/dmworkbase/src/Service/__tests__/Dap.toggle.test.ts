import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 声明式点击委托的去重契约(对应 PR #1320 review 的 P1 blocking):
 *   - Semi Switch / 原生 checkbox 一次物理切换会**同时**冒泡 click 和 change,
 *     两者都命中同一个 [data-track] wrapper。若委托同时监听 click+change,
 *     group_setting_toggled 会被记两遍(看着开了一次、数据里两次)。
 *
 * 关键:本用例**驱动真实事件派发**(往控件上分别 dispatch click 与 change),而不是
 * 直接调 track() —— 正是这类 driver 测试能锁住"只发一条"。给 installClickDelegation
 * 重新加回 `document.addEventListener('change', handler, true)`,本用例立即变红
 * (delete-the-fix:断言从 1 变 2)。
 *
 * 单独成文件:vitest 默认按文件隔离(全新 jsdom),避免其它用例 init() 遗留在共享
 * document 上、未断开的监听串扰本用例。
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

describe('Dap — declarative toggle fires once on a click+change gesture (P1)', () => {
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

    it('emits group_setting_toggled exactly once when a Switch dispatches both click and change', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.setEnabled(true)
        Dap.shared.init()

        // Semi Switch 结构:带 data-track 的 wrapper 包一个原生 checkbox
        const wrapper = document.createElement('label')
        wrapper.setAttribute('data-track', 'group_setting_toggled')
        wrapper.setAttribute('data-track-setting-key', 'allow_no_mention')
        const input = document.createElement('input')
        input.type = 'checkbox'
        wrapper.appendChild(input)
        document.body.appendChild(wrapper)

        // 一次物理切换 → 内层 checkbox 同时冒泡 click 与 change(都到达 document 捕获)
        input.dispatchEvent(new Event('click', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))

        Dap.shared.flush()

        // 恰好一条 —— 不因 click+change 双发而记两遍
        expect(events('group_setting_toggled')).toHaveLength(1)
    })
})
