// @vitest-environment jsdom

/** 普通消息不能替代执行终态；使用真实SDK/VM验证正文生成期间不提前完成。 */

import { afterEach, describe, it, expect, vi } from "vitest"
import {
    Channel,
    ChannelTypeGroup,
    Message,
    MessageExtra,
    MessageStatus,
    MessageText,
} from "wukongimjssdk"

// 重型 App/Service 单例（镜像 malformedMessageRender.test，去掉 wukongimjssdk /
// Service/Model 的 mock —— 这里要真实 SDK + 真实 MessageWrap）。
vi.mock("../../../App", () => ({
    default: {
        loginInfo: { uid: "me", realnameVerified: false },
        config: { pageSizeOfMessage: 30 },
        dataSource: { channelDataSource: { subscribers: () => Promise.resolve([]) } },
        mittBus: { on: () => {}, off: () => {} },
        endpointManager: { setMethod: () => {}, removeMethod: () => {} },
        emojiService: { getImage: () => undefined },
        conversationProvider: {
            markConversationUnread: () => Promise.resolve(),
            syncMessages: () => Promise.resolve([]),
        },
        apiClient: { config: { apiURL: "https://test.invalid/" } },
        shared: {
            currentSpaceId: "",
            notifyMessageDeleteListener: () => {},
            avatarUser: () => "",
        },
    },
}))
vi.mock("../../../Service/DataSource/DataProvider", () => ({ SyncMessageOptions: class {} }))
vi.mock("../../../Service/Provider", () => ({
    ProviderListener: class {
        callback?: Function
        notifyListener(done?: Function) { this.callback?.(); done?.() }
        listen(f: Function) { this.callback = f }
        clearListeners() { this.callback = undefined }
        didMount() {}
        didUnMount() {}
    },
}))
vi.mock("react-scroll", () => ({ animateScroll: { scrollToBottom: () => {} }, scroller: { scrollTo: () => {} } }))
vi.mock("../../../Messages/Time", () => ({ TimeContent: class {} }))
vi.mock("../../../Messages/HistorySplit", () => ({ HistorySplitContent: class {} }))
vi.mock("../../../Messages/Mergeforward", () => ({ default: class {} }))
vi.mock("../foldSessionSummary", () => ({ getFoldSessionExpandedMessages: () => [] }))
vi.mock("../historyScroll", () => ({
    getPulldownRestoredScrollTop: () => 0,
    getRestoredAnchorScrollTop: ({ anchorOffsetTop, keepOffsetY }: any) => anchorOffsetTop + keepOffsetY,
}))
vi.mock("../../../Service/Convert", () => ({ applyMsgLevelExternalFieldsWithFallback: () => {} }))
vi.mock("../../../Utils/sendContentProxy", () => ({ wrapSendContentForInjection: (content: any) => content }))
vi.mock("../../../Service/messageSelection", () => ({ isMessageSelectable: () => true }))
// i18n barrel 会 transitively 拉 lottie-web，在 jsdom（无 canvas）import 即崩；echo key 即可。
vi.mock("../../../i18n", () => ({
    t: (key: string) => key,
    useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock("../../../Service/ProhibitwordsService", () => ({
    ProhibitwordsService: {
        shared: { filter: (text: unknown) => (typeof text === "string" ? text : ""), getProhibitwords: () => [] },
    },
}))
// didMount 装配 messageListener 时会连带初始化频道信息/成员同步等无关运行时；mock 掉
// im-runtime 桥接，避免真实 SDK 的 provider 回调在异步链里抛未处理 rejection（与 ingest 无关）。
vi.mock("../../../im-runtime/channelRuntime", () => ({
    addImChannelInfoListener: () => () => {},
    addImSubscriberChangeListener: () => () => {},
    fetchImChannelInfo: () => Promise.resolve(undefined),
    getImChannelInfo: () => undefined,
    getImChannelSubscribers: () => [],
    notifyImSubscriberChangeListeners: () => {},
    setImChannelSubscribersCache: () => {},
    syncImChannelSubscribers: () => {},
}))
vi.mock("../../../im-runtime/connectStatus", () => ({
    addImConnectStatusListener: () => {},
    handleImReconnectRefresh: () => {},
    removeImConnectStatusListener: () => {},
}))

import ConversationVM from "../vm"
import { MessageWrap } from "../../../Service/Model"
import { InteractiveCardContent } from "../../../Messages/InteractiveCard/InteractiveCardContent"

const channel = new Channel("g1", ChannelTypeGroup)
const SENDER = "bot1"

/** 构造一张与 openclaw card-render 输出同形的 agent_progress 卡内容（header 决定终态）。 */
function makeCardContent(
    headerText: string,
    opts: { layout?: boolean } = {}
): InteractiveCardContent {
    const { layout = true } = opts
    const content = new InteractiveCardContent()
    const card: Record<string, unknown> = {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
            {
                type: "ColumnSet",
                columns: [
                    {
                        type: "Column",
                        width: "stretch",
                        items: [
                            { type: "RichTextBlock", inlines: [{ type: "TextRun", text: headerText }] },
                        ],
                    },
                ],
            },
            { type: "Container", id: "timeline_detail", items: [] },
        ],
    }
    if (layout) card.metadata = { octo_layout: "agent_progress_v1" }
    content.card = card
    return content
}

function makeCardWrap(headerText: string): MessageWrap {
    const message = new Message()
    message.messageID = "card-1"
    message.messageSeq = 1
    message.clientMsgNo = "card-1"
    message.timestamp = 100
    message.fromUID = SENDER
    message.channel = channel
    message.status = MessageStatus.Normal
    message.remoteExtra = new MessageExtra()
    message.content = makeCardContent(headerText)
    return new MessageWrap(message)
}

function makeFinalTextWrap(): MessageWrap {
    const message = new Message()
    message.messageID = "text-1"
    message.messageSeq = 2
    message.clientMsgNo = "text-1"
    message.timestamp = 200
    message.fromUID = SENDER
    message.channel = channel
    message.status = MessageStatus.Normal
    message.remoteExtra = new MessageExtra()
    message.content = new MessageText("任务战报：全部完成")
    return new MessageWrap(message)
}

/**
 * 造一条 `content` 为非字符串的 type=1 消息（raw Message，用于跑真实 listener 路径）。
 * 模拟 SDK `MessageText.decodeJSON` 未校验 `content["content"]` 类型时的畸形 payload：
 * 服务端下发 number/object/array，`text` 非字符串却 truthy。
 */
function makeNonStringTextMessage(rawText: unknown): Message {
    const message = new Message()
    message.messageID = "bad-text-1"
    message.messageSeq = 3
    message.clientMsgNo = "bad-text-1"
    message.timestamp = 300
    message.fromUID = SENDER
    message.channel = channel
    message.status = MessageStatus.Normal
    message.remoteExtra = new MessageExtra()
    const content = new MessageText("placeholder")
    // 绕过构造器类型：模拟 decodeJSON 把 content["content"] 直接赋给 text。
    ;(content as unknown as { text: unknown }).text = rawText
    message.content = content
    return message
}

function makeExtra(contentEdit?: InteractiveCardContent): MessageExtra {
    const extra = new MessageExtra()
    extra.messageID = "card-1"
    if (contentEdit) { extra.isEdit = true; extra.contentEdit = contentEdit }
    return extra
}

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe("卡片只跟随权威终态，不从普通消息推断完成", () => {
    for (const text of ["已提交本次响应。", "会话已经重置", "当前智能体繁忙，请稍后再试", "正在整理结果", "另一轮任务已经完成"]) {
        it(`最终正文仍在生成时，普通消息「${text}」不会提前完成卡片`, () => {
            vi.useFakeTimers()
            const vm = new ConversationVM(channel)
            vm.didMount()
            try {
                const card = makeCardWrap("🤖 正在整理结果")
                card.progressUpdatedAtSec = 0
                vm.messages.push(card)
                vm.messagesOfOrigin.push(card)
                const ordinary = makeFinalTextWrap().message
                ordinary.content = new MessageText(text)
                vm.messageListener(ordinary)
                vi.advanceTimersByTime(30_000)
                expect(card.localFallbackApplied).toBeFalsy()
                expect(vm.messagesOfOrigin.some(message => message.clientMsgNo === ordinary.clientMsgNo)).toBe(true)
                expect(card.message.remoteExtra?.isEdit).toBeFalsy()
            } finally { vm.didUnMount() }
        })
    }

    it("普通正文到达后仍等待显式终态，权威完成帧随后正常应用", () => {
        vi.useFakeTimers()
        const vm = new ConversationVM(channel)
        vm.didMount()
        try {
            const card = makeCardWrap("🤖 正在生成最终回复")
            vm.messages.push(card)
            vm.messagesOfOrigin.push(card)
            vm.messageListener(makeFinalTextWrap().message)
            vi.advanceTimersByTime(30_000)
            expect(card.localFallbackApplied).toBeFalsy()
            const terminal = makeCardContent("✅ 已完成 · 3 步")
            vm.updateMessageByMessageExtras([makeExtra(terminal)])
            expect(card.message.remoteExtra.contentEdit).toBe(terminal)
            expect(card.localFallbackApplied).toBeFalsy()
        } finally { vm.didUnMount() }
    })

    it("历史加载缓冲区里的卡片也只由权威内容编辑推进", () => {
        const vm = new ConversationVM(channel)
        const card = makeCardWrap("🤖 正在处理…")
        vm.pendingMessages.push(card)
        const progress = makeCardContent("🤖 正在生成最终回复")
        vm.updateMessageByMessageExtras([makeExtra(progress)])
        expect(card.message.remoteExtra.contentEdit).toBe(progress)
        expect(card.localFallbackApplied).toBeFalsy()
        const completed = makeCardContent("✅ 已完成", { layout: false })
        vm.updateMessageByMessageExtras([makeExtra(completed)])
        expect(card.message.remoteExtra.contentEdit).toBe(completed)
    })

    it("只读扩展不把进行中的卡片改为完成", () => {
        const vm = new ConversationVM(channel)
        const card = makeCardWrap("🤖 正在生成最终回复")
        vm.messagesOfOrigin.push(card)
        const receipt = makeExtra()
        receipt.readedCount = 3
        vm.updateMessageByMessageExtras([receipt])
        expect(card.localFallbackApplied).toBeFalsy()
        expect(card.message.remoteExtra.contentEdit).toBeUndefined()
    })

    it("权威编辑帧撤销遗留的本地完成标记", () => {
        const vm = new ConversationVM(channel)
        const card = makeCardWrap("🤖 正在处理…")
        card.localFallbackApplied = true
        vm.messagesOfOrigin.push(card)
        vm.updateMessageByMessageExtras([makeExtra(makeCardContent("🤖 正在生成最终回复"))])
        expect(card.localFallbackApplied).toBe(false)
    })

    for (const value of [123, { nested: "obj" }]) {
        it(`畸形普通文本不会中断真实消息接收：${typeof value}`, () => {
            const vm = new ConversationVM(channel)
            vm.didMount()
            try {
                const message = makeNonStringTextMessage(value)
                expect(() => vm.messageListener(message)).not.toThrow()
                expect(vm.messagesOfOrigin.some(item => item.clientMsgNo === "bad-text-1")).toBe(true)
            } finally { vm.didUnMount() }
        })
    }
})
