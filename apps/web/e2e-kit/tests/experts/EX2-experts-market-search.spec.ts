// @caseId EX2-experts-market-search
// @spec apps/web/e2e-kit/case-specs/experts/EX2-experts-market-search.md

import { test, expect } from "../../fixtures-authed";

test("@EX2 @p1 @experts @market @search Experts 市场搜索", async ({ authedPage }) => {
  // authedPage has already booted once; this test then performs another
  // full-document navigation after installing its scenario. Protect the
  // bootstrap category request during the new document's MSW registration gap.
  await authedPage.route("**/api/v1/spaces/*/categories", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "expert-market-search");
  });
  await authedPage.goto("/mcp-market/experts?sid=e2etest");

  await expect(
    authedPage.getByRole("button", { name: "发布负责人" })
  ).toBeVisible();
  await expect(
    authedPage.getByRole("button", { name: "会议协调专家" })
  ).toBeVisible();

  await authedPage.getByRole("searchbox", { name: "搜索专家" }).fill("发布");

  await expect(
    authedPage.getByRole("button", { name: "发布负责人" })
  ).toBeVisible();
  await expect
    .poll(() => authedPage.getByRole("button", { name: "会议协调专家" }).count())
    .toBe(0);
});
