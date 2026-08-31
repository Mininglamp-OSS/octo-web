/* eslint-disable no-undef -- e2e code runs in Node */
import type { Page } from "@playwright/test";
import { registerS22SummaryChatPanelHistoryDetail } from "./s22-summary-chat-panel-history-detail";

/** X1: 复用已验证的 Chat → Summary Panel 数据契约，守护返回链路. */
export async function registerX1CrossModuleChatSummaryReturn(page: Page): Promise<void> {
  await registerS22SummaryChatPanelHistoryDetail(page);
}
