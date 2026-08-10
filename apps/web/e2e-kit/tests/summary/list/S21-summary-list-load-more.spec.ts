/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S21-summary-list-load-more.md
 *
 * S21: Summary 列表滚动加载更多.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS21SummaryListLoadMore } from "../../../msw-handlers/s21-summary-list-load-more";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S21 @p2 @summary @list @summary-list @pagination S21 — Summary 列表加载更多", () => {
  test("滚动到底部后追加第二页总结", async ({ authedPage }) => {
    await registerS21SummaryListLoadMore(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("S21 第 01 条总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("暂无总结记录")).toHaveCount(0);

    const list = authedPage.getByTestId(T.listContent);
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    await expect(authedPage.getByText("S21 第二页总结").first()).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("没有更多了")).toBeVisible();
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
