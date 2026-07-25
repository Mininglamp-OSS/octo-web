import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("wukongimjssdk", () => ({
    Channel: class {
        channelID: string
        channelType: number
        constructor(id: string, type: number) {
            this.channelID = id
            this.channelType = type
        }
        isEqual(other: any) {
            return this.channelID === other.channelID && this.channelType === other.channelType
        }
        getChannelKey() {
            return `${this.channelID}-${this.channelType}`
        }
    },
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
    ChannelTypeCommunityTopic: 6,
    WKSDK: { shared: () => ({ channelManager: { getSubscribes: () => [], addSubscriberChangeListener: () => {}, removeSubscriberChangeListener: () => {}, syncSubscribes: () => Promise.resolve(), subscribeCacheMap: new Map(), notifySubscribeChangeListeners: () => {} }, conversationManager: { findConversation: () => null } }) },
    ConversationAction: {},
    Message: class {},
    MessageContent: class {},
    MessageStatus: {},
    Subscriber: class {},
    Conversation: class {},
    MessageExtra: class {},
    CMDContent: class {},
    PullMode: {},
    MessageContentType: {},
    ChannelInfo: class {},
    ChannelInfoListener: class {},
    ConversationListener: class {},
    MessageListener: class {},
    MessageStatusListener: class {},
    SendackPacket: class {},
    Setting: class {},
    SystemContent: class {},
}))

vi.mock("../../../App", () => ({
    default: {
        loginInfo: { uid: "me" },
        dataSource: { channelDataSource: { subscribers: () => Promise.resolve([]) } },
        mittBus: { on: () => {}, off: () => {} },
    },
}))

vi.mock("../../../Service/DataSource/DataProvider", () => ({}))
vi.mock("../../../Service/Model", () => ({ MessageWrap: class {} }))
vi.mock("../../../Service/Provider", () => ({
    ProviderListener: class {
        callback?: Function
        notifyListener() { this.callback?.() }
        listen(f: Function) { this.callback = f }
        clearListeners() { this.callback = undefined }
        didMount() {}
        didUnMount() {}
    },
}))
vi.mock("react-scroll", () => ({ animateScroll: {}, scroller: {} }))
vi.mock("../../../Service/Const", () => ({
    EndpointID: {},
    MessageContentTypeConst: {},
    OrderFactor: {},
    ChannelTypeCommunityTopic: 6,
}))
vi.mock("moment", () => ({ default: () => ({ format: () => "" }) }))
vi.mock("../../../Messages/Time", () => ({ TimeContent: class {} }))
vi.mock("../../../Messages/HistorySplit", () => ({ HistorySplitContent: class {} }))
vi.mock("../../../Messages/Mergeforward", () => ({ default: class {} }))
vi.mock("../../../Service/TypingManager", () => ({ TypingListener: class {}, TypingManager: { shared: { addTypingListener: () => {}, removeTypingListener: () => {} } } }))
vi.mock("../../../Service/ProhibitwordsService", () => ({ ProhibitwordsService: { shared: { getProhibitwords: () => [] } } }))
vi.mock("../../../Service/SpaceService", () => ({ SYSTEM_BOTS: [] }))
vi.mock("../../../Utils/const", () => ({ SuperGroup: 1 }))
vi.mock("../foldSessionSummary", () => ({ getFoldSessionExpandedMessages: () => [] }))
vi.mock("../historyScroll", () => ({ getPulldownRestoredScrollTop: () => 0 }))
vi.mock("../../../Service/Convert", () => ({ applyMsgLevelExternalFieldsWithFallback: () => {} }))
vi.mock("../../../i18n", () => ({
    t: (key: string) => key,
    useI18n: () => ({ t: (key: string) => key }),
}))

import ConversationVM from "../vm"
import { Channel } from "wukongimjssdk"

describe("ConversationVM.ensureSubscribersLoaded", () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("resolves immediately when subscribers are already loaded", async () => {
        const channel = new Channel("group1", 2)
        const vm = new ConversationVM(channel)
        vm.subscribers = [{ uid: "user1" }] as any

        const start = Date.now()
        await vm.ensureSubscribersLoaded()
        expect(Date.now() - start).toBeLessThan(100)
    })

    it("resolves immediately for 1-1 chats (ChannelTypePerson)", async () => {
        const channel = new Channel("person1", 1)
        const vm = new ConversationVM(channel)

        const start = Date.now()
        await vm.ensureSubscribersLoaded()
        expect(Date.now() - start).toBeLessThan(100)
    })

    it("waits for subscribersReady to resolve when subscribers are empty", async () => {
        const channel = new Channel("group1", 2)
        const vm = new ConversationVM(channel)

        let resolved = false
        const promise = vm.ensureSubscribersLoaded().then(() => { resolved = true })

        expect(resolved).toBe(false)

        // Simulate subscribers being loaded (trigger resolve via reloadSubscribers)
        ;(vm as any)._resolveSubscribersReady()

        await promise
        expect(resolved).toBe(true)
    })

    it("times out and returns after timeoutMs when subscribers never arrive", async () => {
        const channel = new Channel("group1", 2)
        const vm = new ConversationVM(channel)

        let resolved = false
        const promise = vm.ensureSubscribersLoaded(500).then(() => { resolved = true })

        expect(resolved).toBe(false)

        vi.advanceTimersByTime(499)
        await Promise.resolve()
        expect(resolved).toBe(false)

        vi.advanceTimersByTime(1)
        await Promise.resolve()
        await promise
        expect(resolved).toBe(true)
    })

    it("uses default timeout of 3000ms", async () => {
        const channel = new Channel("group1", 2)
        const vm = new ConversationVM(channel)

        let resolved = false
        const promise = vm.ensureSubscribersLoaded().then(() => { resolved = true })

        vi.advanceTimersByTime(2999)
        await Promise.resolve()
        expect(resolved).toBe(false)

        vi.advanceTimersByTime(1)
        await Promise.resolve()
        await promise
        expect(resolved).toBe(true)
    })

    it("resolves only once even if _resolveSubscribersReady is called multiple times", async () => {
        const channel = new Channel("group1", 2)
        const vm = new ConversationVM(channel)

        ;(vm as any)._resolveSubscribersReady()
        ;(vm as any)._resolveSubscribersReady()

        await vm.ensureSubscribersLoaded()
        expect((vm as any)._subscribersResolved).toBe(true)
    })
})
