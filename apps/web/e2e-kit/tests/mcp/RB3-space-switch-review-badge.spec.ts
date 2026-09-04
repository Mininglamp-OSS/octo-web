// @caseId RB3-space-switch-review-badge
// @spec apps/web/e2e-kit/case-specs/mcp/RB3-space-switch-review-badge.md

import { test, expect } from "../../fixtures-authed";
import { registerRb3SpaceSwitchReviewBadge } from "../../msw-handlers/rb3-space-switch-review-badge";

/**
 * The 组织发布管理 badge counts requests in the ACTIVE Space, so switching Space
 * makes it wrong for exactly the same reason a decision does — and unlike the
 * right pane, the sidebar is not remounted by the switch.
 *
 * The user is owner in both Spaces here on purpose: that is the case the reviewer
 * gate cannot save us from. A switch that also demotes the user flips
 * `useSpaceRole`'s `isReviewer`, which disables the probe and clears the count as
 * a side effect; owner→owner changes none of the hook's keys.
 *
 * Both Spaces have a non-zero count, also on purpose — see the handler.
 */
test("@RB3 @p1 @mcp @market 切换组织后组织发布管理徽标读取新组织的待审数", async ({
  authedPage,
}) => {
  await registerRb3SpaceSwitchReviewBadge(authedPage);
  await authedPage.waitForFunction(
    () => (globalThis as { __rb3Installed?: boolean }).__rb3Installed === true,
  );
  // Stand on 技能 — the badge has to be right while ReviewQueue is unmounted,
  // which is the whole reason it is a separate read.
  await authedPage.goto("/mcp-market/skills?sid=e2etest");

  const reviewEntry = authedPage.getByRole("button", { name: /组织发布管理/ });
  await expect(reviewEntry).toBeVisible();
  // 甲组织 has one pending request.
  await expect(reviewEntry.locator(".wk-mcp-sidebar__badge")).toHaveText("1");

  // Switch to 乙组织, which has three.
  await authedPage.getByRole("button", { name: "切换组织" }).click();
  await authedPage.getByText("乙组织", { exact: true }).click();

  // No reload, no navigation: the badge must re-read for the new Space.
  await expect(reviewEntry.locator(".wk-mcp-sidebar__badge")).toHaveText("3");
});
