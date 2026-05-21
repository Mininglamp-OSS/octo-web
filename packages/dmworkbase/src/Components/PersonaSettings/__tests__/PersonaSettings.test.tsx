/**
 * PersonaSettings 列表页组件回归测试（BUG-1 / YUJ-1341, 2026-05-19）。
 *
 * 真实场景：DB 已存在一条 OBO grant（id=1, active=1, global_enabled=1），但
 * 进入「我的信息 → 我的分身」时列表渲染「还没有创建任何分身」。E2E 复现后定位
 * 到根因：VM 端 `didMount` → `loadGrants` 这条链在 `Provider.componentDidMount`
 * 之后才跑，而第一帧 PersonaListBody 早就用初值 `grants=[]` 渲染了；中间任何
 * 一次 setState 没有把后续 `notifyListener` 接回 DOM，列表就永远停在空态。
 *
 * 这条测试用 React Testing Library 拼真组件，模拟 apiClient 返回一条 grant，
 * 断言：
 *   1. 组件挂载后会触发 `apiClient.get("obo/grants")`
 *   2. 列表里出现 grant 的 bot 名（PersonaCard 已渲染）
 *   3. 空态文案「还没有创建任何分身」不再出现
 *
 * 防回归点：未来如果重构 didMount 链或 Provider 生命周期触发顺序，
 * PersonaListBody 自己的 useEffect 守住「至少打过一次 GET」语义不变。
 */

import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom"

const hoisted = vi.hoisted(() => {
    const get = vi.fn()
    const post = vi.fn()
    const del = vi.fn()
    const put = vi.fn()
    const toastError = vi.fn()
    const toastWarning = vi.fn()
    return { get, post, del, put, toastError, toastWarning }
})

vi.mock("../../../App", () => ({
    default: {
        apiClient: {
            get: hoisted.get,
            post: hoisted.post,
            delete: hoisted.del,
            put: hoisted.put,
        },
        shared: { currentSpaceId: "" },
    },
    __esModule: true,
}))

vi.mock("@douyinfe/semi-ui", () => ({
    Button: (props: any) =>
        React.createElement("button", { ...props, "data-testid": props["data-testid"] || "btn" }, props.children),
    // v2 (octo-web#73)：PersonaCard 现在内嵌 Switch 用作 active toggle。
    // 与 PersonaEdit.test 同款最小 stub —— 直接渲染原生 checkbox，
    // 避免拉起 Semi 主题 / portal 层，同时让测试能用 fireEvent.click 触发 onChange。
    Switch: (props: any) =>
        React.createElement("input", {
            type: "checkbox",
            checked: !!props.checked,
            onChange: (e: any) => props.onChange && props.onChange(e.target.checked),
            "data-testid": props["data-testid"] || "persona-list-switch",
        }),
    Toast: {
        error: hoisted.toastError,
        warning: hoisted.toastWarning,
    },
}))

import PersonaSettings from "../index"
import { OboGrant } from "../vm"

beforeEach(() => {
    hoisted.get.mockReset()
    hoisted.post.mockReset()
    hoisted.del.mockReset()
    hoisted.put.mockReset()
    hoisted.toastError.mockReset()
    hoisted.toastWarning.mockReset()
})

afterEach(() => {
    vi.restoreAllMocks()
})

const sampleGrant = (overrides: Partial<OboGrant> = {}): OboGrant => ({
    id: 1,
    grantor_uid: "admin",
    grantee_bot_uid: "27qFHDRBCJQ2c868c93_bot",
    grantee_bot_name: "James Persona",
    mode: "auto",
    global_enabled: true,
    active: true,
    ...overrides,
})

