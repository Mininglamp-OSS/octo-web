import { MediaMessageContent } from "wukongimjssdk"
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

// ── Issue #273 — in-flight media detection ──
// Content types whose wire payload requires `url` to be set. The WuKongIM
// broker accepts JSON-valid payloads even with empty url, so missing url
// silently produces invisible content in the target client.
// See SDK lib/wukongimjssdk.esm.js:2091-2097 (MessageImage.encodeJSON).
const MEDIA_PAYLOAD_TYPES_REQUIRING_URL = new Set<number>([
  MessageContentTypeConst.image,      // 2
  MessageContentTypeConst.voice,      // 4
  MessageContentTypeConst.smallVideo, // 5
  MessageContentTypeConst.file,       // 8
])

/**
 * Payload-level check used by MergeforwardContent.messageToMap, which operates
 * on already-serialized plain-object payloads (no class instance available).
 */
export function isInFlightMediaPayload(payload: any): boolean {
  if (!payload || typeof payload.type !== "number") return false
  if (!MEDIA_PAYLOAD_TYPES_REQUIRING_URL.has(payload.type)) return false
  return !payload.url
}

/**
 * Message-level check used by UI handlers (onMergeForward, fowardMessageUI) and
 * by ChatVM.sendMergeforward for pre-send counting. Uses instanceof on the live
 * SDK content object — equivalent to the payload-level check in intent, but
 * cheaper (no payload construction) and decoupled from payload type numbers.
 */
export function isMessageInFlightMedia(message?: { content?: any } | null): boolean {
  if (!message) return false
  const content = message.content
  if (!(content instanceof MediaMessageContent)) return false
  return !content.url
}
