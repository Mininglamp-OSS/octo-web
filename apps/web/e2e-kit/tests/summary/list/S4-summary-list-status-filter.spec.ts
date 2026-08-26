/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S4-summary-list-status-filter.md
 *
 * S4: Summary 列表按状态筛选失败总结.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS4SummaryListStatusFilter } from "../../../msw-handlers/s4-summary-list-status-filter";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  // CI leak target plus legacy mock host marker; workflow proxy-error grep remains the fail-closed guard.
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S4 @p1 @summary @list @summary-list @summary-filter S4 — Summary 状态筛选", () => {
  test("选择失败状态后只显示失败总结", async ({ authedPage }) => {
    await registerS4SummaryListStatusFilter(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();

    await expect(authedPage.getByText("S4 已完成总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S4 失败总结")).toBeVisible();

    await authedPage.getByTestId(T.listStatusFilter).click();
    await authedPage.getByRole("menuitem", { name: "失败" }).click();

    await expect(authedPage.getByText("S4 失败总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S4 已完成总结")).toHaveCount(0);
    await expect(authedPage.getByText("暂无总结记录")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
