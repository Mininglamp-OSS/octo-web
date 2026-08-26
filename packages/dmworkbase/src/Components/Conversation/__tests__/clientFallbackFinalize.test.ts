// @vitest-environment jsdom

/**
 * WS-99 client-fallback race 闭环回归。
 *
 * 兜底逻辑：收到某 assistant 的 final text 后把它最近一张「未终态」progress 卡本地标记为
 * `localFallbackApplied`（渲染层显示「未收到显式终态」banner）。本 suite 覆盖评审 blocker/P2——
 * 当权威内容编辑帧（`updateMessageByMessageExtras` 的 contentEdit，无论终态还是非终态）随后到达
 * 时，卡片内容已前进、兜底注解失真，必须撤回该本地标记（终态帧走正常终态渲染；非终态帧说明卡片
 * 又活了，撤回后可由后续 final text + 空闲判定重新触发）；而只读扩展（read receipt，无 contentEdit）
 * 不改内容，不得误撤回、也不得刷新空闲判定。
 *
 * 与 malformedMessageRender.test 一样用 REAL SDK + REAL MessageWrap + REAL
 * InteractiveCardContent，只 mock 掉 ConversationVM 构造所需的重型 App/Service 单例。
 */

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
        emojiService: { getImage: () => undefined },
        conversationProvider: {
            markConversationUnread: () => Promise.resolve(),
            syncMessages: () => Promise.resolve([]),
        },
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

/** 建 VM，塞入一张卡 + 触发 final text 兜底，返回卡的 wrap（已 localFallbackApplied=true）。 */
function primeFallback(header = "🤖 正在处理…"): { vm: any; cardWrap: MessageWrap } {
    const vm: any = new ConversationVM(channel)
    const cardWrap = makeCardWrap(header)
    cardWrap.progressUpdatedAtSec = 0 // 远早于 now → 空闲足够
    vm.messages.push(cardWrap)
    vm.messagesOfOrigin.push(cardWrap)
    vm.maybeFinalizeStuckProgressCard(makeFinalTextWrap())
    return { vm, cardWrap }
}

/** 造一条 MessageExtra（终态编辑帧 / 只读扩展）。 */
function makeExtra(contentEdit?: InteractiveCardContent): MessageExtra {
    const extra = new MessageExtra()
    extra.messageID = "card-1"
    if (contentEdit) {
        extra.isEdit = true
        extra.contentEdit = contentEdit
    }
    return extra
}

afterEach(() => vi.clearAllMocks())

describe("WS-99 client fallback finalize race", () => {
    it("final text 到达后把未终态卡标记为兜底", () => {
        const { cardWrap } = primeFallback()
        expect(cardWrap.localFallbackApplied).toBe(true)
    })

    it("权威终态帧（✅ 已完成，agent_progress）到达后撤回兜底标记", () => {
        const { vm, cardWrap } = primeFallback()
        expect(cardWrap.localFallbackApplied).toBe(true)

        vm.updateMessageByMessageExtras([makeExtra(makeCardContent("✅ 已完成 · 3 步"))])
        expect(cardWrap.localFallbackApplied).toBe(false)
    })

    it("终态+回答合并帧（剥离了 layout metadata）到达后也撤回兜底标记", () => {
        const { vm, cardWrap } = primeFallback()
        vm.updateMessageByMessageExtras([
            makeExtra(makeCardContent("✅ 已完成", { layout: false })),
        ])
        expect(cardWrap.localFallbackApplied).toBe(false)
    })

    it("只读扩展（read receipt，无 contentEdit）不撤回兜底标记", () => {
        const { vm, cardWrap } = primeFallback()
        const readReceipt = makeExtra() // 无 contentEdit → 有效卡仍是原未终态卡
        readReceipt.readedCount = 3
        vm.updateMessageByMessageExtras([readReceipt])
        expect(cardWrap.localFallbackApplied).toBe(true)
    })

    it("非终态内容编辑帧（🤖 卡片又活了）到达后撤回兜底标记（P2-6）", () => {
        const { vm, cardWrap } = primeFallback()
        expect(cardWrap.localFallbackApplied).toBe(true)
        // 兜底后卡片又收到权威的非终态编辑帧：内容已前进，兜底注解失真，必须撤回，
        // 避免「内容在动却仍标注已兜底完成」的自相矛盾态。
        vm.updateMessageByMessageExtras([makeExtra(makeCardContent("🤖 处理中 · 第 2 步"))])
        expect(cardWrap.localFallbackApplied).toBe(false)
    })

    it("卡片又活了并再次卡住后，后续 final text 能重新触发兜底（P2-6 闭环）", () => {
        const { vm, cardWrap } = primeFallback()
        // 非终态编辑帧撤回兜底。
        vm.updateMessageByMessageExtras([makeExtra(makeCardContent("🤖 处理中 · 第 2 步"))])
        expect(cardWrap.localFallbackApplied).toBe(false)
        // 再次陷入卡死（把到达时刻推回过去），新的 final text 应重新触发兜底。
        cardWrap.progressUpdatedAtSec = 0
        vm.maybeFinalizeStuckProgressCard(makeFinalTextWrap())
        expect(cardWrap.localFallbackApplied).toBe(true)
    })

    it("卡片在 pendingMessages（历史加载期间实时到达）时 final text 兜底仍生效", () => {
        const vm: any = new ConversationVM(channel)
        const cardWrap = makeCardWrap("🤖 正在处理…")
        cardWrap.progressUpdatedAtSec = 0 // 远早于 now → 空闲足够
        // 模拟 pullupHasMore 期间：卡片进缓冲区而非 messagesOfOrigin，messagesOfOrigin 为空。
        vm.pendingMessages.push(cardWrap)
        vm.maybeFinalizeStuckProgressCard(makeFinalTextWrap())
        expect(cardWrap.localFallbackApplied).toBe(true)
    })

    it("只读扩展（read receipt）不刷新 progressUpdatedAtSec（空闲判定不被重置）", () => {
        const { vm, cardWrap } = primeFallback()
        // 兜底后收到只读扩展；stampProgressCardArrival 不应被调用，progressUpdatedAtSec 保持原值。
        const before = cardWrap.progressUpdatedAtSec
        const readReceipt = makeExtra() // 无 contentEdit
        readReceipt.readedCount = 5
        vm.updateMessageByMessageExtras([readReceipt])
        expect(cardWrap.progressUpdatedAtSec).toBe(before)
    })

    it("卡片内容编辑帧会刷新 progressUpdatedAtSec", () => {
        const { vm, cardWrap } = primeFallback()
        cardWrap.progressUpdatedAtSec = 0
        vm.updateMessageByMessageExtras([makeExtra(makeCardContent("🤖 处理中 · 第 2 步"))])
        expect(cardWrap.progressUpdatedAtSec).toBeGreaterThan(0)
    })
})
