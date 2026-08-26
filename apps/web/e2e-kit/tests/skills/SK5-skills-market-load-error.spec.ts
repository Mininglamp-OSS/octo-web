// @caseId SK5-skills-market-load-error
// @spec apps/web/e2e-kit/case-specs/skills/SK5-skills-market-load-error.md

import { test, expect } from "../../fixtures-authed";

test("@SK5 @p1 @skills @market @error Skills 市场加载失败", async ({ authedPage }) => {
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "skill-market-error");
  });
  await authedPage.goto("/mcp-market/skills?sid=e2etest");

  await expect(authedPage.getByText("加载失败")).toBeVisible();
  await expect(authedPage.getByRole("button", { name: "重试" })).toBeVisible();
  expect(
    await authedPage.getByRole("button", { name: /release-risk-radar/ }).count()
  ).toBe(0);
  expect(await authedPage.getByText(/共 .* 个技能/).count()).toBe(0);
  await expect(authedPage.getByText("暂无数据")).not.toBeVisible();
});
