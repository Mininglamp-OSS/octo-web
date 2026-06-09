import { describe, expect, it } from "vitest"
import { MediaMessageContent, MessageContentType } from "wukongimjssdk"
import { MessageContentTypeConst } from "../Const"
import {
  isInFlightMediaPayload,
  isMessageInFlightMedia,
  isMessageSelectable,
} from "../messageSelection"

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

describe("isInFlightMediaPayload (#273 — payload-level)", () => {
  it("flags image/voice/smallVideo/file payloads with empty url", () => {
    expect(isInFlightMediaPayload({ type: MessageContentTypeConst.image, url: "" })).toBe(true)
    expect(isInFlightMediaPayload({ type: MessageContentTypeConst.voice, url: "" })).toBe(true)
    expect(isInFlightMediaPayload({ type: MessageContentTypeConst.smallVideo, url: "" })).toBe(true)
    expect(isInFlightMediaPayload({ type: MessageContentTypeConst.file, url: "" })).toBe(true)
  })

  it("passes when url is set", () => {
    expect(
      isInFlightMediaPayload({ type: MessageContentTypeConst.image, url: "https://cdn/x.jpg" })
    ).toBe(false)
  })

  it("ignores non-media types regardless of url state", () => {
    // text / mergeForward / gif / richText etc. — not in the media set, even
    // empty url must not trigger filtering.
    expect(isInFlightMediaPayload({ type: MessageContentType.text, url: "" })).toBe(false)
    expect(isInFlightMediaPayload({ type: MessageContentTypeConst.mergeForward, url: "" })).toBe(false)
    expect(isInFlightMediaPayload({ type: MessageContentTypeConst.gif, url: "" })).toBe(false)
  })

  it("rejects malformed payloads defensively", () => {
    expect(isInFlightMediaPayload(null)).toBe(false)
    expect(isInFlightMediaPayload(undefined)).toBe(false)
    expect(isInFlightMediaPayload({})).toBe(false)
    expect(isInFlightMediaPayload({ type: "image" })).toBe(false)  // type must be number
  })
})

describe("isMessageInFlightMedia (#273 — message-level)", () => {
  // The message-level helper relies on instanceof MediaMessageContent. The SDK
  // exports the base class as a real class (not just a type), so subclasses
  // (ImageContent/FileContent/VoiceContent/SmallVideoContent) inherit it.
  class TestMediaContent extends MediaMessageContent {
    url = ""
  }

  it("flags MediaMessageContent subclass instances with empty url", () => {
    const content = new TestMediaContent()
    expect(isMessageInFlightMedia({ content })).toBe(true)
  })

  it("passes when MediaMessageContent has a url", () => {
    const content = new TestMediaContent()
    ;(content as any).url = "https://cdn/x.jpg"
    expect(isMessageInFlightMedia({ content })).toBe(false)
  })

  it("ignores non-MediaMessageContent content (plain object / text)", () => {
    expect(isMessageInFlightMedia({ content: { url: "" } })).toBe(false)
    expect(isMessageInFlightMedia({ content: { text: "hello" } })).toBe(false)
  })

  it("flags smallVideo subclass instances (regression — must not silently bypass)", () => {
    // smallVideo (content type 5) is one of MEDIA_PAYLOAD_TYPES_REQUIRING_URL
    // on the payload-level helper. Confirm the message-level helper also
    // catches it via MediaMessageContent inheritance — kept as an explicit
    // smoke test so future SDK changes don't silently regress this type.
    class SmallVideoLike extends MediaMessageContent {
      url = ""
    }
    expect(isMessageInFlightMedia({ content: new SmallVideoLike() })).toBe(true)
    const acked = new SmallVideoLike()
    ;(acked as any).url = "https://cdn/v.mp4"
    expect(isMessageInFlightMedia({ content: acked })).toBe(false)
  })

  it("rejects missing message defensively", () => {
    expect(isMessageInFlightMedia(undefined)).toBe(false)
    expect(isMessageInFlightMedia(null)).toBe(false)
    expect(isMessageInFlightMedia({})).toBe(false)
  })
})
