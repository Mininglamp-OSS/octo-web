// @caseId RB1-review-badge-invalidation
// @spec apps/web/e2e-kit/case-specs/skills/RB1-review-badge-invalidation.md

import { test, expect } from "../../fixtures-authed";

/**
 * The sidebar's 组织发布管理 count and the 待审核 list are two separate reads of
 * the same queue — the badge has to render while ReviewQueue is unmounted, so it
 * cannot be derived from the queue's state. They used to drift: a 通过 refreshed
 * the list and left the badge on its page-load number until a full reload.
 *
 * This case pins the fix at the level the user reported it: the badge must move
 * on the SAME page instance, with no navigation and no reload in between.
 */
test("@RB1 @p1 @skills @market 组织发布管理 徽标在审核决策后立即更新", async ({
  authedPage,
}) => {
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "skill-market-review-badge");
    sessionStorage.removeItem("__e2e_rb1_loaded");
  });
  await authedPage.goto("/mcp-market/review?sid=e2etest");

  const reviewEntry = authedPage.getByRole("button", { name: /组织发布管理/ });
  await expect(reviewEntry).toBeVisible();
  // One pending request in the fixture → the badge says 1.
  await expect(reviewEntry.locator(".wk-mcp-sidebar__badge")).toHaveText("1");

  const approve = authedPage.getByRole("button", {
    name: "通过「发布风险雷达」的上架申请",
  });
  await expect(approve).toBeVisible();
  await approve.click();

  // The queue empties…
  await expect(
    authedPage.getByText("暂无待审核申请")
  ).toBeVisible();
  // …and so does the badge, without a reload. Before the fix this stayed at 1.
  await expect(reviewEntry.locator(".wk-mcp-sidebar__badge")).toHaveCount(0);
});
