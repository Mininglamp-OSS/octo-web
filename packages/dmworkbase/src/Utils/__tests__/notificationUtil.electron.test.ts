import { describe, it, expect, beforeEach, vi } from "vitest"
import { Channel, Message } from "wukongimjssdk"

/**
 * NotificationUtil 的 Electron 原生通知路径测试。
 *
 * 背景：桌面端收到新消息时由 module.tsx 的通知管线调用
 * notificationUtil.sendMessageNotification()；Electron 环境下应优先走
 * window.electronNotification.show()（主进程原生通知），并按会话隔离
 * tag、点击后跳转会话。非 Electron 环境保持 Web Notification 回退。
 */

const mocks = vi.hoisted(() => {
    return {
        showConversationCalls: [] as Channel[],
        channelInfo: undefined as any,
        muted: false,
    }
})

// NotificationUtil 通过 WKApp.endpoints.showConversation 跳转会话（真实 App 模块太重）
vi.mock("../../App", () => ({
    default: {
        endpoints: {
            showConversation: (channel: Channel) => {
                mocks.showConversationCalls.push(channel)
            },
        },
        shared: {
            avatarChannel: () => "",
        },
    },
}))

vi.mock("../../i18n", () => ({
    t: (key: string) => key,
}))

vi.mock("../../im-runtime/channelRuntime", () => ({
    getImChannelInfo: () => mocks.channelInfo,
    fetchImChannelInfo: vi.fn(),
}))

vi.mock("../../Service/Thread", () => ({
    isEffectivelyMuted: () => mocks.muted,
    parseThreadChannelId: () => undefined,
}))

import { notificationUtil } from "../NotificationUtil"

const ChannelTypePerson = 1
const ChannelTypeGroup = 2

class FakeWebNotification {
    static permission = "granted"
    static instances: FakeWebNotification[] = []
    onclick: any = null
    onshow: any = null
    onclose: any = null
    onerror: any = null
    constructor(public title: string, public options: any) {
        FakeWebNotification.instances.push(this)
    }
    close() {}
}

interface FakeElectronApi {
    show: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    closeAll: ReturnType<typeof vi.fn>
    onClicked: ReturnType<typeof vi.fn>
    onActionClicked: ReturnType<typeof vi.fn>
    clickHandler?: (data: any) => void
}

function installElectronApi(showResult: boolean | (() => boolean) = true): FakeElectronApi {
    const api: FakeElectronApi = {
        show: vi.fn(async (_options: any) =>
            typeof showResult === "function" ? showResult() : showResult
        ),
        close: vi.fn(async (_tag: string) => {}),
        closeAll: vi.fn(async () => {}),
        onClicked: vi.fn((callback: (data: any) => void) => {
            api.clickHandler = callback
            return () => {
                api.clickHandler = undefined
            }
        }),
        onActionClicked: vi.fn(),
    }
    ;(window as any).__POWERED_ELECTRON__ = true
    ;(window as any).electronNotification = api
    return api
}

function removeElectronApi() {
    delete (window as any).__POWERED_ELECTRON__
    delete (window as any).electronNotification
}

function makeMessage(options?: {
    channelId?: string
    channelType?: number
    fromUID?: string
}): Message {
    const message = new Message()
    message.channel = new Channel(
        options?.channelId ?? "alice",
        options?.channelType ?? ChannelTypePerson
    )
    message.fromUID = options?.fromUID ?? "alice"
    message.header.reddot = true
    message.header.noPersist = false
    return message
}

