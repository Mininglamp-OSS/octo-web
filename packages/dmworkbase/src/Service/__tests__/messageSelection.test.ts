import { describe, expect, it } from "vitest"
import { MessageContentType } from "wukongimjssdk"
import { MessageContentTypeConst } from "../Const"
import { isMessageSelectable } from "../messageSelection"

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

  // #1283 round-11 P2 (@mochashanyao): pin summaryNotify (21) as
  // non-selectable — passive grey tips carry no user content to select /
  // forward / reply against, matching how the sibling module.tsx guards
  // (forward, reply, create-thread) route through the classifier.
  it("rejects summaryNotify (21) — passive tip is not user-selectable content", () => {
    expect(isMessageSelectable({ contentType: MessageContentTypeConst.summaryNotify })).toBe(false)
  })
})
