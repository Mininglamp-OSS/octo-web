// @vitest-environment jsdom
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
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

import { RevokeCell } from "../index"

function makeMessage(overrides: Record<string, any> = {}) {
    return {
        revoker: "user-self",
        fromUID: "user-self",
        contentType: 1, // MessageContentType.text
        content: { text: "这是原始消息内容", contentType: 1 },
        from: null,
        remoteExtra: {},
        ...overrides,
    }
}

function renderCell(message: any, contextOverrides: any = {}) {
    const ctx = {
        insertText: vi.fn(),
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
        const html = renderCell(makeMessage({ contentType: 2 })) // image
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
