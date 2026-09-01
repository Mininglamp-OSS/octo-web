// @caseId SK2-skills-market-search
// @spec apps/web/e2e-kit/case-specs/skills/SK2-skills-market-search.md

import { test, expect } from "../../fixtures-authed";

test("@SK2 @p1 @skills @market @search Skills 市场搜索", async ({ authedPage }) => {
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "skill-market-search");
  });
  await authedPage.goto("/mcp-market/skills?sid=e2etest");

  await expect(
    authedPage.getByRole("button", { name: /release-risk-radar 官方发布/ })
  ).toBeVisible();
  await expect(
    authedPage.getByRole("button", { name: /meeting-note-cleaner Alice/ })
  ).toBeVisible();

  const search = authedPage.getByRole("searchbox", {
    name: "搜索名称、描述...",
  });
  await search.fill("发布");

  // Only release-risk-radar matches 发布, so the search re-scopes the grid to
  // it alone and meeting-note-cleaner drops out.
  await expect(
    authedPage.getByRole("button", { name: /release-risk-radar 官方发布/ })
  ).toBeVisible();
  await expect
    .poll(() =>
      authedPage.getByRole("button", { name: /meeting-note-cleaner Alice/ }).count()
    )
    .toBe(0);
});
