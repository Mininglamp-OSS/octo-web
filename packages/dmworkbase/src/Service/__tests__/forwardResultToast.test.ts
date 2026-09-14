// interpretForwardResult 是纯函数翻译层：把 ForwardResult 的双维度计数按 scope
// 折成 {kind, failed, total}。6 分支（3 kind × 2 scope）无 IO，用表驱动扫一遍。
// 调用方选错 scope 会直接线上数字错乱，专门 pin 一下。

import { describe, expect, it } from "vitest"
import type { ForwardResult } from "../ForwardService"
import { interpretForwardResult, shouldEmitDocForwarded } from "../forwardResultToast"

function makeResult(overrides: Partial<ForwardResult>): ForwardResult {
    return {
        targets: 0,
        failedTargets: 0,
        messageAttempts: 0,
        failedMessages: 0,
        disbanded: 0,
        failures: [],
        ...overrides,
    }
}

describe("interpretForwardResult — targets scope", () => {
    it("all-success → success", () => {
        const state = interpretForwardResult(
            makeResult({ targets: 3, failedTargets: 0 }),
            "targets",
        )
        expect(state).toEqual({ kind: "success", failed: 0, total: 3 })
    })

    it("partial (1 of 3 failed) → partial", () => {
        const state = interpretForwardResult(
            makeResult({ targets: 3, failedTargets: 1 }),
            "targets",
        )
        expect(state).toEqual({ kind: "partial", failed: 1, total: 3 })
    })

    it("all failed → all-failed", () => {
        const state = interpretForwardResult(
            makeResult({ targets: 3, failedTargets: 3 }),
            "targets",
        )
        expect(state).toEqual({ kind: "all-failed", failed: 3, total: 3 })
    })
})

describe("interpretForwardResult — messages scope", () => {
    it("all-success → success (ignores targets counter)", () => {
        const state = interpretForwardResult(
            makeResult({
                targets: 2,
                failedTargets: 2, // targets-scope 看起来是 all-failed，但 messages-scope 应看 messageAttempts
                messageAttempts: 6,
                failedMessages: 0,
            }),
            "messages",
        )
        expect(state).toEqual({ kind: "success", failed: 0, total: 6 })
    })

    it("partial (2 of 6 attempts failed) → partial", () => {
        const state = interpretForwardResult(
            makeResult({ messageAttempts: 6, failedMessages: 2 }),
            "messages",
        )
        expect(state).toEqual({ kind: "partial", failed: 2, total: 6 })
    })

    it("all attempts failed → all-failed", () => {
        const state = interpretForwardResult(
            makeResult({ messageAttempts: 6, failedMessages: 6 }),
            "messages",
        )
        expect(state).toEqual({ kind: "all-failed", failed: 6, total: 6 })
    })
})

describe("interpretForwardResult — default scope is targets", () => {
    it("no scope arg → targets 语义", () => {
        // targets scope 看的是 failedTargets/targets；messages 字段应被忽略。
        const state = interpretForwardResult(
            makeResult({
                targets: 3,
                failedTargets: 1,
                messageAttempts: 9,
                failedMessages: 9,
            }),
        )
        expect(state).toEqual({ kind: "partial", failed: 1, total: 3 })
    })
})

describe("interpretForwardResult — edge cases", () => {
    it("empty result (targets=0, failed=0) → success (avoid 0/0 divide semantic)", () => {
        // 空发送不该弹错误 toast，success 分支自然覆盖。
        const state = interpretForwardResult(makeResult({}), "targets")
        expect(state).toEqual({ kind: "success", failed: 0, total: 0 })
    })

    it("failed > total (defensive; theoretically unreachable) → all-failed", () => {
        // Service 层不会产出这种状态；保底也归类为 all-failed 而不是 partial。
        const state = interpretForwardResult(
            makeResult({ targets: 2, failedTargets: 3 }),
            "targets",
        )
        expect(state.kind).toBe("all-failed")
    })
})

// shouldEmitDocForwarded 决定 document_forwarded(DAP)是否发射。这是 Octo-Q 🔴 的**predicate 层** pin:
// runDocForward 被文档卡片分享(shareAsCard===true,应计)与 html-doc「让 AI 处理」AI 指令转发
// (shareAsCard 未设,不应计)共用,ungated 发射会把指令转发折进 document_forwarded → 漏斗分子虚高。
// 注:**predicate↔emission 的 wiring**(call site 真的用了这个门、且真的发 document_forwarded)由
// WKBase.helpers.test.tsx 的 "emission wiring" 用例钉死(那个 harness 在跑);此处只钉纯函数真值表。
describe("shouldEmitDocForwarded — 仅分享流(shareAsCard===true)且送达成功才发", () => {
    it("正向:分享流(shareAsCard=true)送达成功(≥1)→ 发射一次", () => {
        expect(shouldEmitDocForwarded(true, "success")).toBe(true)
        // partial(部分送达)仍算至少一个成功 → 发。
        expect(shouldEmitDocForwarded(true, "partial")).toBe(true)
    })

    it("负向:分享流全部失败(all-failed)→ 不发", () => {
        expect(shouldEmitDocForwarded(true, "all-failed")).toBe(false)
    })

    it("负向:AI 指令转发形态(shareAsCard 未设/false)送达成功也不发(不计入文档转发漏斗)", () => {
        expect(shouldEmitDocForwarded(false, "success")).toBe(false)
        expect(shouldEmitDocForwarded(undefined, "success")).toBe(false)
        expect(shouldEmitDocForwarded(false, "partial")).toBe(false)
        // 指令转发即便全失败也本就不发,双重保证。
        expect(shouldEmitDocForwarded(undefined, "all-failed")).toBe(false)
    })
})
