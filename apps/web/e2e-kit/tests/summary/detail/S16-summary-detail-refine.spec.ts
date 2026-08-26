/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/detail/S16-summary-detail-refine.md
 *
 * S16: Summary 详情按意见调整.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS16SummaryDetailRefine } from "../../../msw-handlers/s16-summary-detail-refine";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S16 @p2 @summary @detail @summary-detail @summary-refine S16 — Summary 按意见调整", () => {
  test("提交按意见调整后正文更新", async ({ authedPage }) => {
    await registerS16SummaryDetailRefine(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("S16 可调整总结")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S16 可调整总结").click();

    await expect(authedPage.getByTestId(T.detailTitle)).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.detailTitle)).toContainText("S16 可调整总结");
    await expect(authedPage.getByText("S16 原始正文内容", { exact: true })).toBeVisible();

    await authedPage.getByTestId(T.detailRegenerateBtn).click();
    await expect(authedPage.getByTestId(T.regenerateModal)).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("修改提示词并重新生成")).toBeVisible();
    await expect(authedPage.getByText("按意见调整当前结果")).toBeVisible();
    await authedPage.getByTestId(T.regenerateInput).fill("S16 请补充风险说明");
    await authedPage.getByTestId(T.regenerateSubmitBtn).click();

    await expect(authedPage.getByText("修改成功，已更新到版本 2")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S16 已按意见调整正文", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S16 原始正文内容", { exact: true })).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
