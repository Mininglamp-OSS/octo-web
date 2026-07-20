import { describe, expect, it } from "vitest"
import { MessageContentType } from "wukongimjssdk"
import { MessageContentTypeConst } from "../Const"
import { isMessageSelectable, isMeaningfulReply } from "../messageSelection"

describe("isMessageSelectable", () => {
  it("allows normal user message types", () => {
    expect(isMessageSelectable({ contentType: MessageContentType.text })).toBe(true)
    expect(isMessageSelectable({ contentType: MessageContentTypeConst.image })).toBe(true)
    expect(isMessageSelectable({ contentType: MessageContentTypeConst.file })).toBe(true)
  })

  it("rejects non-selectable timeline and thread-created message types", () => {
    expect(isMessageSelectable({ contentType: MessageContentTypeConst.time })).toBe(false)
    expect(isMessageSelectable({ contentType: MessageContentTypeConst.historySplit })).toBe(false)
    expect(isMessageSelectable({ contentType: MessageContentTypeConst.typing })).toBe(false)
    expect(isMessageSelectable({ contentType: MessageContentTypeConst.threadCreated })).toBe(false)
  })

  it("rejects recalled messages", () => {
    expect(isMessageSelectable({ contentType: MessageContentType.text, revoke: true })).toBe(false)
  })

  it("rejects missing messages defensively", () => {
    expect(isMessageSelectable(undefined)).toBe(false)
    expect(isMessageSelectable({})).toBe(false)
  })
})

describe("isMeaningfulReply (#300 — Bot bubble empty reply placeholder)", () => {
  it("[FIX] rejects null / undefined / non-object", () => {
    expect(isMeaningfulReply(null)).toBe(false)
    expect(isMeaningfulReply(undefined)).toBe(false)
    expect(isMeaningfulReply("not an object")).toBe(false)
    expect(isMeaningfulReply(42)).toBe(false)
  })

  it("[FIX] rejects empty reply object (the #300 bug case)", () => {
    expect(isMeaningfulReply({})).toBe(false)
  })

  it("[FIX] rejects reply where every meaningful field is empty/zero", () => {
    expect(
      isMeaningfulReply({
        fromName: "",
        messageSeq: 0,
        content: { conversationDigest: "" },
      })
    ).toBe(false)
    expect(
      isMeaningfulReply({
        fromName: "",
        messageSeq: 0,
        content: undefined,
      })
    ).toBe(false)
    expect(
      isMeaningfulReply({ messageID: "msg_xxx", messageSeq: 0, fromName: "" })
    ).toBe(false)
  })

  it("[FIX] accepts reply with non-empty fromName", () => {
    expect(
      isMeaningfulReply({ fromName: "Alice", messageSeq: 0 })
    ).toBe(true)
  })

  it("[FIX] accepts reply with non-empty digest", () => {
    expect(
      isMeaningfulReply({
        fromName: "",
        messageSeq: 0,
        content: { conversationDigest: "Hello world" },
      })
    ).toBe(true)
  })

  it("[FIX] accepts reply with non-zero messageSeq (locate-target available)", () => {
    expect(
      isMeaningfulReply({ fromName: "", messageSeq: 42 })
    ).toBe(true)
  })

  it("[FIX] accepts SDK-shaped Reply instance with real fields", () => {
    const sdkReply = {
      messageID: "msg_real_001",
      messageSeq: 17,
      fromUID: "u_alice",
      fromName: "Alice",
      content: {
        conversationDigest: "Original message text",
      },
    }
    expect(isMeaningfulReply(sdkReply)).toBe(true)
  })
})
