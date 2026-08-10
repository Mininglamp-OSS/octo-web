/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S20-summary-list-retry-failed.md
 *
 * S20: Summary 列表失败任务重试.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS20SummaryListRetryFailed, S20_TASK_ID } from "../../../msw-handlers/s20-summary-list-retry-failed";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S20 @p1 @summary @list @summary-list @summary-retry S20 — Summary 列表失败重试", () => {
  test("失败卡片重试后刷新为生成中", async ({ authedPage }) => {
    await registerS20SummaryListRetryFailed(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("S20 失败可重试总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("失败", { exact: true })).toBeVisible();

    const card = authedPage.getByTestId(T.card(S20_TASK_ID));
    await card.getByTestId(T.cardMenu(S20_TASK_ID)).click();
    await authedPage.getByRole("menuitem", { name: "重试" }).click();

    await expect(authedPage.getByText("已重新提交总结任务")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S20 失败可重试总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("AI正在分析聊天记录...")).toBeVisible();
    await expect(authedPage.getByText("失败", { exact: true })).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
