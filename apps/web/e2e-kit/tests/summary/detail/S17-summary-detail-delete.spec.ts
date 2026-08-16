/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/detail/S17-summary-detail-delete.md
 *
 * S17: Summary 详情页删除总结.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS17SummaryDetailDelete } from "../../../msw-handlers/s17-summary-detail-delete";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S17 @p1 @summary @detail @summary-detail @summary-delete S17 — Summary 详情删除", () => {
  test("详情页确认删除后返回列表并显示空态", async ({ authedPage }) => {
    await registerS17SummaryDetailDelete(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("S17 待删除总结")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S17 待删除总结").click();

    await expect(authedPage.getByTestId(T.detailTitle)).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.detailTitle)).toContainText("S17 待删除总结");
    await expect(authedPage.getByText("S17 删除前正文内容")).toBeVisible();

    await authedPage.getByTestId(T.detailDeleteBtn).click();
    await expect(authedPage.getByRole("dialog", { name: "确认删除" })).toBeVisible();
    await authedPage.getByTestId(T.deleteConfirmOkBtn).click();

    await expect(authedPage.getByText("删除成功")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("暂无总结记录")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S17 待删除总结")).toHaveCount(0);
    await expect(authedPage.getByTestId(T.detailTitle)).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