describe("PersonaSettings list — BUG-1 regression (YUJ-1341)", () => {
    it("fetches grants on mount via apiClient.get('obo/grants')", async () => {
        hoisted.get.mockResolvedValueOnce([sampleGrant()])
        render(<PersonaSettings />)
        await waitFor(() => {
            expect(hoisted.get).toHaveBeenCalledWith("obo/grants")
        })
    })

    it("renders the grant card when API returns one grant (BUG-1: list was stuck on empty state)", async () => {
        hoisted.get.mockResolvedValueOnce([sampleGrant({ grantee_bot_name: "James Persona" })])
        render(<PersonaSettings />)

        // Bot 名出现在 PersonaCard 内
        expect(await screen.findByText("James Persona")).toBeInTheDocument()
        // 空态文案不应再渲染
        expect(screen.queryByText(/还没有创建任何分身/)).not.toBeInTheDocument()
    })

    it("falls back to empty state when API returns an empty array (genuine no-grants case)", async () => {
        hoisted.get.mockResolvedValueOnce([])
        render(<PersonaSettings />)
        // 空态文案出现
        expect(await screen.findByText(/还没有创建任何分身/)).toBeInTheDocument()
    })

    it("shows '功能即将上线' when backend 404s (PR-A unmerged compatibility path)", async () => {
        hoisted.get.mockRejectedValueOnce({ status: 404, msg: "not found" })
        render(<PersonaSettings />)
        expect(await screen.findByText(/分身功能即将上线/)).toBeInTheDocument()
    })

    it("shows '加载失败' on non-404 errors and offers a retry button", async () => {
        hoisted.get.mockRejectedValueOnce({ status: 500, msg: "boom" })
        render(<PersonaSettings />)
        expect(await screen.findByText("加载失败")).toBeInTheDocument()
        expect(screen.getByText("重新加载")).toBeInTheDocument()
    })

    it("does not re-fetch when grants are already populated (mount-only guard)", async () => {
        // Two renders triggered by a stateful parent should still only fire one GET
        // (the PersonaListBody useEffect skips re-fetch when grants.length > 0).
        hoisted.get.mockResolvedValueOnce([sampleGrant()])
        const { rerender } = render(<PersonaSettings />)
        await screen.findByText("James Persona")
        const calls = hoisted.get.mock.calls.length
        rerender(<PersonaSettings />)
        // Allow any pending microtasks to flush
        await Promise.resolve()
        expect(hoisted.get.mock.calls.length).toBe(calls)
    })
})

/**
 * v2 (octo-web#73) PersonaCard active toggle 测试。
 *
 * 任务 1（issue body）：「列表行加 toggle，开启时调后端 mutex（关其它），active
 * 卡片高亮，其余 dimmed」。这一组测试覆盖：
 *   - 列表渲染时每行确实出现 Switch（用 data-testid 锁定）
 *   - 点击开 → PUT /v1/obo/grants/:id {active:true}（后端处理 mutex，前端只发 1 个请求）
 *   - active 卡片有 .wk-persona-card-active class，非 active 在「有人 active」时 dimmed
 *   - 点 toggle 不会冒泡触发卡片 onClick（不应跳进 PersonaEdit）—— 这是 UX 关键路径
 *   - 全部 inactive 时不 dim 任何卡片（dim 只在「有 active」时生效，否则会让空列表看上去全是禁用）
 *
 * Bot name 显示（任务 4）：grant.grantee_bot_name 应出现在 Card 上；这条已被
 * 「renders the grant card when API returns one grant」覆盖（断言 "James Persona"）。
 * 这里再加一条独立断言保证 v2 改造没回归。
 */
