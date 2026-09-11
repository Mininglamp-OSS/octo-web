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

/**
 * `document_forwarded`(DAP)是否应发射。契约门(Octo-Q head 86c932a5 🔴,与原 P1-1 同类、方向相反):
 *   `runDocForward` 是**两条语义不同流程共用的管道**——
 *     ① 文档卡片分享转发(`DocForwardOpen.shareAsCard === true`,入口 `doc-forward-btn`,发
 *        `document_forward_panel_opened`)—— **应计** `document_forwarded`;
 *     ② html-doc「让 AI 处理」AI 指令转发(`shareAsCard` 未设/false,复用同一 bridge 但保持纯文本,
 *        入口是另一个 docs 控件)—— **不计**,否则漏斗分子含了分母里没有的手势 → 转化率虚高。
 *   契约见 `ForwardModal/grant.ts` `DocForwardOpen.shareAsCard`:仅分享流置 true,docId 存在本身不触发卡片。
 * 因此仅当「是分享流」且「至少一个目标送达成功(kind ≠ all-failed)」时才发一次。
 */
export function shouldEmitDocForwarded(
    shareAsCard: boolean | undefined,
    kind: ForwardToastKind,
): boolean {
    return shareAsCard === true && kind !== "all-failed";
}
