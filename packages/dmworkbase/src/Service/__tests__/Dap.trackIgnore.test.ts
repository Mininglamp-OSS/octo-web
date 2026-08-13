import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 点击委托的「子控件退出」契约(对应 PR #1320 review 的 P1-A4 blocking)+ 生产安装顺序(P2-2):
 *   - channel_opened 挂在会话行根;行内的拖拽柄、展开线程标签用 stopPropagation 表示
 *     「本次点击不打开会话」。但委托在**捕获阶段**执行(先于 stopPropagation),必须靠
 *     data-track-ignore 显式排除,否则这些子控件点击也会记一条 channel_opened(虚高)。
 *   - 生产顺序是 init() 先、setEnabled(true) 后(remoteConfig 回调),采集机制由 setEnabled
 *     路径惰性装;此前所有用例都是反的(setEnabled 再 init),shipping 路径未被任何测试钉住。
 *
 * 本用例**驱动真实事件**并按生产顺序初始化。去掉 handler 里的 data-track-ignore 跳过分支,
 * 「子控件点击」断言立即变红(delete-the-fix)。
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

describe('Dap — declarative click skips data-track-ignore children (P1-A4) in prod init order (P2-2)', () => {
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

    it('emits channel_opened for a bare row click but NOT for a click inside a stopPropagation child', async () => {
        const { Dap } = await freshTracker()
        // 生产顺序:先 init(),采集机制此时不装(dark);再 setEnabled(true) 惰性装(P2-2)
        Dap.shared.init()
        Dap.shared.setEnabled(true)

        // 会话行(channel_opened)包含一个 data-track-ignore 的展开线程标签
        const row = document.createElement('div')
        row.setAttribute('data-track', 'channel_opened')
        row.setAttribute('data-object-id', 'ch-1')
        const label = document.createElement('span') // 行内容,点它=打开会话
        const threadTag = document.createElement('span') // 展开线程,stopPropagation,不打开
        threadTag.setAttribute('data-track-ignore', '')
        row.appendChild(label)
        row.appendChild(threadTag)
        document.body.appendChild(row)

        // 点行主体 → 打开会话 → 记 1 条(证明委托本身经 setEnabled 路径已装好)
        label.dispatchEvent(new Event('click', { bubbles: true }))
        // 点被 ignore 的子控件 → 不打开会话 → 不应记
        threadTag.dispatchEvent(new Event('click', { bubbles: true }))

        Dap.shared.flush()
        expect(events('channel_opened')).toHaveLength(1)
    })

    it('market card: a click inside the data-track-ignore footer does NOT emit market_card_opened, but the install button keeps its own event (P1-2)', async () => {
        const { Dap } = await freshTracker()
        Dap.shared.init()
        Dap.shared.setEnabled(true)

        // 市场卡片形状(McpCard/SkillCard):卡根 data-track=market_card_opened;
        // footer 用 data-track-ignore 罩住编辑/删除,但 install 按钮自带 data-track。
        const card = document.createElement('div')
        card.setAttribute('role', 'button')
        card.setAttribute('data-track', 'market_card_opened')
        card.setAttribute('data-object-id', 'card-1')

        const body = document.createElement('div') // 卡片主体,点它=打开详情
        const footer = document.createElement('div')
        footer.setAttribute('data-track-ignore', '')
        const editBtn = document.createElement('button') // 编辑,无 data-track → 归到卡根但被 ignore
        const installBtn = document.createElement('button')
        installBtn.setAttribute('data-track', 'skill_install_clicked') // closest() 停在按钮,不受 ignore 影响
        installBtn.setAttribute('data-object-id', 'card-1')
        footer.appendChild(editBtn)
        footer.appendChild(installBtn)
        card.appendChild(body)
        card.appendChild(footer)
        document.body.appendChild(card)

        body.dispatchEvent(new Event('click', { bubbles: true }))      // 打开详情 → 1 条 view
        editBtn.dispatchEvent(new Event('click', { bubbles: true }))   // footer 内 → 不记 view
        installBtn.dispatchEvent(new Event('click', { bubbles: true })) // 记 install,不记 view

        Dap.shared.flush()
        expect(events('market_card_opened')).toHaveLength(1)
        expect(events('skill_install_clicked')).toHaveLength(1)
    })
})
