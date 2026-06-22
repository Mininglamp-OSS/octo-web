// @vitest-environment jsdom

import React from "react"
import ReactDOM from "react-dom"
import { renderToStaticMarkup } from "react-dom/server"
import { act } from "react-dom/test-utils"
import { afterEach, describe, it, expect, vi } from "vitest"

vi.mock("../../../../i18n", () => ({
    useI18n: () => ({
        t: (key: string) => {
            const messages: Record<string, string> = {
                "base.message.avatar.alt": "Avatar",
                "base.message.edited": "已编辑",
                "base.realnameVerified.title": "已完成实名认证",
                "base.realnameVerified.label": "已实名",
            }
            return messages[key] ?? key
        },
    }),
}))

import MessageRow from "../index"

let container: HTMLDivElement | null = null

afterEach(() => {
    if (!container) return
    ReactDOM.unmountComponentAtNode(container)
    container.remove()
    container = null
})

function renderRow(element: React.ReactElement) {
    container = document.createElement("div")
    document.body.appendChild(container)
    act(() => {
        ReactDOM.render(element, container)
    })
    return container
}

function dispatchMouseEvent(element: Element, type: string) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true })
    act(() => {
        element.dispatchEvent(event)
    })
    return event
}

describe("MessageRow — selection mode interactions", () => {
    const baseProps = {
        isSend: false,
        isContinue: false,
        isSelected: false,
        showAvatar: true,
        avatarUrl: "https://example.test/avatar.png",
        senderName: "yujiawei",
        timestamp: "10:30",
    }

    it("turns row clicks into selection and suppresses row-specific actions while selecting", () => {
        const onSelect = vi.fn()
        const onClick = vi.fn()
        const onContextMenu = vi.fn()
        const onAvatarClick = vi.fn()
        const onSenderNameClick = vi.fn()

        const root = renderRow(
            <MessageRow
                {...baseProps}
                showCheckbox={true}
                onSelect={onSelect}
                onClick={onClick}
                onContextMenu={onContextMenu}
                onAvatarClick={onAvatarClick}
                onSenderNameClick={onSenderNameClick}
            >
                <button type="button">open</button>
            </MessageRow>
        )

        dispatchMouseEvent(root.querySelector(".wk-msg-row")!, "click")
        expect(onSelect).toHaveBeenLastCalledWith(true)
        expect(onClick).not.toHaveBeenCalled()

        dispatchMouseEvent(root.querySelector(".wk-msg-avatar")!, "click")
        expect(onAvatarClick).not.toHaveBeenCalled()
        expect(onSelect).toHaveBeenCalledTimes(2)

        dispatchMouseEvent(root.querySelector(".wk-msg-row-sender")!, "click")
        expect(onSenderNameClick).not.toHaveBeenCalled()
        expect(onSelect).toHaveBeenCalledTimes(3)

        const contextMenuEvent = dispatchMouseEvent(root.querySelector(".wk-msg-row")!, "contextmenu")
        expect(onContextMenu).not.toHaveBeenCalled()
        expect(contextMenuEvent.defaultPrevented).toBe(true)
    })

    it("suppresses row-specific actions for unselectable rows while selection mode is active", () => {
        const onSelect = vi.fn()
        const onClick = vi.fn()
        const onContextMenu = vi.fn()
        const onAvatarClick = vi.fn()
        const onSenderNameClick = vi.fn()

        const root = renderRow(
            <MessageRow
                {...baseProps}
                selectionMode={true}
                showCheckbox={false}
                onSelect={onSelect}
                onClick={onClick}
                onContextMenu={onContextMenu}
                onAvatarClick={onAvatarClick}
                onSenderNameClick={onSenderNameClick}
            >
                <button type="button">open</button>
            </MessageRow>
        )

        dispatchMouseEvent(root.querySelector(".wk-msg-row")!, "click")
        expect(onSelect).not.toHaveBeenCalled()
        expect(onClick).not.toHaveBeenCalled()

        dispatchMouseEvent(root.querySelector(".wk-msg-avatar")!, "click")
        expect(onAvatarClick).not.toHaveBeenCalled()
        expect(onSelect).not.toHaveBeenCalled()

        dispatchMouseEvent(root.querySelector(".wk-msg-row-sender")!, "click")
        expect(onSenderNameClick).not.toHaveBeenCalled()
        expect(onSelect).not.toHaveBeenCalled()

        const contextMenuEvent = dispatchMouseEvent(root.querySelector(".wk-msg-row")!, "contextmenu")
        expect(onContextMenu).not.toHaveBeenCalled()
        expect(contextMenuEvent.defaultPrevented).toBe(true)
    })

    it("keeps row-specific actions available outside selection mode", () => {
        const onSelect = vi.fn()
        const onClick = vi.fn()
        const onContextMenu = vi.fn()
        const onAvatarClick = vi.fn()
        const onSenderNameClick = vi.fn()

        const root = renderRow(
            <MessageRow
                {...baseProps}
                onSelect={onSelect}
                onClick={onClick}
                onContextMenu={onContextMenu}
                onAvatarClick={onAvatarClick}
                onSenderNameClick={onSenderNameClick}
            >
                <button type="button">open</button>
            </MessageRow>
        )

        dispatchMouseEvent(root.querySelector(".wk-msg-row")!, "click")
        expect(onClick).toHaveBeenCalledTimes(1)
        expect(onSelect).not.toHaveBeenCalled()

        dispatchMouseEvent(root.querySelector(".wk-msg-avatar")!, "click")
        expect(onAvatarClick).toHaveBeenCalledTimes(1)

        dispatchMouseEvent(root.querySelector(".wk-msg-row-sender")!, "click")
        expect(onSenderNameClick).toHaveBeenCalledTimes(1)

        dispatchMouseEvent(root.querySelector(".wk-msg-row")!, "contextmenu")
        expect(onContextMenu).toHaveBeenCalledTimes(1)
    })
})

