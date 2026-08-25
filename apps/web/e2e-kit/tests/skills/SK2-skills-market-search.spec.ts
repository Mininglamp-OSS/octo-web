// @caseId SK2-skills-market-search
// @spec apps/web/e2e-kit/case-specs/skills/SK2-skills-market-search.md

import { test, expect } from "../../fixtures-authed";

test("@SK2 @p1 @skills @market @search Skills 市场搜索", async ({ authedPage }) => {
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "skill-market-search");
  });
  await authedPage.goto("/mcp-market/skills?sid=e2etest");

  await expect(authedPage.getByText("共 2 个技能")).toBeVisible();
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

  // Unified taxonomy: category counts (and thus the "共 N 个技能" summary, which
  // binds to the active category's catalog skillCount) are catalog-wide and do
  // NOT re-scope to the search query — getCategories intentionally drops `q`
  // (owner-accepted in the unified switch). So the summary stays at the catalog
  // total while only the card list narrows to the matching skill.
  await expect(authedPage.getByText("共 2 个技能")).toBeVisible();
  await expect(
    authedPage.getByRole("button", { name: /release-risk-radar 官方发布/ })
  ).toBeVisible();
  expect(
    await authedPage.getByRole("button", { name: /meeting-note-cleaner Alice/ }).count()
  ).toBe(0);
});
