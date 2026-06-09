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
//
// Scope decision (per PR #359 review): we only list the types that currently
// have a client-side send path producing an empty-url window:
//   - image (2) → user file pick → ImageContent (extends MediaMessageContent)
//   - voice (4) → recorded audio → VoiceContent (extends MediaMessageContent)
//   - file (8) → user file pick → FileContent (extends MediaMessageContent)
//
// smallVideo (5) is INTENTIONALLY excluded. `new VideoContent()` only appears
// in the SDK decode registry (`module.tsx:305`) for INCOMING server messages,
// which always carry a url. There is no client-side video compose flow today,
// so an empty-url type-5 payload cannot exist in practice. Additionally the
// project's `VideoContent` extends plain `MessageContent`, not
// `MediaMessageContent` (`Messages/Video/index.tsx:16`), so the message-level
// helper below could not flag it anyway — listing type 5 here would create
// a payload-vs-message inconsistency without protecting anything.
// If a future client-side video compose flow is added, the right fix is to:
//   1. make `VideoContent extends MediaMessageContent`
//   2. add `MessageContentTypeConst.smallVideo` to the Set below
// and add a regression test using the real class.
const MEDIA_PAYLOAD_TYPES_REQUIRING_URL = new Set<number>([
  MessageContentTypeConst.image, // 2
  MessageContentTypeConst.voice, // 4
  MessageContentTypeConst.file,  // 8
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
 * Message-level check used by ChatVM.sendMergeforward for pre-send counting
 * and by the onMergeForward UI handler. Uses instanceof on the live SDK
 * content object — strictly equivalent in intent to the payload-level check,
 * but cheaper (no payload construction) and decoupled from payload type
 * numbers.
 *
 * Checks both `remoteUrl` and `url` to mirror the wire serialization contract
 * (`MessageImage.encodeJSON` emits `this.remoteUrl || this.url`). The current
 * upload task sets both on success, but keying off both keeps the contract
 * intact if a future code path sets only one.
 */
export function isMessageInFlightMedia(message?: { content?: any } | null): boolean {
  if (!message) return false
  const content = message.content
  if (!(content instanceof MediaMessageContent)) return false
  return !(content.remoteUrl || content.url)
}
