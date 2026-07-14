// @vitest-environment jsdom
import React from "react"
import ReactDOM from "react-dom"
import { renderToStaticMarkup } from "react-dom/server"
import { act } from "react-dom/test-utils"
import { describe, it, expect, vi } from "vitest"

// ── Minimal SDK stubs ─────────────────────────────────────────────────────────
vi.mock("wukongimjssdk", () => {
    const ChannelTypePerson = 1
    const MessageContentType = { text: 1, image: 2 }
    const WKSDK = {
        shared: () => ({
            channelManager: {
                addListener: vi.fn(),
                removeListener: vi.fn(),
                getChannelInfo: vi.fn(() => null),
                fetchChannelInfo: vi.fn(),
            },
        }),
    }
    class Channel {
        channelID: string; channelType: number
        constructor(id: string, type: number) { this.channelID = id; this.channelType = type }
    }
    return { ChannelTypePerson, MessageContentType, WKSDK, Channel }
})

vi.mock("../../App", () => ({
    default: { loginInfo: { uid: "user-self" } },
}))

vi.mock("../../i18n", () => ({
    I18nContext: React.createContext({
        locale: "zh-CN",
        t: (key: string) => {
            const map: Record<string, string> = {
                "base.revoke.revokedMessage": "你撤回了一条消息",
                "base.revoke.you": "你",
                "base.revoke.reEdit": "重新编辑",
            }
            return map[key] ?? key
        },
    }),
    t: (key: string) => {
        const map: Record<string, string> = {
            "base.revoke.revokedMessage": "你撤回了一条消息",
            "base.revoke.you": "你",
        }
        return map[key] ?? key
    },
}))

import { RevokeCell, rebuildDraftText } from "../index"

function makeMessage(overrides: Record<string, any> = {}) {
    return {
        revoker: "user-self",
        fromUID: "user-self",
        contentType: 1,
        content: { text: "这是原始消息内容", contentType: 1 },
        from: null,
        remoteExtra: {},
        message: { remoteExtra: {} },
        ...overrides,
    }
}

function renderCell(message: any, contextOverrides: any = {}) {
    const ctx = {
        insertText: vi.fn(),
        restoreDraft: vi.fn(),
        ...contextOverrides,
    }
    // RevokeCell is a class component; render via renderToStaticMarkup
    return renderToStaticMarkup(
        React.createElement(RevokeCell as any, {
            message,
            context: ctx,
        })
    )
}

describe("RevokeCell — re-edit button", () => {
    it("shows re-edit button when self revoked own text message", () => {
        const html = renderCell(makeMessage())
        expect(html).toContain("重新编辑")
        expect(html).toContain("wk-revoke-reedit-btn")
    })

    it("does NOT show re-edit button when someone else revoked the message", () => {
        const html = renderCell(makeMessage({ revoker: "other-user" }))
        expect(html).not.toContain("重新编辑")
        expect(html).not.toContain("wk-revoke-reedit-btn")
    })

    it("does NOT show re-edit button for non-text messages (e.g. image)", () => {
        const html = renderCell(makeMessage({ contentType: 2 }))
        expect(html).not.toContain("重新编辑")
    })

    it("does NOT show re-edit button when revoker is self but sender is someone else (admin revoke)", () => {
        const html = renderCell(makeMessage({ fromUID: "other-user" }))
        expect(html).not.toContain("重新编辑")
    })

    it("always shows the revoke tip text", () => {
        const html = renderCell(makeMessage())
        expect(html).toContain("你撤回了一条消息")
    })
})

