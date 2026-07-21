import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Spy handles captured from the SDK mock so tests can assert which member-load
// path resyncSubscribers took (super-group → first-page API vs normal group →
// syncSubscribes) and inspect channel-info lookups.
const syncSubscribes = vi.fn(() => Promise.resolve())
const getSubscribes = vi.fn(() => [] as any[])
const notifySubscribeChangeListeners = vi.fn()
const dataSourceSubscribers = vi.fn(() => Promise.resolve([{ uid: "first-page" }]))
// parent channel-info lookup for the community-topic branch; overridden per test
let getChannelInfoImpl: (ch: any) => any = () => undefined

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
    WKSDK: {
        shared: () => ({
            channelManager: {
                getSubscribes,
                addSubscriberChangeListener: () => {},
                removeSubscriberChangeListener: () => {},
                syncSubscribes,
                subscribeCacheMap: new Map(),
                notifySubscribeChangeListeners,
                getChannelInfo: (ch: any) => getChannelInfoImpl(ch),
            },
            conversationManager: { findConversation: () => null },
        }),
    },
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
        dataSource: { channelDataSource: { subscribers: (...args: any[]) => dataSourceSubscribers(...args) } },
        mittBus: { on: () => {}, off: () => {}, emit: () => {} },
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

describe("ConversationVM.resyncSubscribers — branch selection", () => {
    beforeEach(() => {
        syncSubscribes.mockClear()
        getSubscribes.mockClear()
        notifySubscribeChangeListeners.mockClear()
        dataSourceSubscribers.mockClear()
        getChannelInfoImpl = () => undefined
    })

    it("normal group → full server sync (syncSubscribes), not first-page API", async () => {
        const vm = new ConversationVM(new Channel("group1", 2))
        ;(vm as any).channelInfo = { orgData: { group_type: 0 } } // not SuperGroup

        await vm.resyncSubscribers()

        expect(syncSubscribes).toHaveBeenCalledTimes(1)
        expect(dataSourceSubscribers).not.toHaveBeenCalled()
    })

    it("super group → first-page API only, never full syncSubscribes", async () => {
        const vm = new ConversationVM(new Channel("supergroup1", 2))
        ;(vm as any).channelInfo = { orgData: { group_type: 1 } } // SuperGroup

        await vm.resyncSubscribers()

        expect(dataSourceSubscribers).toHaveBeenCalledTimes(1)
        expect(dataSourceSubscribers).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ limit: 100, page: 1 }),
        )
        expect(syncSubscribes).not.toHaveBeenCalled()
    })

    it("community-topic with SUPER-GROUP parent → first-page API only (mirrors entry-load, octo-web#568)", async () => {
        const vm = new ConversationVM(new Channel("topic1", 6))
        ;(vm as any).channelInfo = { orgData: { parentGroupNo: "parentSuper" } }
        // parent is a super group
        getChannelInfoImpl = (ch: any) =>
            ch.channelID === "parentSuper" ? { orgData: { group_type: 1 } } : undefined

        await vm.resyncSubscribers()

        // must paginate the super-group parent, NOT full-sync it
        expect(dataSourceSubscribers).toHaveBeenCalledTimes(1)
        expect(dataSourceSubscribers).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ limit: 100, page: 1 }),
        )
        expect(syncSubscribes).not.toHaveBeenCalled()
    })

    it("community-topic with NORMAL parent → full syncSubscribes", async () => {
        const vm = new ConversationVM(new Channel("topic2", 6))
        ;(vm as any).channelInfo = { orgData: { parentGroupNo: "parentNormal" } }
        getChannelInfoImpl = (ch: any) =>
            ch.channelID === "parentNormal" ? { orgData: { group_type: 0 } } : undefined

        await vm.resyncSubscribers()

        expect(syncSubscribes).toHaveBeenCalledTimes(1)
        expect(dataSourceSubscribers).not.toHaveBeenCalled()
    })

    it("1-1 (ChannelTypePerson) → no member load at all", async () => {
        const vm = new ConversationVM(new Channel("person1", 1))
        ;(vm as any).channelInfo = { orgData: {} }

        await vm.resyncSubscribers()

        expect(syncSubscribes).not.toHaveBeenCalled()
        expect(dataSourceSubscribers).not.toHaveBeenCalled()
    })
})

describe("ConversationVM.resyncSubscribers — independent throttle (octo-web#568)", () => {
    beforeEach(() => {
        syncSubscribes.mockClear()
        dataSourceSubscribers.mockClear()
        getChannelInfoImpl = () => undefined
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it("member resync does NOT touch the reconnect message-refresh throttle (lastReconnectRefreshAt)", async () => {
        const vm = new ConversationVM(new Channel("group1", 2))
        ;(vm as any).channelInfo = { orgData: { group_type: 0 } }

        // Simulate a foreground event driving member resync.
        await (vm as any)._foregroundResyncHandler()

        // The foreground path must NOT have bumped the reconnect message-refresh
        // timestamp; otherwise a reconnect within 5s would skip requestMessagesOfFirstPage.
        expect((vm as any).lastReconnectRefreshAt).toBe(0)
        // It does use its own member-resync throttle.
        expect((vm as any).lastSubscriberResyncAt).toBeGreaterThan(0)
    })

    it("throttles repeated member resyncs within 5s via its own timestamp", async () => {
        const vm = new ConversationVM(new Channel("group1", 2))
        ;(vm as any).channelInfo = { orgData: { group_type: 0 } }

        await vm.resyncSubscribers()
        expect(syncSubscribes).toHaveBeenCalledTimes(1)

        // second call immediately after → throttled
        await vm.resyncSubscribers()
        expect(syncSubscribes).toHaveBeenCalledTimes(1)

        // after 5s window → runs again
        vi.advanceTimersByTime(5001)
        await vm.resyncSubscribers()
        expect(syncSubscribes).toHaveBeenCalledTimes(2)
    })
})
