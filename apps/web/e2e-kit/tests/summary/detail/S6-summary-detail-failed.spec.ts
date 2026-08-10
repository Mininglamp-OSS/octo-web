/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/detail/S6-summary-detail-failed.md
 *
 * S6: Summary 失败详情态.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS6SummaryDetailFailed } from "../../../msw-handlers/s6-summary-detail-failed";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  // CI leak target plus legacy mock host marker; workflow proxy-error grep remains the fail-closed guard.
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S6 @p1 @summary @detail @summary-detail S6 — Summary 失败详情", () => {
  test("打开失败总结后显示失败原因", async ({ authedPage }) => {
    await registerS6SummaryDetailFailed(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();

    await expect(authedPage.getByText("S6 失败总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("失败", { exact: true })).toBeVisible();
    await expect(authedPage.getByText("S6 异常群")).toBeVisible();

    await authedPage.getByText("S6 失败总结").click();

    await expect(authedPage.getByTestId(T.detailTitle)).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.detailTitle)).toContainText("S6 失败总结");
    await expect(authedPage.getByRole("heading", { name: "总结生成失败", level: 3 })).toBeVisible();
    await expect(authedPage.getByText("S6 模拟生成失败：模型服务暂不可用")).toBeVisible();
    await expect(authedPage.getByText("📝 总结内容")).toHaveCount(0);
    await expect(authedPage.getByText("AI 摘要")).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
