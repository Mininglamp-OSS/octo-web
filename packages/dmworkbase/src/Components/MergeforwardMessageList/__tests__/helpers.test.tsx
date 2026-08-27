// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { MessageContentType } from "wukongimjssdk"
import { MessageContentTypeConst } from "../../../Service/Const"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import MergeforwardMessageList from "../index"

describe("MergeforwardMessageList helpers", () => {
  it("covers titles, timelines, media sizing, URLs, and file colors", () => {
    const list: any = new MergeforwardMessageList({ mergeforwardContent: { channelType: 2, users: [], msgs: [] }, visible: true } as any)
    list.context = { locale: "zh-CN", t: (key: string) => key }
    ;(globalThis as any).WKApp
    expect(list.getTitle({ channelType: 2, users: [], msgs: [] })).toContain("groupChatHistory")
    expect(list.getTitle({ channelType: 1, users: [{ name: "Alice" }], msgs: [] })).toContain("userChatHistory")
    expect(list.getTimeline({ msgs: [] })).toBe("")
    expect(list.getTimeline({ msgs: [{ timestamp: 1 }] })).toContain("1970")
    expect(list.imageScale(1000, 500).width).toBe(250)
    expect(list.imageScale(500, 1000).height).toBe(250)
    expect(list.imageScale(300, 300).width).toBe(250)
    expect(list.formatFileSize(1024 * 1024)).toBe("1.0 MB")
    list.cachedRootStyle = { getPropertyValue: () => "" }
    expect(list.getFileExtColor("pdf")).toBe("#EF4444")
    expect(list.getFileExtColor("docx")).toBe("#3B82F6")
    expect(list.getFileExtColor("xls")).toBe("#22C55E")
    expect(list.getFileExtColor("ppt")).toBe("#F97316")
    expect(list.getFileExtColor("zip")).toBe("#EAB308")
    expect(list.getFileExtColor("unknown")).toBe("#9CA3AF")
    expect(list.getTitle({ channelType: 1, users: [], msgs: [] })).toContain("chatHistory")
    list.context = { locale: "en-US", t: (key: string) => key }
    expect(list.getTitle({ channelType: 1, users: [{ name: "Alice" }, { name: "Bob" }], msgs: [] })).toContain("userChatHistory")
    expect(list.getTimeline({ msgs: [{ timestamp: 1 }, { timestamp: 2 }] })).toContain("~")
    expect(list.imageScale(100, 50)).toEqual({ width: 100, height: 50 })
    expect(list.formatFileSize(0)).toBe("0 B")
    expect(list.formatFileSize(100)).toBe("100 B")
    expect(list.formatFileSize(1024)).toBe("1.0 KB")
    expect(list.formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB")
  })

  it("builds content for image, rich text, nested forward, file, and fallback messages", () => {
    const list: any = new MergeforwardMessageList({ mergeforwardContent: { channelType: 2, users: [], msgs: [] } } as any)
    list.context = { locale: "zh-CN", t: (key: string) => key }
    expect(list.getMsgContent({ contentType: MessageContentType.text, content: { text: "hello" } } as any)).toBeTruthy()
    expect(list.getMsgContent({ contentType: MessageContentType.image, content: { width: 10, height: 20, imgData: "data:image/png" } } as any)).toBeTruthy()
    expect(list.getMsgContent({ contentType: MessageContentTypeConst.richText, content: { content: [] } } as any)).toBeTruthy()
    expect(list.getMsgContent({ contentType: MessageContentTypeConst.mergeForward, content: { channelType: 2, users: [], msgs: [] } } as any)).toBeTruthy()
    expect(list.getMsgContent({ contentType: MessageContentTypeConst.file, content: { extension: "pdf", name: "a.pdf", size: 10 } } as any)).toBeTruthy()
    expect(list.getMsgContent({ contentType: 999, content: { conversationDigest: "digest" } } as any)).toBe("digest")
  })
})
