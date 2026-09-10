import type { SummaryReferenceTask } from "../types/summary";

/**
 * 继续优化的宿主无关信号。
 *
 * 「继续优化」永远是「引用当前总结、进入 agent 会话、产出一条**全新**总结」，不再是
 * 同总结就地改写。能自己路由的宿主（统一工作区 SummaryWorkspace、聊天侧栏
 * ChatSummaryPanel）直接拿 onContinueRefine 派生；其余独立详情页入口（legacy 路由、
 * 创建成功后 push 的详情）没有宿主回调，改派这个 window 事件，由 legacyNavigation
 * push 同一个 agent 创建页。
 *
 * 事件名放在这里而不是 integration/legacyNavigation：pages/ 反向 import
 * integration/ 会和 legacyNavigation → pages 形成循环。
 */
export const SUMMARY_OPEN_CHAT_WITH_REFERENCE = "summary-open-chat-with-reference";

export function requestContinueRefine(task: SummaryReferenceTask): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SUMMARY_OPEN_CHAT_WITH_REFERENCE, { detail: task })
  );
}
