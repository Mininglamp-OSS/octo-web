/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S1-summary-list-detail.md
 *
 * S1: Summary 顶层入口 → 列表已完成卡片 → 详情摘要和正文.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS1SummaryListDetail } from "../../../msw-handlers/s1-summary-list-detail";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  // CI leak target plus legacy mock host marker; workflow proxy-error grep remains the fail-closed guard.
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S1 @p0 @summary @list @summary-list @summary-detail S1 — Summary 列表到详情读链路", () => {
  test("从智能总结列表打开已完成总结详情", async ({ authedPage }) => {
    await registerS1SummaryListDetail(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();

    await expect(
      authedPage.getByRole("heading", { name: "智能总结" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.listSearch)).toBeVisible();
    await expect(authedPage.getByText("暂无总结记录")).toHaveCount(0);

    await expect(authedPage.getByText("S1 项目进展总结")).toBeVisible({
      timeout: 15_000,
    });
    await expect(authedPage.getByText("已完成", { exact: true })).toBeVisible();
    await expect(authedPage.getByText("S1 项目群")).toBeVisible();

    await authedPage.getByText("S1 项目进展总结").click();

    await expect(
      authedPage.getByRole("heading", {
        name: "S1 项目进展总结",
        level: 2,
      })
    ).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("AI 摘要")).toBeVisible();
    await expect(authedPage.getByText("项目整体进展稳定")).toBeVisible();
    await expect(authedPage.getByText("已完成登录态接入")).toBeVisible();
    await expect(authedPage.getByText("下一步补充 Summary e2e")).toBeVisible();
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);
    await expect(authedPage.getByText("网络连接异常，请检查网络后重试")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