/**
 * 老组件 `wk-msg-row-header` 补齐 @SpaceName 渲染。
 *
 * 背景：
 *   R1-R6 五轮都改的是新组件 `wk-msg-head`，但真正上屏的是这个老组件
 *   `wk-msg-row-header`（Yu 15:13 PC Chrome fiber 爬虫定位）：
 *     - msg-level `fromHomeSpaceId` = "minglue_default" ✅
 *     - resolveExternalForViewer → isExternal=true, sourceSpaceName="ExampleCorp" ✅
 *     - 但 DOM 里 .wk-msg-head-space 压根不存在（这个老组件没渲染）
 *
 *   这组测试把「@SpaceName 真的渲染到了 wk-msg-row-header 的 DOM 里」这一层
 *   钉死，任何回归（忘记透传 props、误删分支、或又一次只改新组件）都会红。
 */
describe("MessageRow — @SpaceName suffix in wk-msg-row-header", () => {
    const baseProps = {
        isSend: false,
        isContinue: false,
        isSelected: false,
        showAvatar: true,
        avatarUrl: "https://example.test/avatar.png",
        senderName: "yujiawei",
        timestamp: "10:30",
    }

    it("renders @SpaceName when isExternal=true and sourceSpaceName is present (cross-space case)", () => {
        // 跨 Space 场景：viewer = 测试空间1，sender home = ExampleCorp
        const html = renderToStaticMarkup(
            <MessageRow
                {...baseProps}
                isExternal={true}
                sourceSpaceName="ExampleCorp"
            >
                <div className="msg-body">hello</div>
            </MessageRow>
        )
        expect(html).toContain("yujiawei")
        // 关键断言：老组件 header 里必须有 @SpaceName
        expect(html).toMatch(/wk-msg-row-sender-space/)
        expect(html).toContain("@ExampleCorp")
        expect(html).toMatch(/title="@ExampleCorp"/)
        // 必须出现在 wk-msg-row-header 容器内（避免跑偏到别处）
        expect(html).toMatch(
            /wk-msg-row-header[\s\S]*wk-msg-row-sender-space/
        )
    })

    it("does NOT render @SpaceName when isExternal=false (same-space case)", () => {
        // 同 Space 场景：viewer 与 sender 同 Space，isExternal=false
        const html = renderToStaticMarkup(
            <MessageRow
                {...baseProps}
                isExternal={false}
                sourceSpaceName="ExampleCorp"
            >
                <div className="msg-body">hello</div>
            </MessageRow>
        )
        expect(html).toContain("yujiawei")
        expect(html).not.toMatch(/wk-msg-row-sender-space/)
        expect(html).not.toContain("@ExampleCorp")
    })

    it("does NOT render @SpaceName when sourceSpaceName is missing/empty even if isExternal=true", () => {
        // 防守：homeSpaceId 在但 homeSpaceName 为空时不应显示空的 `@` 字符
        const htmlEmpty = renderToStaticMarkup(
            <MessageRow
                {...baseProps}
                isExternal={true}
                sourceSpaceName=""
            >
                <div className="msg-body">hello</div>
            </MessageRow>
        )
        expect(htmlEmpty).not.toMatch(/wk-msg-row-sender-space/)

        const htmlUndef = renderToStaticMarkup(
            <MessageRow
                {...baseProps}
                isExternal={true}
                // sourceSpaceName omitted
            >
                <div className="msg-body">hello</div>
            </MessageRow>
        )
        expect(htmlUndef).not.toMatch(/wk-msg-row-sender-space/)
    })

    it("does NOT render the header at all when isContinue=true (连续消息沿用上一条 header)", () => {
        const html = renderToStaticMarkup(
            <MessageRow
                {...baseProps}
                isContinue={true}
                showAvatar={false}
                isExternal={true}
                sourceSpaceName="ExampleCorp"
            >
                <div className="msg-body">continued</div>
            </MessageRow>
        )
        // 连续消息压根没 wk-msg-row-header 容器，@SpaceName 也就不出现
        expect(html).not.toMatch(/wk-msg-row-header/)
        expect(html).not.toContain("@ExampleCorp")
    })
})

