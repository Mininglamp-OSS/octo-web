/**
 * PersonaEdit 组件回归测试（R4 P1, YUJ-1206 / GH octo-web#47 review 2026-05-19 07:38）
 *
 * 这条 bug 的本质：旧 UI 把所有 scope 都展示成「生效会话」并提供「删除」按钮，
 * 但 ChannelSettingVM 在 R2 引入了「scope.enabled=false = 在 global=on 模式下
 * 静音此 channel」的语义。结果 global=on + 排除型 scope 时，用户看到「生效:
 * 群X」「删除」→ 删掉的是排除条目 → 群 X 反而被重新启用 → 意图被反转。
 *
 * 这是 on-behalf-of 功能里最危险的反向操作（impersonate 用户发言），必须在 UI
 * 层就用文案 + 分区彻底消除歧义。
 *
 * 本测试用真实的 React + Testing Library 组装 PersonaEdit，因为问题完全在
 * 组件层（VM 的 removeScope 行为没问题）。VM 行为另见 vm.test.ts。
 *
 * mock 策略对齐 vm.test.ts：apiClient + Toast 走 vi.hoisted；@douyinfe/semi-ui
 * Switch 用最小 stub（直接渲染 `<input type=checkbox>`）避免 jsdom 拉起整个
 * Semi 主题层。
 */

import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
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
    // 最小 Switch stub：渲染一个普通 checkbox，避免拉起 Semi 的样式 / portal 系统。
    Switch: (props: any) =>
        React.createElement("input", {
            type: "checkbox",
            checked: !!props.checked,
            onChange: (e: any) => props.onChange && props.onChange(e.target.checked),
            "data-testid": "persona-edit-global-switch",
        }),
    Toast: {
        error: hoisted.toastError,
        warning: hoisted.toastWarning,
    },
}))

// 在所有 mock 之后再 import 被测组件 + VM。
import PersonaEdit from "../PersonaEdit"
import { OboGrant, OboScope } from "../vm"

const baseGrant = (overrides: Partial<OboGrant> = {}): OboGrant => ({
    id: 99,
    grantor_uid: "u1",
    grantee_bot_uid: "b1",
    grantee_bot_name: "Test Bot",
    mode: "auto",
    global_enabled: false,
    active: true,
    ...overrides,
})

const scope = (overrides: Partial<OboScope> & Pick<OboScope, "id" | "channel_id">): OboScope => ({
    grant_id: 99,
    channel_type: 2,
    enabled: true,
    ...overrides,
} as OboScope)

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

/**
 * 等待 PersonaEditVM.didMount() → loadScopes() 完成 + Provider setState 重渲染。
 * 直接 await screen.findByText 也能同步等待，但显式 helper 更清晰。
 */
async function waitForScopesLoaded(): Promise<void> {
    await waitFor(() => expect(hoisted.get).toHaveBeenCalledWith("obo/grants/99/scopes"))
}

describe("PersonaEdit — inclusion / exclusion partition (R4 P1)", () => {
    it("global=off: 只展示 inclusion 行，文案=「已启用的会话」，按钮=「停止代答」", async () => {
        hoisted.get.mockResolvedValueOnce([
            scope({ id: 1, channel_id: "groupY", channel_type: 2, enabled: true }),
            scope({ id: 2, channel_id: "dmCarol", channel_type: 1, enabled: true }),
            // exclusion 记录在 global=off 时无意义 —— 不应渲染。
            scope({ id: 3, channel_id: "leftoverX", channel_type: 2, enabled: false }),
        ])
        render(
            <PersonaEdit
                grant={baseGrant({ global_enabled: false })}
                onDeleted={() => {}}
            />,
        )
        await waitForScopesLoaded()

        // 段落标题
        expect(await screen.findByTestId("persona-edit-scope-title")).toHaveTextContent(
            "已启用的会话 (2)",
        )

        // 包含行可见
        expect(screen.getByTestId("persona-edit-scope-row-1")).toHaveAttribute(
            "data-scope-kind",
            "inclusion",
        )
        expect(screen.getByTestId("persona-edit-scope-row-2")).toBeInTheDocument()

        // 关键：global=off 时 exclusion 行必须被隐藏，避免误导用户在「无效记录」上点击。
        expect(screen.queryByTestId("persona-edit-scope-row-3")).not.toBeInTheDocument()

        // 按钮文案 = 停止代答，跟 effective 状态一致（删除 → 落回 global=off → 关闭）。
        const removeBtns = screen.getAllByText("停止代答")
        expect(removeBtns).toHaveLength(2)
        expect(screen.queryByText("恢复代答")).not.toBeInTheDocument()
        expect(screen.queryByText("移除")).not.toBeInTheDocument()
    })

    it("global=on: 只展示 exclusion 行，文案=「已排除的会话」，按钮=「恢复代答」", async () => {
        hoisted.get.mockResolvedValueOnce([
            // 在 global=on 模式下 inclusion 是冗余，隐藏避免噪声。
            scope({ id: 10, channel_id: "groupY", channel_type: 2, enabled: true }),
            // exclusion 是「静音此 channel」，应展示并允许「恢复代答」。
            scope({ id: 11, channel_id: "groupX", channel_type: 2, enabled: false }),
            scope({ id: 12, channel_id: "dmBob", channel_type: 1, enabled: false }),
        ])
        render(
            <PersonaEdit
                grant={baseGrant({ global_enabled: true })}
                onDeleted={() => {}}
            />,
        )
        await waitForScopesLoaded()

        expect(await screen.findByTestId("persona-edit-scope-title")).toHaveTextContent(
            "已排除的会话 (2)",
        )

        expect(screen.queryByTestId("persona-edit-scope-row-10")).not.toBeInTheDocument()
        expect(screen.getByTestId("persona-edit-scope-row-11")).toHaveAttribute(
            "data-scope-kind",
            "exclusion",
        )
        expect(screen.getByTestId("persona-edit-scope-row-12")).toBeInTheDocument()

        const removeBtns = screen.getAllByText("恢复代答")
        expect(removeBtns).toHaveLength(2)
        expect(screen.queryByText("停止代答")).not.toBeInTheDocument()
        // 旧的「移除」/「删除」字样不允许再出现在 scope 行上 —— 那是引发反转的根源。
        expect(screen.queryByText("移除")).not.toBeInTheDocument()
    })
})

