import { describe, expect, it } from "vitest"
import { MessageContentTypeConst } from "../Const"
import { MESSAGE_CONTINUATION_MAX_GAP_SEC, isMessageContinuation } from "../messageContinuity"

const msg = (fromUID: string, timestamp: number, extra: Record<string, unknown> = {}) => ({
    fromUID,
    timestamp,
    contentType: 1,
    ...extra,
})

describe("isMessageContinuation", () => {
    it("continues messages from the same sender within 10 minutes", () => {
        expect(isMessageContinuation(
            msg("u1", 1_000),
            msg("u1", 1_000 + MESSAGE_CONTINUATION_MAX_GAP_SEC - 1),
        )).toBe(true)
    })

    it("breaks same-sender groups at 10 minutes", () => {
        expect(isMessageContinuation(
            msg("u1", 1_000),
            msg("u1", 1_000 + MESSAGE_CONTINUATION_MAX_GAP_SEC),
        )).toBe(false)
    })

    it("breaks same-sender groups when the previous item is a local separator", () => {
        expect(isMessageContinuation(
            msg("u1", 1_000, { contentType: MessageContentTypeConst.time }),
            msg("u1", 1_030),
        )).toBe(false)
    })

    it("does not continue across different senders", () => {
        expect(isMessageContinuation(msg("u1", 1_000), msg("u2", 1_030))).toBe(false)
    })
})
