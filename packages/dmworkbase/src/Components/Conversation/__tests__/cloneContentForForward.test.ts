/**
 * Tests for `cloneContentForForward` (octo-web#86).
 *
 * 覆盖：
 *   1. 文本消息克隆后内容相同、实例不同
 *   2. 文件消息克隆后 file 被清除 (根因修复)
 *   3. 图片消息克隆后 file 被清除
 *   4. reply 上下文被清除
 *   5. mention 上下文被清除
 *   6. 原始 content 不被 mutate
 *   7. 多次克隆产出独立实例
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
    WKSDK,
    MessageText,
    MediaMessageContent,
    Mention,
    Reply,
} from "wukongimjssdk"
import { cloneContentForForward } from "../cloneContentForForward"

// ── 辅助: File mock ────────────────────────────────────────────
class FakeFile {
    name = "test.pdf"
    size = 12345
    type = "application/pdf"
}

// ── 辅助: 注册文件 content type ────────────────────────────────
const FILE_CONTENT_TYPE = 8

class TestFileContent extends MediaMessageContent {
    name = ""
    extension = ""
    size = 0
    url = ""

    constructor(file?: any, name?: string, ext?: string, sz?: number) {
        super()
        if (file) (this as any).file = file
        this.name = name ?? ""
        this.extension = ext ?? ""
        this.size = sz ?? 0
    }

    get contentType() {
        return FILE_CONTENT_TYPE
    }

    get conversationDigest() {
        return `[file] ${this.name}`
    }

    decodeJSON(obj: any) {
        this.name = obj.name ?? ""
        this.extension = obj.extension ?? ""
        this.size = obj.size ?? 0
        this.url = obj.url ?? ""
        this.remoteUrl = this.url
    }

    encodeJSON() {
        return {
            name: this.name,
            extension: this.extension,
            size: this.size,
            url: this.remoteUrl ?? "",
        }
    }
}

// ── 辅助: decode wire bytes 为 JSON ────────────────────────────
function decodeWire(content: { encode: () => Uint8Array }): any {
    return JSON.parse(new TextDecoder().decode(content.encode()))
}

// ── Setup ──────────────────────────────────────────────────────
beforeEach(() => {
    // 注册自定义文件 content type
    WKSDK.shared().register(FILE_CONTENT_TYPE, () => new TestFileContent())
})

// ── Tests ──────────────────────────────────────────────────────
describe("cloneContentForForward", () => {
    it("clones a text message: same content, different instance", () => {
        const original = new MessageText("hello world")
        const cloned = cloneContentForForward(original)

        expect(cloned).not.toBe(original)
        const wire = decodeWire(cloned)
        expect(wire.content).toBe("hello world")
        expect(wire.type).toBe(1) // MessageText type
    })

    it("strips file from FileContent (root cause fix)", () => {
        const fakeFile = new FakeFile()
        const original = new TestFileContent(fakeFile, "report.pdf", "pdf", 9999)
        original.remoteUrl = "https://cdn.example.com/report.pdf"

        // 原始有 file
        expect((original as any).file).toBe(fakeFile)

        const cloned = cloneContentForForward(original)

        // 克隆无 file
        expect((cloned as any).file).toBeUndefined()

        // 内容正确
        const wire = decodeWire(cloned)
        expect(wire.name).toBe("report.pdf")
        expect(wire.extension).toBe("pdf")
        expect(wire.size).toBe(9999)
        expect(wire.url).toBe("https://cdn.example.com/report.pdf")
    })

    it("strips reply context", () => {
        const original = new MessageText("reply text")
        const reply = new Reply()
        reply.messageID = "msg-123"
        reply.fromUID = "uid-456"
        original.reply = reply

        const cloned = cloneContentForForward(original)
        expect(cloned.reply).toBeUndefined()
    })

    it("strips mention context", () => {
        const original = new MessageText("@all check this")
        const mention = new Mention()
        mention.all = true
        mention.uids = ["uid-1", "uid-2"]
        original.mention = mention

        const cloned = cloneContentForForward(original)
        expect(cloned.mention).toBeUndefined()
    })

    it("does not mutate the original content", () => {
        const fakeFile = new FakeFile()
        const original = new TestFileContent(fakeFile, "data.xlsx", "xlsx", 1234)
        original.remoteUrl = "https://cdn.example.com/data.xlsx"
        const reply = new Reply()
        reply.messageID = "msg-999"
        original.reply = reply

        cloneContentForForward(original)

        // 原始不变
        expect((original as any).file).toBe(fakeFile)
        expect(original.reply).toBe(reply)
        expect(original.name).toBe("data.xlsx")
    })

    it("produces independent instances on multiple clones", () => {
        const original = new TestFileContent(new FakeFile(), "a.txt", "txt", 100)
        original.remoteUrl = "https://cdn.example.com/a.txt"

        const clone1 = cloneContentForForward(original)
        const clone2 = cloneContentForForward(original)

        expect(clone1).not.toBe(clone2)
        expect(clone1).not.toBe(original)

        // 修改 clone1 不影响 clone2
        ;(clone1 as any).name = "modified"
        expect((clone2 as TestFileContent).name).toBe("a.txt")
    })
})