describe("PersonaEdit — remove action wiring (R4 P1 regression guard)", () => {
    it("inclusion remove (global=off) → 调用 DELETE /v1/obo/scopes/:id (happy path)", async () => {
        hoisted.get.mockResolvedValueOnce([
            scope({ id: 1, channel_id: "groupY", channel_type: 2, enabled: true }),
        ])
        // 删除后的 reload
        hoisted.del.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([])

        render(
            <PersonaEdit
                grant={baseGrant({ global_enabled: false })}
                onDeleted={() => {}}
            />,
        )
        await waitForScopesLoaded()

        const btn = await screen.findByTestId("persona-edit-scope-remove-1")
        expect(btn).toHaveTextContent("停止代答")
        fireEvent.click(btn)

        await waitFor(() => expect(hoisted.del).toHaveBeenCalledWith("obo/scopes/1"))
    })

    it("exclusion remove (global=on) → 调用 DELETE /v1/obo/scopes/:id，按钮文案=「恢复代答」", async () => {
        // 这条 case 正是 reviewer 指出的反转场景：
        //   - 用户处于 global=on 模式
        //   - 某 channel 被 exclusion 静音
        //   - 用户在 PersonaEdit 看到此行 → 真实意图是「我不想让它再被静音 / 想恢复代答」
        //   - 旧 UI 写「删除」，让用户以为是「停止代答」（与真实效果完全相反）
        //   - 新 UI 写「恢复代答」，与底层 removeScope → 落回 global=on → channel 启用 的效果一致
        hoisted.get.mockResolvedValueOnce([
            scope({ id: 11, channel_id: "groupX", channel_type: 2, enabled: false }),
        ])
        hoisted.del.mockResolvedValueOnce({})
        hoisted.get.mockResolvedValueOnce([])

        render(
            <PersonaEdit
                grant={baseGrant({ global_enabled: true })}
                onDeleted={() => {}}
            />,
        )
        await waitForScopesLoaded()

        const btn = await screen.findByTestId("persona-edit-scope-remove-11")
        // 关键断言：按钮上的文字必须明确表达「这次点击会让 persona 在此处恢复代答」，
        // 而不是误导成「删除 = 停止代答」。
        expect(btn).toHaveTextContent("恢复代答")
        expect(btn).not.toHaveTextContent("删除")
        expect(btn).not.toHaveTextContent("停止代答")

        fireEvent.click(btn)
        await waitFor(() => expect(hoisted.del).toHaveBeenCalledWith("obo/scopes/11"))
    })

    it("global=off 时 exclusion 行不渲染 → 用户点不到这条「会反转意图」的按钮", async () => {
        hoisted.get.mockResolvedValueOnce([
            scope({ id: 11, channel_id: "groupX", channel_type: 2, enabled: false }),
            scope({ id: 12, channel_id: "dmBob", channel_type: 1, enabled: false }),
        ])
        render(
            <PersonaEdit
                grant={baseGrant({ global_enabled: false })}
                onDeleted={() => {}}
            />,
        )
        await waitForScopesLoaded()

        // 段落标题应展示「已启用的会话 (0)」，列表里没有任何可点击行。
        expect(await screen.findByTestId("persona-edit-scope-title")).toHaveTextContent(
            "已启用的会话 (0)",
        )
        expect(screen.queryByTestId("persona-edit-scope-row-11")).not.toBeInTheDocument()
        expect(screen.queryByTestId("persona-edit-scope-row-12")).not.toBeInTheDocument()
        // 空态文案应引导用户去 ChannelSetting 开 toggle。
        expect(screen.getByText(/尚未启用任何会话/)).toBeInTheDocument()
    })

    it("global=on 时空 exclusion → 提示「暂无排除的会话」", async () => {
        hoisted.get.mockResolvedValueOnce([])
        render(
            <PersonaEdit
                grant={baseGrant({ global_enabled: true })}
                onDeleted={() => {}}
            />,
        )
        await waitForScopesLoaded()

        expect(await screen.findByTestId("persona-edit-scope-title")).toHaveTextContent(
            "已排除的会话 (0)",
        )
        expect(screen.getByText(/暂无排除的会话/)).toBeInTheDocument()
    })
})
