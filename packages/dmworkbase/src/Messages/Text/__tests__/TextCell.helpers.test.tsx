// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
const app = vi.hoisted(() => ({ shared: { currentSpaceId: "space" }, emojiService: { getImage: vi.fn((x: string) => x === ":smile:" ? "/smile.png" : ""), isCustomEmoji: vi.fn(() => false) } }))
vi.mock("../../../App", () => ({ default: app }))
vi.mock("../../MessageCell", () => ({ MessageCell: class { props: any; constructor(props: any) { this.props = props } } }))
vi.mock("../../Base", () => ({ default: () => null }))
vi.mock("../../Base/head", () => ({ default: () => null }))
vi.mock("../../Base/tail", () => ({ default: () => null }))
vi.mock("../MarkdownContent", () => ({ default: (p: any) => <span>{p.content}</span> }))
vi.mock("../../../ui/message/MessageRow", () => ({ default: (p: any) => <div>{p.children}</div> }))
vi.mock("../../../ui/message/ReplyBlock", () => ({ default: () => null }))
vi.mock("../../../ui/message/TextContent", () => ({ default: () => null }))
vi.mock("../../../features/messageReaction/ReactionSlot", () => ({ default: () => null }))
vi.mock("../../../bridge/message/useTextMessageUI", () => ({ getTextMessageUI: () => ({ row: {} }) }))
vi.mock("../../../Service/messageSelection", () => ({ isMessageSelectable: () => false }))
vi.mock("../../../Utils/externalViewer", () => ({ resolveExternalForViewer: () => ({ isExternal: false, sourceSpaceName: "" }) }))
vi.mock("../../../bridge/message/webhookPreview", () => ({ fleetPreviewClickHandler: () => vi.fn() }))
vi.mock("../../../features/messageReaction/controller", () => ({ isMessageReactionChannelSupported: () => false }))

import { TextCell } from "../index"

describe("TextCell helper rendering", () => {
  it("renders common, mention, emoji, safe/unsafe links and markdown content", () => {
    const showUser = vi.fn()
    const cell: any = new TextCell({ message: { clientMsgNo: "m", send: false, parts: [] }, context: { showUser, editOn: () => false } })
    const part: any = { text: "hello\nworld", type: 1 }
    expect(cell.getCommonText(0, part)).toBeTruthy()
    const mention: any = { text: "@Alice", data: { uid: "u1" } }
    const mentionNode: any = cell.getMentionText(0, mention); mentionNode.props.onClick(); expect(showUser).toHaveBeenCalledWith("u1")
    expect(cell.getEmojiText(0, { text: ":smile:" } as any)).toBeTruthy()
    expect(cell.getLinkText(0, { text: "example.com" } as any).props.href).toBe("http://example.com")
    expect(cell.getLinkText(0, { text: "javascript:bad" } as any).type).toBe("span")
  })

  it("handles stream, custom emoji, and ordinary text message paths", () => {
    const context: any = { showUser: vi.fn(), editOn: () => false }
    const cell: any = new TextCell({ message: { clientMsgNo: "m", send: true, parts: [{ type: 1, text: "hello" }], content: { text: "hello" } }, context })
    expect(cell.getRenderMessageText()).toBeTruthy()
    cell.props.message = { ...cell.props.message, streamOn: true, fullStreamContent: "stream", isStreaming: true }
    expect(cell.getRenderMessageText()).toBeTruthy()
    app.emojiService.isCustomEmoji.mockReturnValue(true)
    app.emojiService.getImage.mockReturnValue("/custom.png")
    cell.props.message = { clientMsgNo: "e", send: false, parts: [{ type: 1, text: ":custom:" }], content: { text: ":custom:" } }
    expect(cell.isLargeCustomEmoji()).toBe(true)
    expect(cell.getRenderMessageText()).toBeTruthy()
  })
})
