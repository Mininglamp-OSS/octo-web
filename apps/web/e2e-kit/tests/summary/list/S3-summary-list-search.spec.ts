/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S3-summary-list-search.md
 *
 * S3: Summary 列表搜索关键词后只展示命中卡片.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS3SummaryListSearch } from "../../../msw-handlers/s3-summary-list-search";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  // CI leak target plus legacy mock host marker; workflow proxy-error grep remains the fail-closed guard.
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S3 @p1 @summary @list @summary-list @summary-search S3 — Summary 列表搜索", () => {
  test("搜索关键词后只显示命中的总结", async ({ authedPage }) => {
    await registerS3SummaryListSearch(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();

    await expect(authedPage.getByText("S3 周报总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S3 客户反馈总结")).toBeVisible();

    await authedPage.getByTestId(T.listSearch).fill("客户");

    await expect(authedPage.getByText("S3 客户反馈总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S3 周报总结")).toHaveCount(0);
    await expect(authedPage.getByText("暂无总结记录")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