describe("RevokeCell — handleReEdit text resolution", () => {
    it("uses restoreDraft (not insertText) to preserve mention/emoji structure", () => {
        const restoreDraft = vi.fn()
        const insertText = vi.fn()
        const container = document.createElement("div")
        document.body.appendChild(container)
        const ctx = { restoreDraft, insertText }
        act(() => {
            ReactDOM.render(
                React.createElement(RevokeCell as any, { message: makeMessage(), context: ctx }),
                container
            )
        })
        const btn = container.querySelector(".wk-revoke-reedit-btn") as HTMLElement
        act(() => { btn.click() })
        expect(restoreDraft).toHaveBeenCalledWith("这是原始消息内容")
        expect(insertText).not.toHaveBeenCalled()
        ReactDOM.unmountComponentAtNode(container)
        container.remove()
    })

    it("isEdit=true: restores ORIGINAL text (not contentEdit) to keep text+entities consistent", () => {
        // contentEdit 不携带 entities，混用会导致 offset 错位。
        // 因此对于 isEdit 消息，恢复的是原始内容（不是编辑后的）
        const restoreDraft = vi.fn()
        const msg = makeMessage({
            content: { text: "原始内容", contentType: 1 },
            message: {
                remoteExtra: {
                    isEdit: true,
                    contentEdit: { text: "编辑后的内容", contentType: 1 },
                },
            },
        })
        const container = document.createElement("div")
        document.body.appendChild(container)
        act(() => {
            ReactDOM.render(
                React.createElement(RevokeCell as any, { message: msg, context: { restoreDraft } }),
                container
            )
        })
        act(() => { (container.querySelector(".wk-revoke-reedit-btn") as HTMLElement).click() })
        // 应返回原始内容，不是 contentEdit
        expect(restoreDraft).toHaveBeenCalledWith("原始内容")
        ReactDOM.unmountComponentAtNode(container)
        container.remove()
    })

    it("isEdit=true with mention: text and entities both from original content, no offset corruption", () => {
        const restoreDraft = vi.fn()
        const msg = makeMessage({
            content: {
                text: "hi @张三",
                contentType: 1,
                mention: { entities: [{ uid: "uid-zs", offset: 3, length: 3 }] },
            },
            message: {
                remoteExtra: {
                    isEdit: true,
                    contentEdit: { text: "编辑前缀 hi @张三", contentType: 1 },
                },
            },
        })
        const container = document.createElement("div")
        document.body.appendChild(container)
        act(() => {
            ReactDOM.render(
                React.createElement(RevokeCell as any, { message: msg, context: { restoreDraft } }),
                container
            )
        })
        act(() => { (container.querySelector(".wk-revoke-reedit-btn") as HTMLElement).click() })
        // text=="hi @张三", entities offset=3, label=text.slice(4,6)=="张三" => @[uid-zs:张三]
        expect(restoreDraft).toHaveBeenCalledWith("hi @[uid-zs:张三]")
        ReactDOM.unmountComponentAtNode(container)
        container.remove()
    })

    it("falls back to content.text when isEdit=false", () => {
        const restoreDraft = vi.fn()
        const msg = makeMessage({ message: { remoteExtra: { isEdit: false } } })
        const container = document.createElement("div")
        document.body.appendChild(container)
        act(() => {
            ReactDOM.render(
                React.createElement(RevokeCell as any, { message: msg, context: { restoreDraft } }),
                container
            )
        })
        act(() => { (container.querySelector(".wk-revoke-reedit-btn") as HTMLElement).click() })
        expect(restoreDraft).toHaveBeenCalledWith("这是原始消息内容")
        ReactDOM.unmountComponentAtNode(container)
        container.remove()
    })

    it("reads entities from contentObj.mention.entities when top-level mention.entities is absent", () => {
        // 模拟存在于 contentObj 路径的 entities（部分消息类型用这个格式存储）
        const restoreDraft = vi.fn()
        const msg = makeMessage({
            content: {
                text: "hi @张三",
                contentType: 1,
                // top-level mention.entities 不存在
                contentObj: {
                    mention: {
                        entities: [{ uid: "uid-zhangsan", offset: 3, length: 3 }],
                    },
                },
            },
        })
        const container = document.createElement("div")
        document.body.appendChild(container)
        act(() => {
            ReactDOM.render(
                React.createElement(RevokeCell as any, { message: msg, context: { restoreDraft } }),
                container
            )
        })
        act(() => { (container.querySelector(".wk-revoke-reedit-btn") as HTMLElement).click() })
        // entities 应该从 contentObj 路径读到，正确重建 @[uid:label]
        expect(restoreDraft).toHaveBeenCalledWith("hi @[uid-zhangsan:张三]")
        ReactDOM.unmountComponentAtNode(container)
        container.remove()
    })
})

