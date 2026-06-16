import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * bridge 层群入站 Webhook 渲染分支单测。
 *
 * 背景：
 *   getMessageRow 在最前面有一条 webhook 早返回分支：FromUID=iwh_* 的消息
 *   不走群成员 / Person channelInfo 解析（必落空），改读 payload.from 的
 *   name/avatar，并强制 isWebhook=true、isBot/isExternal/isRealnameVerified=false。
 *
 *   这些是渲染层最易回归的点（头像裂、把 iwh_* uid 暴露到 UI、徽章丢失、
 *   连续消息 showAvatar）。与 useMessageRow.realname.test.ts 同款 mock，
 *   把 webhook 分支钉死。
 *
 *   安全（信任边界）：webhook 身份以服务端权威信号 iwh_* UID 前缀为前置门控，
 *   非 iwh_ 发送者即便 payload.from.kind=webhook 也不得渲染成 webhook（防伪造）。
 */

const mockState = vi.hoisted(() => ({
    subscribesByChannel: new Map<string, any[]>(),
    channelInfoByUID: new Map<string, any>(),
    currentSpaceId: "",
    loginInfoUid: "",
}))

vi.mock("../../../App", () => ({
    default: {
        shared: {
            get currentSpaceId() {
                return mockState.currentSpaceId
            },
            avatarUser: (uid: string) => `avatar://${uid}`,
        },
        loginInfo: {
            get uid() {
                return mockState.loginInfoUid
            },
            selfDisplayName() {
                return ""
            },
        },
    },
}))

vi.mock("wukongimjssdk", async () => {
    const actual: any = await vi.importActual("wukongimjssdk")
    const sharedStub = {
        channelManager: {
            getChannelInfo: (ch: any) =>
                mockState.channelInfoByUID.get(ch.channelID),
            getSubscribes: (ch: any) =>
                mockState.subscribesByChannel.get(ch.channelID) || [],
        },
    }
    const stub = { shared: () => sharedStub }
    return { ...actual, default: stub, WKSDK: stub }
})

import { getMessageRow } from "../useMessageRow"
import { Channel, ChannelTypeGroup } from "wukongimjssdk"

function makeWebhookMessage(opts: {
    fromUID: string
    groupID: string
    from?: Record<string, unknown>
    preMessage?: any
}): any {
    const channel = new Channel(opts.groupID, ChannelTypeGroup)
    return {
        send: false,
        fromUID: opts.fromUID,
        channel,
        preMessage: opts.preMessage,
        timestamp: 1715000000,
        revoke: false,
        // MessageWrap.content getter 透传 message.content；这里直接给平铺对象。
        content: opts.from ? { contentObj: { from: opts.from } } : { contentObj: {} },
        message: { remoteExtra: {} },
        fromHomeSpaceId: undefined,
        fromHomeSpaceName: undefined,
        fromIsExternal: false,
        fromSourceSpaceName: undefined,
    }
}

describe("getMessageRow — webhook branch", () => {
    beforeEach(() => {
        mockState.subscribesByChannel.clear()
        mockState.channelInfoByUID.clear()
        mockState.currentSpaceId = ""
        mockState.loginInfoUid = ""
    })

    it("(a) payload.from 带 name/avatar → senderName/avatarUrl 取 payload 值、isWebhook=true、isBot=false", () => {
        const row = getMessageRow(
            makeWebhookMessage({
                fromUID: "iwh_abc",
                groupID: "g_hook",
                from: {
                    kind: "webhook",
                    name: "CI Bot",
                    avatar: "https://a/b.png",
                },
            })
        )
        expect(row.isWebhook).toBe(true)
        expect(row.senderName).toBe("CI Bot")
        expect(row.avatarUrl).toBe("https://a/b.png")
        expect(row.isBot).toBe(false)
        expect(row.isExternal).toBe(false)
        expect(row.isRealnameVerified).toBe(false)
        expect(row.showAvatar).toBe(true)
    })

    it("(b) payload.from 缺失但 fromUID=iwh_* → 头像走用户头像链路、senderName='' 不暴露 iwh_*", () => {
        const row = getMessageRow(
            makeWebhookMessage({ fromUID: "iwh_xyz", groupID: "g_hook" })
        )
        expect(row.isWebhook).toBe(true)
        // 无 payload 自定义头像 → 走与普通用户同源的 avatarUser(uid)，不再用前端链条 SVG 兜底
        expect(row.avatarUrl).toBe("avatar://iwh_xyz")
        // 展示名为空串，绝不把 iwh_* uid 当成名字泄漏到 UI
        expect(row.senderName).toBe("")
        expect(row.senderName).not.toContain("iwh_")
    })

    it("(c) isContinue=true（连续消息）时 showAvatar=false", () => {
        const preMessage = makeWebhookMessage({
            fromUID: "iwh_abc",
            groupID: "g_hook",
            from: { kind: "webhook", name: "CI Bot" },
        })
        // 紧邻同发送者的连续消息：时间戳贴近上一条
        const row = getMessageRow(
            makeWebhookMessage({
                fromUID: "iwh_abc",
                groupID: "g_hook",
                from: { kind: "webhook", name: "CI Bot" },
                preMessage,
            })
        )
        expect(row.isWebhook).toBe(true)
        expect(row.showAvatar).toBe(false)
        expect(row.isContinue).toBe(true)
    })

    it("身份伪造防御：非 iwh_ 发送者即便 payload.from.kind=webhook 也不渲染成 webhook", () => {
        // 普通成员伪造 from.kind=webhook，必须走普通渲染分支（isWebhook 不为 true）
        mockState.subscribesByChannel.set("g_spoof", [
            { uid: "8e5efc4f", name: "Attacker", orgData: {} },
        ])
        const row = getMessageRow(
            makeWebhookMessage({
                fromUID: "8e5efc4f",
                groupID: "g_spoof",
                from: {
                    kind: "webhook",
                    name: "System Admin",
                    avatar: "https://evil/a.png",
                },
            })
        )
        expect(row.isWebhook).not.toBe(true)
        expect(row.senderName).not.toBe("System Admin")
        expect(row.avatarUrl).not.toBe("https://evil/a.png")
    })
})