/**
 * Epic dmwork-web#1169 Phase A — 聊天气泡作者名旁的实名徽章。
 *
 * 2026-05-10 Yu 决策解除「聊天气泡不使用 RealnameVerifiedBadge」硬约束：
 * 实名比例约 20%，徽章已从「噪音」变成「稀缺的差异化信号」，尤其对外部群混合
 * 身份场景有价值。
 *
 * 硬要求：
 *   - **只** variant="icon"，未实名一律不渲染（不加灰色 badge / 警告标）。
 *   - 字段缺失 / false / 0 等都走未实名分支。
 *   - 徽章位于 wk-msg-row-header 容器内，紧贴作者名右侧。
 */
describe("MessageRow — RealnameVerifiedBadge in wk-msg-row-header (Phase A)", () => {
    const baseProps = {
        isSend: false,
        isContinue: false,
        isSelected: false,
        showAvatar: true,
        avatarUrl: "https://example.test/avatar.png",
        senderName: "yujiawei",
        timestamp: "10:30",
    }

    it("renders the realname ✓ badge when isRealnameVerified=true (verified fixture)", () => {
        const html = renderToStaticMarkup(
            <MessageRow
                {...baseProps}
                isRealnameVerified={true}
            >
                <div className="msg-body">hello</div>
            </MessageRow>
        )
        expect(html).toContain("yujiawei")
        // 关键断言：icon variant 的 realname badge 必须渲染在 header 里
        expect(html).toMatch(/wk-realname-badge/)
        expect(html).toMatch(/wk-realname-badge--icon/)
        expect(html).toMatch(/已完成实名认证/) // title attr
        // 必须在 wk-msg-row-header 容器内
        expect(html).toMatch(/wk-msg-row-header[\s\S]*wk-realname-badge/)
        // icon variant 下不得出现「已实名」文字（只一个 ✓ 圆点）
        expect(html).not.toContain("已实名</span>")
    })

    it("does NOT render the realname badge when isRealnameVerified is false / undefined / missing (unverified + field-missing degradation)", () => {
        // 未实名：显式 false
        const htmlFalse = renderToStaticMarkup(
            <MessageRow {...baseProps} isRealnameVerified={false}>
                <div className="msg-body">hi</div>
            </MessageRow>
        )
        expect(htmlFalse).toContain("yujiawei")
        expect(htmlFalse).not.toMatch(/wk-realname-badge/)

        // 字段缺失：prop 根本没传（模拟 orgData 字段缺失场景）
        const htmlMissing = renderToStaticMarkup(
            <MessageRow {...baseProps}>
                <div className="msg-body">hi</div>
            </MessageRow>
        )
        expect(htmlMissing).toContain("yujiawei")
        expect(htmlMissing).not.toMatch(/wk-realname-badge/)
    })

    it("does NOT render the realname badge when isContinue=true (连续消息无 header)", () => {
        const html = renderToStaticMarkup(
            <MessageRow
                {...baseProps}
                isContinue={true}
                showAvatar={false}
                isRealnameVerified={true}
            >
                <div className="msg-body">continued</div>
            </MessageRow>
        )
        // 连续消息压根没 wk-msg-row-header 容器，徽章也不渲染
        expect(html).not.toMatch(/wk-msg-row-header/)
        expect(html).not.toMatch(/wk-realname-badge/)
    })

    it("renders both @SpaceName suffix AND realname ✓ badge together (cross-space + verified)", () => {
        // 外部实名用户：两个徽章并存（@SpaceName + ✓）。实名徽章紧贴作者名
        // 右侧（Yu 约束：「紧贴作者名右侧」），@SpaceName 再在 badge 后。
        const html = renderToStaticMarkup(
            <MessageRow
                {...baseProps}
                isExternal={true}
                sourceSpaceName="ExampleCorp"
                isRealnameVerified={true}
            >
                <div className="msg-body">hello</div>
            </MessageRow>
        )
        expect(html).toMatch(/wk-msg-row-sender-space/)
        expect(html).toMatch(/wk-realname-badge--icon/)
        expect(html).toContain("@ExampleCorp")
        // 两者都在 header 内；实名 ✓ 紧贴作者名（先 sender 再 badge 再 @Space）
        expect(html).toMatch(
            /wk-msg-row-header[\s\S]*wk-msg-row-sender[\s\S]*wk-realname-badge[\s\S]*wk-msg-row-sender-space/
        )
    })
})

