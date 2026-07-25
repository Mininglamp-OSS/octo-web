// interpretForwardResult 是纯函数翻译层：把 ForwardResult 的双维度计数按 scope
// 折成 {kind, failed, total}。6 分支（3 kind × 2 scope）无 IO，用表驱动扫一遍。
// 调用方选错 scope 会直接线上数字错乱，专门 pin 一下。

import { describe, expect, it } from "vitest"
import type { ForwardResult } from "../ForwardService"
import { interpretForwardResult } from "../forwardResultToast"

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