describe("PersonaSettings list — v2 (octo-web#73) active toggle + visual states", () => {
    it("renders a toggle on each persona row", async () => {
        hoisted.get.mockResolvedValueOnce([
            sampleGrant({ id: 1, grantee_bot_name: "Alpha" }),
            sampleGrant({ id: 2, grantee_bot_name: "Beta", active: false }),
        ])
        render(<PersonaSettings />)
        // 两张卡片 → 两个 toggle 容器
        expect(await screen.findByTestId("persona-card-toggle-1")).toBeInTheDocument()
        expect(screen.getByTestId("persona-card-toggle-2")).toBeInTheDocument()
    })

    it("toggling an inactive row → PUT /obo/grants/:id {active:true} (backend handles mutex)", async () => {
        hoisted.get.mockResolvedValueOnce([
            sampleGrant({ id: 7, grantee_bot_name: "Gamma", active: false }),
        ])
        // updateGrant → put then reload
        hoisted.put.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([
            sampleGrant({ id: 7, grantee_bot_name: "Gamma", active: true }),
        ])

        render(<PersonaSettings />)
        const toggleWrap = await screen.findByTestId("persona-card-toggle-7")
        const cb = toggleWrap.querySelector('input[type="checkbox"]') as HTMLInputElement
        expect(cb).toBeTruthy()
        expect(cb.checked).toBe(false)

        fireEvent.click(cb)

        // 关键合约：前端只 PUT {active:true}，**不**预先 PATCH 其它 grant 的 active=false。
        // 后端 (octo-server#108) 自行处理 mutex。
        await waitFor(() =>
            expect(hoisted.put).toHaveBeenCalledWith("obo/grants/7", { active: true }),
        )
        // 前端没多发别的 PUT
        expect(hoisted.put).toHaveBeenCalledTimes(1)
    })

    it("toggling an active row off → PUT {active:false}", async () => {
        hoisted.get.mockResolvedValueOnce([
            sampleGrant({ id: 9, grantee_bot_name: "Delta", active: true }),
        ])
        hoisted.put.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([
            sampleGrant({ id: 9, grantee_bot_name: "Delta", active: false }),
        ])
        render(<PersonaSettings />)
        const cb = (await screen.findByTestId("persona-card-toggle-9")).querySelector(
            'input[type="checkbox"]',
        ) as HTMLInputElement
        expect(cb.checked).toBe(true)
        fireEvent.click(cb)
        await waitFor(() =>
            expect(hoisted.put).toHaveBeenCalledWith("obo/grants/9", { active: false }),
        )
    })

    it("active card gets .wk-persona-card-active; non-active siblings get .wk-persona-card-dimmed", async () => {
        hoisted.get.mockResolvedValueOnce([
            sampleGrant({ id: 1, grantee_bot_name: "Alpha", active: true }),
            sampleGrant({ id: 2, grantee_bot_name: "Beta", active: false }),
            sampleGrant({ id: 3, grantee_bot_name: "Gamma", active: false }),
        ])
        render(<PersonaSettings />)
        const cardActive = await screen.findByTestId("persona-card-1")
        expect(cardActive.className).toContain("wk-persona-card-active")
        expect(cardActive.className).not.toContain("wk-persona-card-dimmed")

        const cardDimmed = screen.getByTestId("persona-card-2")
        expect(cardDimmed.className).toContain("wk-persona-card-dimmed")
        expect(cardDimmed.className).not.toContain("wk-persona-card-active")

        expect(screen.getByTestId("persona-card-3").className).toContain(
            "wk-persona-card-dimmed",
        )
    })

    it("when no row is active, none are dimmed (avoids the 'everything looks disabled' trap)", async () => {
        hoisted.get.mockResolvedValueOnce([
            sampleGrant({ id: 1, grantee_bot_name: "Alpha", active: false }),
            sampleGrant({ id: 2, grantee_bot_name: "Beta", active: false }),
        ])
        render(<PersonaSettings />)
        await screen.findByTestId("persona-card-1")
        expect(screen.getByTestId("persona-card-1").className).not.toContain(
            "wk-persona-card-dimmed",
        )
        expect(screen.getByTestId("persona-card-2").className).not.toContain(
            "wk-persona-card-dimmed",
        )
    })

    it("clicking the toggle does NOT bubble up to open PersonaEdit (UX guard)", async () => {
        hoisted.get.mockResolvedValueOnce([
            sampleGrant({ id: 5, grantee_bot_name: "Echo", active: false }),
        ])
        hoisted.put.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([
            sampleGrant({ id: 5, grantee_bot_name: "Echo", active: true }),
        ])
        render(<PersonaSettings />)
        const toggleWrap = await screen.findByTestId("persona-card-toggle-5")
        const cb = toggleWrap.querySelector('input[type="checkbox"]') as HTMLInputElement
        fireEvent.click(cb)
        await waitFor(() => expect(hoisted.put).toHaveBeenCalled())
        // PersonaEdit 的「关联 Bot」标签是它独有的，如果它被 push 进了 route stack
        // 应该会出现在 DOM 里。Bot 名 "Echo" 在卡片里也存在但「关联 Bot」label 只在 Edit 出现。
        expect(screen.queryByText("关联 Bot")).not.toBeInTheDocument()
    })

    it("persists grantee_bot_name on the card (task 4 — PR#70 regression guard)", async () => {
        hoisted.get.mockResolvedValueOnce([
            sampleGrant({
                id: 1,
                grantee_bot_uid: "27qFHDRBCJQ2c868c93_bot",
                grantee_bot_name: "James Persona",
            }),
        ])
        render(<PersonaSettings />)
        // 必须落 grantee_bot_name 而不是 uid；uid 不应该被人看见。
        expect(await screen.findByText("James Persona")).toBeInTheDocument()
        expect(
            screen.queryByText("27qFHDRBCJQ2c868c93_bot", { exact: false }),
        ).not.toBeInTheDocument()
    })
})
