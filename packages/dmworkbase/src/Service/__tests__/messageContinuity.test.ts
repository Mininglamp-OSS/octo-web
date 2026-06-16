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

    it("does not let temporary typing messages merge with real messages", () => {
        expect(isMessageContinuation(
            msg("bot1", 1_000, { contentType: MessageContentTypeConst.typing }),
            msg("bot1", 1_030),
        )).toBe(false)

        expect(isMessageContinuation(
            msg("bot1", 1_000),
            msg("bot1", 1_030, { contentType: MessageContentTypeConst.typing }),
        )).toBe(false)
    })

    it("does not continue across different senders", () => {
        expect(isMessageContinuation(msg("u1", 1_000), msg("u2", 1_030))).toBe(false)
    })

    it("breaks on screenshot system message (same fromUID should not hide avatar)", () => {
        // 截屏消息虽然 fromUID 与下一条相同，但它是居中胶囊/system tag，
        // 应该打断连续性，确保下一条正常显示头像（#308）
        expect(isMessageContinuation(
            msg("u1", 1_000, { contentType: MessageContentTypeConst.screenshot }),
            msg("u1", 1_030),
        )).toBe(false)

        // 前一条正常消息接入截屏也打断
        expect(isMessageContinuation(
            msg("u1", 1_000),
            msg("u1", 1_030, { contentType: MessageContentTypeConst.screenshot }),
        )).toBe(false)
    })
})