describe("NotificationUtil — Electron 原生消息通知", () => {
    beforeEach(() => {
        mocks.showConversationCalls = []
        mocks.channelInfo = { title: "Alice", orgData: { displayName: "Alice" } }
        mocks.muted = false
        FakeWebNotification.instances = []
        ;(window as any).Notification = FakeWebNotification
        // 单例跨用例共享：重置点击路由注册标记与残留通知，保证每个用例独立
        ;(notificationUtil as any).electronClickHandlerInstalled = false
        ;(notificationUtil as any).messageNotification = undefined
        ;(notificationUtil as any).messageNotificationTimeoutId = undefined
        removeElectronApi()
    })

    it("Electron 环境走原生 show：标题取 displayName，tag 按会话 channelKey 隔离", async () => {
        const api = installElectronApi()
        const message = makeMessage()

        await notificationUtil.sendMessageNotification(message, "你好")

        expect(api.show).toHaveBeenCalledTimes(1)
        const options = api.show.mock.calls[0][0]
        expect(options.title).toBe("Alice")
        expect(options.body).toBe("你好")
        expect(options.tag).toBe(`message-${message.channel.getChannelKey()}`)
        expect(options.fromUid).toBe("alice")
        expect(options.channel).toBe(message.channel)
        // 原生路径成功时不应再构造 Web Notification
        expect(FakeWebNotification.instances.length).toBe(0)
    })

    it("缺少 displayName 时标题回退到 i18n key（base.notification.title）", async () => {
        mocks.channelInfo = undefined
        const api = installElectronApi()

        await notificationUtil.sendMessageNotification(makeMessage(), "hi")

        expect(api.show.mock.calls[0][0].title).toBe("base.notification.title")
    })

    it("点击路由只注册一次，多次 show 不重复注册", async () => {
        const api = installElectronApi()

        await notificationUtil.sendMessageNotification(makeMessage({ channelId: "alice" }), "1")
        await notificationUtil.sendMessageNotification(makeMessage({ channelId: "bob" }), "2")
        await notificationUtil.sendMessageNotification(
            makeMessage({ channelId: "g-1", channelType: ChannelTypeGroup }),
            "3"
        )

        expect(api.onClicked).toHaveBeenCalledTimes(1)
        expect(api.show).toHaveBeenCalledTimes(3)
        // 三条消息来自三个会话，tag 各不相同
        const tags = api.show.mock.calls.map((call) => call[0].tag)
        expect(new Set(tags).size).toBe(3)
    })

    it("点击通知（主进程回传 channel）跳转到对应会话", async () => {
        const api = installElectronApi()
        await notificationUtil.sendMessageNotification(makeMessage(), "hi")
        expect(api.clickHandler).toBeDefined()

        // 主进程结构化克隆后 channel 只剩数据属性
        api.clickHandler!({ channel: { channelID: "g-1", channelType: ChannelTypeGroup } })

        expect(mocks.showConversationCalls.length).toBe(1)
        const target = mocks.showConversationCalls[0]
        expect(target.channelID).toBe("g-1")
        expect(target.channelType).toBe(ChannelTypeGroup)
    })

    it("channel 缺失时退化为从 tag 解析会话", async () => {
        const api = installElectronApi()
        await notificationUtil.sendMessageNotification(makeMessage(), "hi")

        api.clickHandler!({ tag: "message-alice-1" })

        expect(mocks.showConversationCalls.length).toBe(1)
        expect(mocks.showConversationCalls[0].channelID).toBe("alice")
        expect(mocks.showConversationCalls[0].channelType).toBe(ChannelTypePerson)
    })

    it("无法解析会话时点击不跳转", async () => {
        const api = installElectronApi()
        await notificationUtil.sendMessageNotification(makeMessage(), "hi")

        api.clickHandler!({ tag: "call" })

        expect(mocks.showConversationCalls.length).toBe(0)
    })

    it("免打扰会话不发原生通知", async () => {
        mocks.muted = true
        const api = installElectronApi()

        await notificationUtil.sendMessageNotification(makeMessage(), "hi")

        expect(api.show).not.toHaveBeenCalled()
    })

    it("reddot=false 的消息不发通知", async () => {
        const api = installElectronApi()
        const message = makeMessage()
        message.header.reddot = false

        await notificationUtil.sendMessageNotification(message, "hi")

        expect(api.show).not.toHaveBeenCalled()
    })

    it("原生 show 返回 false 时回退 Web Notification", async () => {
        installElectronApi(false)
        const message = makeMessage()

        await notificationUtil.sendMessageNotification(message, "hi")

        expect(FakeWebNotification.instances.length).toBe(1)
        expect(FakeWebNotification.instances[0].title).toBe("Alice")
        expect(FakeWebNotification.instances[0].options.body).toBe("hi")
    })

    it("原生 show 抛错时回退 Web Notification", async () => {
        const api = installElectronApi()
        // 持续失败：原生路径与 createNotification 内的原生重试都走回退
        api.show.mockRejectedValue(new Error("ipc broken"))

        await notificationUtil.sendMessageNotification(makeMessage(), "hi")

        expect(FakeWebNotification.instances.length).toBe(1)
    })

    it("非 Electron 环境走 Web Notification（tag 保持 message）", async () => {
        removeElectronApi()

        await notificationUtil.sendMessageNotification(makeMessage(), "hi")

        expect(FakeWebNotification.instances.length).toBe(1)
        expect(FakeWebNotification.instances[0].options.tag).toBe("message")
    })

    it("Web 路径点击通知跳转原会话", async () => {
        removeElectronApi()
        const message = makeMessage({ channelId: "bob" })

        await notificationUtil.sendMessageNotification(message, "hi")

        const notification = FakeWebNotification.instances[0]
        notification.onclick()
        expect(mocks.showConversationCalls.length).toBe(1)
        expect(mocks.showConversationCalls[0].channelID).toBe("bob")
    })
})
