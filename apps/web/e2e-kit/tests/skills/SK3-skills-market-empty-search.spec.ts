// @caseId SK3-skills-market-empty-search
// @spec apps/web/e2e-kit/case-specs/skills/SK3-skills-market-empty-search.md

import { test, expect } from "../../fixtures-authed";

test("@SK3 @p1 @skills @market @empty Skills 市场无匹配空态", async ({ authedPage }) => {
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "skill-market-empty");
  });
  await authedPage.goto("/mcp-market/skills?sid=e2etest");

  const skillCard = authedPage.getByRole("button", {
    name: /release-risk-radar 官方发布/,
  });
  await expect(skillCard).toBeVisible();

  await authedPage.getByRole("searchbox", { name: "搜索名称、描述..." }).fill("不存在");

  await expect(authedPage.getByText("暂无数据")).toBeVisible();
  expect(await skillCard.count()).toBe(0);
  await expect(authedPage.getByText("加载失败")).not.toBeVisible();
});
