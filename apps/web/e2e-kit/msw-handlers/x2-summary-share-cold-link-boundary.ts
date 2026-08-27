/* eslint-disable no-undef -- e2e code runs in Node */
import type { Page } from "@playwright/test";
import { registerS26SummaryStandaloneLinks } from "./s26-summary-standalone-links";

/** X2: 复用 S26 稳定分享 fixture，专注冷启动无返回聊天入口边界。 */
export async function registerX2SummaryShareColdLinkBoundary(page: Page): Promise<void> {
  await registerS26SummaryStandaloneLinks(page);
}
