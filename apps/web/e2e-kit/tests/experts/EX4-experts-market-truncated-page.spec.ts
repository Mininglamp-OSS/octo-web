// @caseId EX4-experts-market-truncated-page
// @spec apps/web/e2e-kit/case-specs/experts/EX4-experts-market-truncated-page.md

import { test, expect } from "../../fixtures-authed";

test("@EX4 @p1 @experts @market @pagination Experts 市场分页上限提示", async ({ authedPage }) => {
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "expert-market-truncated");
  });
  await authedPage.goto("/mcp-market/experts?sid=e2etest");

  await expect(authedPage.getByText("共 101 个")).toBeVisible();
  await expect(
    authedPage.getByRole("button", { name: "发布负责人" })
  ).toBeVisible();
  await expect(
    authedPage.getByText("仅显示前 100 项，请用搜索或分类筛选缩小范围")
  ).toBeVisible();
  await expect(authedPage.getByText("加载失败，请稍后重试。")).not.toBeVisible();
});
