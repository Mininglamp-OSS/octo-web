// @caseId EX4-experts-market-truncated-page
// @spec apps/web/e2e-kit/case-specs/experts/EX4-experts-market-truncated-page.md

import { test, expect } from "../../fixtures-authed";

for (const locale of ["zh-CN", "en-US"]) {
  test(`@EX4 @p1 @experts @market @pagination search beyond page 1 (${locale})`, async ({ authedPage }, testInfo) => {
    const en = locale === "en-US";
    await authedPage.addInitScript(() => {
      sessionStorage.setItem("__e2e_scenario", "expert-market-truncated");
    });
    await authedPage.goto(`/mcp-market/experts?sid=e2etest&lang=${locale}`);

    const cards = authedPage.locator(".wk-mcp-expert-grid .wk-mcp-card");
    const pagination = authedPage.locator(".wk-mcp-expert-pagination");
    const more = authedPage.getByRole("button", { name: en ? "Load more" : "加载更多", exact: true });
    await expect(cards).toHaveCount(100);
    await expect(pagination).toContainText(en ? "Showing 100 of 112" : "已显示 100 / 112 项");
    await more.scrollIntoViewIfNeeded();
    await authedPage.screenshot({ path: testInfo.outputPath(`pagination-${locale}.png`) });
    await more.click();
    await expect(cards).toHaveCount(112);
    await expect(more).toHaveCount(0);

    const search = authedPage.getByRole("searchbox", { name: en ? "Search experts" : "搜索专家", exact: true });
    await search.fill("数据分析报告");
    await expect(cards).toHaveCount(2);

    await expect(authedPage.getByRole("button", { name: "数据分析报告专家", exact: true })).toBeVisible();
    await expect(authedPage.getByRole("button", { name: "数据分析报告师", exact: true })).toBeVisible();
    await expect(pagination).toContainText(en ? "Showing 2 of 2" : "已显示 2 / 2 项");
    await authedPage.screenshot({ path: testInfo.outputPath(`search-${locale}.png`) });

    // Repeat from page 1: finding the later match must not require page 2.
    await search.fill("");
    await expect(cards).toHaveCount(100);
    await search.fill("数据分析报告");
    await expect(cards).toHaveCount(2);

    // Tag suggestions have their own server limit. A name beyond the first 50
    // must remain discoverable through the popover's server-backed search.
    await authedPage.getByRole("button", { name: en ? "Tags" : "标签", exact: true }).click();
    const tagSearch = authedPage.getByRole("searchbox", { name: en ? "Search tags" : "搜索标签", exact: true });
    await tagSearch.fill("rare-report");
    await authedPage.getByRole("option", { name: "rare-report", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(authedPage.getByRole("button", { name: "数据分析报告师", exact: true })).toBeVisible();
  });
}