/**
 * 群入站 Webhook 发送者「无 profile / 无 actions」保证。
 *
 * 背景（PR #376 fast-follow）：
 *   bridge 层 useMessageRow 对 webhook 行（FromUID=iwh_*）特意省略了
 *   onAvatarClick / onSenderNameClick，但调用方（Text/Image/RichText/Video/
 *   File/Mergeforward 6 个渲染器）spread props 后又无条件硬传 handler，
 *   而 MessageRow 原先只判 handler 是否存在、不判 isWebhook —— 导致 webhook
 *   头像照样可点，弹出针对 iwh_* 的头像动作菜单（含 @TA），违背 PR
 *   「webhook 发送者无个人资料 / 无操作」的承诺。
 *
 *   修复：MessageRow 在 isWebhook=true 时中央抑制头像 / 名字点击 handler，
 *   一处覆盖全部 6 个渲染器。这组测试把「webhook 行不触发点击」钉死。
 */
describe("MessageRow — webhook sender is non-interactive (isWebhook gate)", () => {
    const baseProps = {
        isSend: false,
        isContinue: false,
        isSelected: false,
        showAvatar: true,
        avatarUrl: "https://example.test/iwh-avatar.png",
        senderName: "告警机器人",
        timestamp: "10:30",
    }

    it("does NOT fire onAvatarClick / onSenderNameClick for webhook rows", () => {
        const onAvatarClick = vi.fn()
        const onSenderNameClick = vi.fn()

        const root = renderRow(
            <MessageRow
                {...baseProps}
                isWebhook={true}
                onAvatarClick={onAvatarClick}
                onSenderNameClick={onSenderNameClick}
            >
                <div className="msg-body">deploy succeeded</div>
            </MessageRow>
        )

        dispatchMouseEvent(root.querySelector(".wk-msg-avatar")!, "click")
        expect(onAvatarClick).not.toHaveBeenCalled()

        dispatchMouseEvent(root.querySelector(".wk-msg-row-sender")!, "click")
        expect(onSenderNameClick).not.toHaveBeenCalled()
    })

    it("does NOT show pointer cursor on the webhook sender name", () => {
        const html = renderToStaticMarkup(
            <MessageRow
                {...baseProps}
                isWebhook={true}
                onSenderNameClick={() => {}}
            >
                <div className="msg-body">deploy succeeded</div>
            </MessageRow>
        )
        // webhook 行的作者名不应带 cursor:pointer（暗示可点击）
        expect(html).not.toMatch(/wk-msg-row-sender[^>]*cursor:\s*pointer/)
    })

    it("positive control: non-webhook rows still fire avatar / name clicks", () => {
        const onAvatarClick = vi.fn()
        const onSenderNameClick = vi.fn()

        const root = renderRow(
            <MessageRow
                {...baseProps}
                isWebhook={false}
                onAvatarClick={onAvatarClick}
                onSenderNameClick={onSenderNameClick}
            >
                <div className="msg-body">hi</div>
            </MessageRow>
        )

        dispatchMouseEvent(root.querySelector(".wk-msg-avatar")!, "click")
        expect(onAvatarClick).toHaveBeenCalledTimes(1)

        dispatchMouseEvent(root.querySelector(".wk-msg-row-sender")!, "click")
        expect(onSenderNameClick).toHaveBeenCalledTimes(1)
    })
})