describe("rebuildDraftText — mention entity reconstruction", () => {
    it("returns plain text unchanged when no entities", () => {
        expect(rebuildDraftText("hello world", [])).toBe("hello world")
    })

    it("reconstructs a single @mention entity as @[uid:label]", () => {
        // "hi @张三 你好"  entity: uid="uid-abc", offset=3, length=3
        const result = rebuildDraftText("hi @张三 你好", [
            { uid: "uid-abc", offset: 3, length: 3 },
        ])
        expect(result).toBe("hi @[uid-abc:张三] 你好")
    })

    it("handles multiple @mention entities in order", () => {
        // "@张三 和 @李四 在一起"  entities: 张三 at 0, 李四 at 6
        const result = rebuildDraftText("@张三 和 @李四 在一起", [
            { uid: "uid-1", offset: 0, length: 3 },
            { uid: "uid-2", offset: 6, length: 3 },
        ])
        expect(result).toBe("@[uid-1:张三] 和 @[uid-2:李四] 在一起")
    })

    it("sorts entities by offset before processing", () => {
        // same as above but entities passed in reverse order
        const result = rebuildDraftText("@张三 和 @李四 在一起", [
            { uid: "uid-2", offset: 6, length: 3 },
            { uid: "uid-1", offset: 0, length: 3 },
        ])
        expect(result).toBe("@[uid-1:张三] 和 @[uid-2:李四] 在一起")
    })
})

describe("RevokeCell — handleReEdit with mention.entities", () => {
    it("reconstructs mention nodes when recalled message has entities (defect B)", () => {
        const restoreDraft = vi.fn()
        // 发送的消息: text="hi @张三", entities: [{uid: "uid-zhangsan", offset: 3, length: 3}]
        const msg = makeMessage({
            content: {
                text: "hi @张三",
                contentType: 1,
                mention: {
                    entities: [{ uid: "uid-zhangsan", offset: 3, length: 3 }],
                },
            },
        })
        const container = document.createElement("div")
        document.body.appendChild(container)
        act(() => {
            ReactDOM.render(
                React.createElement(RevokeCell as any, { message: msg, context: { restoreDraft } }),
                container
            )
        })
        act(() => { (container.querySelector(".wk-revoke-reedit-btn") as HTMLElement).click() })
        // restoreDraft 必须收到 @[uid:label] 格式，而不是纯 "hi @张三"
        // 这样 parseDraftToContent 才能还原出 mention 节点，resend 时 uid 绑定不丢失
        expect(restoreDraft).toHaveBeenCalledWith("hi @[uid-zhangsan:张三]")
        expect(restoreDraft).not.toHaveBeenCalledWith("hi @张三")
        ReactDOM.unmountComponentAtNode(container)
        container.remove()
    })

    it("falls back to plain text when entities is empty (no mentions)", () => {
        const restoreDraft = vi.fn()
        const msg = makeMessage({
            content: {
                text: "普通消息无mention",
                contentType: 1,
                mention: { entities: [] },
            },
        })
        const container = document.createElement("div")
        document.body.appendChild(container)
        act(() => {
            ReactDOM.render(
                React.createElement(RevokeCell as any, { message: msg, context: { restoreDraft } }),
                container
            )
        })
        act(() => { (container.querySelector(".wk-revoke-reedit-btn") as HTMLElement).click() })
        expect(restoreDraft).toHaveBeenCalledWith("普通消息无mention")
        ReactDOM.unmountComponentAtNode(container)
        container.remove()
    })
})
