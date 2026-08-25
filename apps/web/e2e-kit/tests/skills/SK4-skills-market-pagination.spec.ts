// @caseId SK4-skills-market-pagination
// @spec apps/web/e2e-kit/case-specs/skills/SK4-skills-market-pagination.md

import { test, expect } from "../../fixtures-authed";

test("@SK4 @p1 @skills @market @pagination Skills 市场分页追加", async ({ authedPage }) => {
  const skillRequests: string[] = [];
  authedPage.on("request", (request) => {
    if (request.url().includes("/plugins?")) skillRequests.push(request.url());
  });
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "skill-market-pagination");
  });
  await authedPage.setViewportSize({ width: 1280, height: 500 });
  await authedPage.goto("/mcp-market/skills?sid=e2etest");

  const firstSkill = authedPage.getByRole("button", {
    name: /release-risk-radar 官方发布/,
  });
  const secondSkill = authedPage.getByRole("button", {
    name: /meeting-note-cleaner/,
  });

  await expect(authedPage.getByText("共 2 个技能")).toBeVisible();
  await expect(firstSkill).toBeVisible();
  await expect.poll(() => skillRequests.some((url) => !url.includes("cursor="))).toBe(true);
  await authedPage.locator(".skill-market-sentinel").scrollIntoViewIfNeeded();
  await expect.poll(() => skillRequests.some((url) => url.includes("page=2"))).toBe(true);
  await expect(secondSkill).toBeVisible();
  await expect(authedPage.getByText("加载失败")).not.toBeVisible();
});
