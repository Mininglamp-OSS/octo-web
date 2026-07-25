// @vitest-environment jsdom

/**
 * #465 render-layer regression coverage.
 *
 * Unlike messageOrder.test.ts (which mocks both `wukongimjssdk` and
 * `Service/Model`), this suite uses the REAL SDK and the REAL `MessageWrap`,
 * so the SDK getters that actually crash the conversation render are exercised
 * faithfully:
 *   - `Message.contentType` getter derefs `this.content.contentType`
 *   - `MessageWrap.flame` getter derefs `this.message.content.contentObj`
 *   - `MessageWrap.parts` → `parseMention` derefs `this.content.contentType`
 *
 * A malformed message (payload.type === text but content failed to decode →
 * `message.content === undefined`) makes every one of those throw. The fix
 * normalizes such messages to an empty `MessageText` at a single point in
 * `ConversationVM.refreshMessages`, before any contentType read, so the
 * malformed bubble renders as empty instead of taking down the whole list.
 */

import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { afterEach, describe, it, expect, vi } from "vitest"
import {
    Channel,
    ChannelTypeGroup,
    Message,
    MessageStatus,
    MessageText,
    MessageContentType,
} from "wukongimjssdk"

// Heavy app/service singletons that ConversationVM and the real MessageWrap
// pull in. Mirrors messageOrder.test.ts, minus the `wukongimjssdk` and
// `Service/Model` mocks (we want the real SDK + real MessageWrap here).
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
// The i18n barrel transitively pulls in lottie-web, which crashes on import
// under jsdom (no canvas). Stub it the same way MessageRow.test / MarkdownContent
// tests do — the render path here only needs `t` to echo keys back.
vi.mock("../../../i18n", () => ({
    t: (key: string) => key,
    useI18n: () => ({ t: (key: string) => key }),
}))
// ProhibitwordsService.filter is invoked on the normalized text; keep it faithful
// to the production behaviour (empty stays empty).
vi.mock("../../../Service/ProhibitwordsService", () => ({
    ProhibitwordsService: {
        shared: { filter: (text: unknown) => (typeof text === "string" ? text : ""), getProhibitwords: () => [] },
    },
}))

import ConversationVM from "../vm"
import { MessageWrap, PartType } from "../../../Service/Model"
import { getTextMessageUI } from "../../../bridge/message/useTextMessageUI"

const channel = new Channel("g1", ChannelTypeGroup)

let container: HTMLDivElement | null = null

afterEach(() => {
    if (!container) return
    ReactDOM.unmountComponentAtNode(container)
    container.remove()
    container = null
})

// A real SDK Message whose content failed to decode: `new Message()` without a
// recvPacket leaves `content` undefined, matching a group text message whose
// payload was malformed (#465).
function buildMalformedWrap(): MessageWrap {
    const message = new Message()
    message.messageID = "m-malformed"
    message.messageSeq = 1
    message.clientMsgNo = "malformed"
    message.timestamp = 100
    message.fromUID = "u1"
    message.channel = channel
    message.status = MessageStatus.Normal
    // message.content intentionally left undefined
    return new MessageWrap(message)
}

describe("#465 malformed message — real SDK render-layer getters", () => {
    it("raw malformed wrap crashes on the very getters the render layer reads", () => {
        const wrap = buildMalformedWrap()
        // These are the exact deref sites that take down the conversation list.
        expect(() => wrap.contentType).toThrow()
        expect(() => wrap.flame).toThrow()
        expect(() => wrap.parts).toThrow()
    })

    it("ConversationVM.refreshMessages normalizes it so the getters are safe", () => {
        const vm = new ConversationVM(channel)
        const wrap = buildMalformedWrap()

        // Pre-fix this throws inside the sort/dedup pass (Message.contentType
        // derefs undefined content); post-fix the single-point normalization
        // runs first and refreshMessages completes.
        expect(() => vm.refreshMessages([wrap])).not.toThrow()

        // Same wrap, now normalized in place to an empty text message.
        expect(wrap.content).toBeInstanceOf(MessageText)
        expect(wrap.contentType).toBe(MessageContentType.text)
        expect(wrap.flame).toBe(false)
        expect(wrap.parts.map((p) => p.text).join("")).toBe("")
        expect(wrap.parts.every((p) => p.type === PartType.text)).toBe(true)
    })
})

describe("#465 malformed message — render path", () => {
    it("getTextMessageUI yields empty content for a normalized malformed message", () => {
        const vm = new ConversationVM(channel)
        const wrap = buildMalformedWrap()

        vm.refreshMessages([wrap])

        const ui = getTextMessageUI(wrap)
        expect(ui.content.content).toBe("")
        expect(ui.content.mentions).toEqual([])
        expect(ui.content.emojis).toEqual([])
    })

    it("rendering the text cell for a normalized malformed message does not throw", () => {
        const vm = new ConversationVM(channel)
        const wrap = buildMalformedWrap()
        vm.refreshMessages([wrap])

        const TextCell: React.FC<{ message: MessageWrap }> = ({ message }) => {
            const ui = getTextMessageUI(message)
            return <span data-testid="text-cell">{ui.content.content}</span>
        }

        container = document.createElement("div")
        document.body.appendChild(container)
        expect(() => {
            act(() => {
                ReactDOM.render(<TextCell message={wrap} />, container)
            })
        }).not.toThrow()

        const cell = container.querySelector('[data-testid="text-cell"]')
        expect(cell).not.toBeNull()
        expect(cell?.textContent).toBe("")
    })
})
