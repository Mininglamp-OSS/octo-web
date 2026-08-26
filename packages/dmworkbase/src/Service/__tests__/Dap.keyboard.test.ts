import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 键盘激活补采契约(对应 PR #1320 review 的 P1-4 blocking):
 *   市场卡片(McpCard/SkillCard)是 div/article + role="button" + 自定义 onKeyDown 的
 *   **非原生**控件。Enter/Space 激活时浏览器**不派发 click**,只靠 click 委托会整条漏采
 *   键盘用户的 market_card_opened。委托必须另听 keydown,对非原生可激活元素补发;而原生
 *   button/a[href]/input 等会自行合成 click(click 委托已覆盖),keydown 必须显式跳过它们,
 *   否则一次键盘激活记两遍。
 *
 * 本用例**驱动真实 keydown/click 事件**并按生产顺序 init→setEnabled 初始化。
 * 去掉 installClickDelegation 里的 keydown 监听 → 非原生卡片断言变红;
 * 去掉 isNativeActivatable 的原生跳过 → 原生控件「不双记」断言变红(delete-the-fix)。
 * 单独成文件:vitest 默认按文件隔离(全新 jsdom)。
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

describe('Dap — keyboard activation of non-native role=button emits, native does not double (P1-4)', () => {
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

    function keydown(el: Element, key: string) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }

    it('emits market_card_opened on Enter/Space over a non-native role=button card', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.init()
        Dap.shared.setEnabled(true)

        // 市场卡片形状:div + role=button + data-track,键盘激活不产生 DOM click
        const card = document.createElement('div')
        card.setAttribute('role', 'button')
        card.setAttribute('tabindex', '0')
        card.setAttribute('data-track', 'market_card_opened')
        card.setAttribute('data-object-id', 'card-1')
        document.body.appendChild(card)

        keydown(card, 'Enter')
        keydown(card, ' ')

        Dap.shared.flush()
        // 两次键盘激活各补发一次(旧实现只听 click → 0 条,delete-the-fix 立即变红)
        expect(events('market_card_opened')).toHaveLength(2)
    })

    it('does NOT emit on non-activation keys', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.init()
        Dap.shared.setEnabled(true)

        const card = document.createElement('div')
        card.setAttribute('role', 'button')
        card.setAttribute('data-track', 'market_card_opened')
        document.body.appendChild(card)

        keydown(card, 'a')
        keydown(card, 'Tab')
        keydown(card, 'ArrowDown')

        Dap.shared.flush()
        expect(events('market_card_opened')).toHaveLength(0)
    })

    it('does NOT double-count a native <button data-track>: keydown skips it, click covers it', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.init()
        Dap.shared.setEnabled(true)

        const btn = document.createElement('button')
        btn.setAttribute('data-track', 'market_skill_install_clicked')
        btn.setAttribute('data-object-id', 'skill-1')
        document.body.appendChild(btn)

        // 键盘激活原生 button:浏览器会自行合成 click(此处用真实 click 模拟),
        // keydown 委托必须跳过原生控件,否则这一次激活记两遍。
        keydown(btn, 'Enter')
        btn.dispatchEvent(new Event('click', { bubbles: true }))

        Dap.shared.flush()
        expect(events('market_skill_install_clicked')).toHaveLength(1)
    })

    it('keydown over a native child inside a non-native card does not fire the card (native synthesizes its own click)', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.init()
        Dap.shared.setEnabled(true)

        // 卡片根 role=button;footer 里的编辑按钮是原生 button,聚焦在它上按 Enter
        // 时浏览器合成的是「按钮的 click」,不应被 keydown 误当成「打开卡片」。
        const card = document.createElement('div')
        card.setAttribute('role', 'button')
        card.setAttribute('data-track', 'market_card_opened')
        const editBtn = document.createElement('button')
        card.appendChild(editBtn)
        document.body.appendChild(card)

        keydown(editBtn, 'Enter')

        Dap.shared.flush()
        expect(events('market_card_opened')).toHaveLength(0)
    })
})
