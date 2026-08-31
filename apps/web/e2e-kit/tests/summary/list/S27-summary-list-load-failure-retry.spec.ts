/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S27-summary-list-load-failure-retry.md
 *
 * S27: Summary 列表加载失败后重试恢复.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS27SummaryListLoadFailureRetry } from "../../../msw-handlers/s27-summary-list-load-failure-retry";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^(?:\/(?:api|summary\/api))(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S27 @p1 @summary @list @summary-list @summary-retry S27 — Summary 列表加载失败重试", () => {
  test("列表刷新失败后重试恢复内容", async ({ authedPage }) => {
    await registerS27SummaryListLoadFailureRetry(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();

    await expect(authedPage.getByText("网络连接异常，请检查网络后重试")).toBeVisible({ timeout: 15_000 });
    const retryButton = authedPage.getByRole("button", { name: "重试" });
    await expect(retryButton).toBeVisible();
    await authedPage.evaluate(() => { (globalThis as { __s27RetryRequested?: boolean }).__s27RetryRequested = true; });
    await retryButton.click();

    await expect(authedPage.getByText("S27 重试后恢复总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("网络连接异常，请检查网络后重试")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
