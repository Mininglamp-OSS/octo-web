import { MessageContentTypeConst } from "./Const"

export interface SelectableMessageLike {
  contentType?: number
  revoke?: boolean
}

const UNSELECTABLE_MESSAGE_TYPES = new Set<number>([
  MessageContentTypeConst.time,
  MessageContentTypeConst.historySplit,
  MessageContentTypeConst.typing,
  MessageContentTypeConst.threadCreated,
])

export function isMessageSelectable(message?: SelectableMessageLike | null): boolean {
  if (!message || message.revoke || typeof message.contentType !== "number") {
    return false
  }
  return !UNSELECTABLE_MESSAGE_TYPES.has(message.contentType)
}

// ── Issue #300 — guard against rendering empty reply placeholders ──
// Bot reply messages from the server can carry a `reply` field whose
// content is structurally present but semantically empty (e.g. `reply: {}`
// or `reply: { from_name: "", message_seq: 0 }`). The SDK's
// `Reply.decode` silently creates a Reply instance from any truthy
// payload object, with all fields possibly `undefined` / empty string / 0.
//
// Rendering ReplyBlock for such a reply produces a full-width grey
// rectangle with a 2px left bar that visually mimics a focused input
// field — see #300 (reporter described it as "extra empty input box").
//
// Meaningful = at least one of the three user-visible fields the
// ReplyBlock surfaces has real content:
//   - fromName: non-empty string
//   - content.conversationDigest: non-empty string
//   - messageSeq: positive integer (locate-target available)
//
// Server-side cleanup (Bot framework should not emit empty reply at all)
// is tracked as a follow-up — not in this PR's scope.
export function isMeaningfulReply(reply: unknown): boolean {
  if (!reply || typeof reply !== "object") return false
  const r = reply as {
    fromName?: unknown
    messageSeq?: unknown
    content?: { conversationDigest?: unknown } | null
  }
  if (typeof r.fromName === "string" && r.fromName.length > 0) return true
  const digest = r.content?.conversationDigest
  if (typeof digest === "string" && digest.length > 0) return true
  if (typeof r.messageSeq === "number" && r.messageSeq > 0) return true
  return false
}
