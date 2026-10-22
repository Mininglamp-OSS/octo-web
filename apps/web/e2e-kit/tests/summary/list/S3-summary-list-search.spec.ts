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

for (const locale of ["zh-CN", "en-US"] as const) {
  test.describe(`@S3 @p1 @summary @summary-search narrow topic evidence ${locale}`, () => {
    test.use({ authedLocale: locale });
    test("keeps a late CJK hit inside the two-line card in light and dark mode", async ({ authedPage }) => {
      await registerS3SummaryListSearch(authedPage, true);
      await authedPage.getByRole("button", { name: locale === "zh-CN" ? "智能总结" : "AI Summary", exact: true }).click();
      const list = authedPage.locator(".summary-list-page");
      await list.evaluate(el => { el.style.width = "320px"; el.style.maxWidth = "320px"; });
      await authedPage.getByTestId(T.listSearch).fill("命中");
      const description = list.locator(".summary-card-desc").first();
      await expect(description.locator("mark")).toHaveText("命中");
      for (const mode of ["light", "dark"]) {
        await authedPage.evaluate(mode => document.body.setAttribute("theme-mode", mode), mode);
        const hitInsideClamp = await description.evaluate(el => {
          const description = el.getBoundingClientRect();
          const mark = el.querySelector("mark")!.getClientRects()[0];
          return mark.top >= description.top - 1 && mark.bottom <= description.bottom + 1 &&
            mark.left >= description.left - 1 && mark.right <= description.right + 1;
        });
        expect(hitInsideClamp, `${locale}/${mode}: first hit must be visible, not merely present in the DOM`).toBe(true);
      }
    });
  });
}
