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
