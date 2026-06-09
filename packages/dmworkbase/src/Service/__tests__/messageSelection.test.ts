import { describe, expect, it } from "vitest"
import { MediaMessageContent, MessageContent, MessageContentType } from "wukongimjssdk"
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
  it("flags image/voice/file payloads with empty url", () => {
    expect(isInFlightMediaPayload({ type: MessageContentTypeConst.image, url: "" })).toBe(true)
    expect(isInFlightMediaPayload({ type: MessageContentTypeConst.voice, url: "" })).toBe(true)
    expect(isInFlightMediaPayload({ type: MessageContentTypeConst.file, url: "" })).toBe(true)
  })

  it("does NOT flag smallVideo (type 5) — no client-side compose path today (#359 review)", () => {
    // smallVideo intentionally excluded from MEDIA_PAYLOAD_TYPES_REQUIRING_URL
    // (see messageSelection.ts scope comment). VideoContent extends plain
    // MessageContent, not MediaMessageContent, so flagging here would create
    // payload-vs-message asymmetry without protecting anything.
    expect(isInFlightMediaPayload({ type: MessageContentTypeConst.smallVideo, url: "" })).toBe(false)
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

  it("does NOT flag VideoContent — extends MessageContent, not MediaMessageContent (#359 review)", () => {
    // The project's VideoContent (Messages/Video/index.tsx:16) extends plain
    // MessageContent, not MediaMessageContent. isMessageInFlightMedia therefore
    // cannot flag it via instanceof — by design (see messageSelection.ts scope
    // comment). PR #359 review correctly identified that the previous
    // SmallVideoLike fixture (extends MediaMessageContent) was a false green.
    // This replacement uses a fake that mirrors the real extends chain to lock
    // the intended behavior: even with empty url, video flows are NOT flagged.
    class FakeVideoContent extends MessageContent {
      url = ""
    }
    expect(isMessageInFlightMedia({ content: new FakeVideoContent() })).toBe(false)
  })

  it("checks both remoteUrl and url (mirrors wire serialization)", () => {
    // SDK MessageImage.encodeJSON emits this.remoteUrl || this.url. The
    // upload task sets both together on success, but isMessageInFlightMedia
    // keys off both to stay in sync with the wire contract even if a future
    // code path only sets one.
    class TestMediaContent extends MediaMessageContent {
      url = ""
    }
    const onlyRemote = new TestMediaContent()
    ;(onlyRemote as any).remoteUrl = "https://cdn/x.jpg"
    expect(isMessageInFlightMedia({ content: onlyRemote })).toBe(false)

    const onlyLocal = new TestMediaContent()
    ;(onlyLocal as any).url = "https://cdn/y.jpg"
    expect(isMessageInFlightMedia({ content: onlyLocal })).toBe(false)

    const neither = new TestMediaContent()
    expect(isMessageInFlightMedia({ content: neither })).toBe(true)
  })

  it("rejects missing message defensively", () => {
    expect(isMessageInFlightMedia(undefined)).toBe(false)
    expect(isMessageInFlightMedia(null)).toBe(false)
    expect(isMessageInFlightMedia({})).toBe(false)
  })
})
