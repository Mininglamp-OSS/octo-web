// @caseId EX1-experts-market-list-detail
// @spec apps/web/e2e-kit/case-specs/experts/EX1-experts-market-list-detail.md

import { test, expect } from "../../fixtures-authed";

test("@EX1 @p1 @experts @market Experts 市场列表与详情", async ({ authedPage }) => {
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "expert-market-list");
  });
  await authedPage.goto("/mcp-market/experts?sid=e2etest");

  await expect(
    authedPage.getByRole("navigation", { name: "专家类型" })
  ).toBeVisible();

  const expertCard = authedPage.getByRole("button", { name: "发布负责人" });
  await expect(expertCard).toBeVisible();
  await expect(expertCard).toContainText("官方发布");

  await expertCard.click();
  const detailModal = authedPage.getByRole("dialog");
  await expect(detailModal).toBeVisible();
  await expect(detailModal).toContainText("发布负责人");
  await expect(detailModal).toContainText("官方发布");
  await expect(detailModal).toContainText("你负责检查发布风险");

  await authedPage.getByRole("button", { name: "关闭" }).click();
  await expect(detailModal).not.toBeVisible();
  await expect(expertCard).toBeVisible();
});
