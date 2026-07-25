import type { ForwardResult } from "./ForwardService";

/**
 * `interpretForwardResult` —— 把 `ForwardResult` 的双维度计数翻译成 Toast 需要的
 * `{kind, failed, total}` 三元组。
 *
 * 分母维度必须显式选择，因为现状不统一——runDocForward / SummaryDetailPage / 单条转发
 * 用的是"目标 channel 数"（`targets`），Conversation 多选用的是"任务数(messages ×
 * channels)"（`messageAttempts`）。默认统一成 targets 会改坏 Summary 的用户可见文案。
 *
 * 保留"翻译" + "调用方自己拼 i18n key + Toast"的分工，避免把 Toast 库和 i18n 函数拖进
 * Service 层（跨包依赖会更大）。
 */
export type ForwardToastScope = "targets" | "messages";

export type ForwardToastKind = "success" | "partial" | "all-failed";

export interface ForwardToastState {
    kind: ForwardToastKind;
    failed: number;
    total: number;
}

export function interpretForwardResult(
    result: ForwardResult,
    scope: ForwardToastScope = "targets",
): ForwardToastState {
    const failed = scope === "targets" ? result.failedTargets : result.failedMessages;
    const total = scope === "targets" ? result.targets : result.messageAttempts;
    if (failed <= 0) return { kind: "success", failed, total };
    if (failed >= total) return { kind: "all-failed", failed, total };
    return { kind: "partial", failed, total };
}
