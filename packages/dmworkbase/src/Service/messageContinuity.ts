import { MessageContentTypeConst } from "./Const"

export const MESSAGE_CONTINUATION_MAX_GAP_SEC = 10 * 60

interface ContinuityMessage {
    fromUID?: string
    timestamp?: number
    revoke?: boolean
    contentType?: number
    content?: {
        contentType?: number
    }
}

function contentTypeOf(message: ContinuityMessage): number | undefined {
    return message.contentType ?? message.content?.contentType
}

function isBoundaryMessage(message: ContinuityMessage): boolean {
    const contentType = contentTypeOf(message)
    return contentType === MessageContentTypeConst.time
        || contentType === MessageContentTypeConst.historySplit
        || contentType === MessageContentTypeConst.typing
        || contentType === MessageContentTypeConst.screenshot
        || !!message.revoke
}

export function isMessageContinuation(previous?: ContinuityMessage, current?: ContinuityMessage): boolean {
    if (!previous || !current) {
        return false
    }
    if (isBoundaryMessage(previous) || isBoundaryMessage(current)) {
        return false
    }
    if (!previous.fromUID || previous.fromUID !== current.fromUID) {
        return false
    }
    const previousTimestamp = previous.timestamp
    const currentTimestamp = current.timestamp
    if (typeof previousTimestamp !== "number" || typeof currentTimestamp !== "number") {
        return true
    }
    if (!Number.isFinite(previousTimestamp) || !Number.isFinite(currentTimestamp)) {
        return true
    }
    return Math.abs(currentTimestamp - previousTimestamp) < MESSAGE_CONTINUATION_MAX_GAP_SEC
}
