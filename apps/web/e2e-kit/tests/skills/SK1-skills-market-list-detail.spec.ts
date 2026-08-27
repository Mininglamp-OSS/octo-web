// @caseId SK1-skills-market-list-detail
// @spec apps/web/e2e-kit/case-specs/skills/SK1-skills-market-list-detail.md

import { test, expect } from "../../fixtures-authed";

test("@SK1 @p1 @skills @market Skills 市场列表与详情", async ({ authedPage }) => {
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "skill-market-list");
  });
  await authedPage.goto("/mcp-market/skills?sid=e2etest");

  await expect(
    authedPage.getByRole("navigation", { name: "技能市场导航" })
  ).toBeVisible();

  const skillCard = authedPage.getByRole("button", {
    name: /release-risk-radar 官方发布/,
  });
  await expect(skillCard).toBeVisible();
  await expect(skillCard).toContainText("发布风险雷达");

  await skillCard.click();
  const detailModal = authedPage.getByRole("dialog");
  await expect(detailModal).toBeVisible();
  await expect(detailModal).toContainText("发布风险雷达");
  await expect(detailModal).toContainText("release-risk-radar");
  await expect(detailModal).toContainText("官方发布");
  await expect(detailModal).toContainText("根据改动范围生成发布风险检查清单");

  await authedPage.getByRole("button", { name: "关闭" }).click();
  await expect(detailModal).not.toBeVisible();
  await expect(skillCard).toBeVisible();
});
