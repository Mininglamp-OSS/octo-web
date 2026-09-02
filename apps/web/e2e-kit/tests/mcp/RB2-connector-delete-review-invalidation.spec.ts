// @caseId RB2-connector-delete-review-invalidation
// @spec apps/web/e2e-kit/case-specs/mcp/RB2-connector-delete-review-invalidation.md

import { test, expect } from "../../fixtures-authed";
import { registerRb2ConnectorDeleteReview } from "../../msw-handlers/rb2-connector-delete-review";

/**
 * Deleting a plugin with an open review request settles that request server-side
 * in the same transaction, so the Space's pending count drops on the spot. RB1
 * pins that the sidebar badge follows a DECISION; this case pins the other way a
 * request leaves the queue — the plugin under it is removed.
 *
 * The connector market reaches `/plugins/delete` through dmworkmcp's own api
 * module rather than through @dmwork/skillmarket, which is why this path could
 * drift away from `deleteSkill` without anybody noticing.
 */
test("@RB2 @p1 @mcp @market 删除有待审申请的连接器后组织发布管理徽标立即归零", async ({
  authedPage,
}) => {
  await registerRb2ConnectorDeleteReview(authedPage);
  await authedPage.waitForFunction(
    () => (globalThis as { __rb2Installed?: boolean }).__rb2Installed === true,
  );
  await authedPage.goto("/mcp-market/mine?type=mcp&sid=e2etest");

  const reviewEntry = authedPage.getByRole("button", { name: /组织发布管理/ });
  await expect(reviewEntry).toBeVisible();
  // One pending request on the connector below → the badge says 1.
  await expect(reviewEntry.locator(".wk-mcp-sidebar__badge")).toHaveText("1");

  const row = authedPage.getByRole("row", { name: "待审连接器", exact: true });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "删除「待审连接器」", exact: true }).click();

  const dialog = authedPage.getByRole("dialog");
  await expect(dialog).toContainText("删除该连接器？");
  await dialog.getByRole("button", { name: "删除", exact: true }).click();

  // The row goes…
  await expect(row).toHaveCount(0);
  // …and so does the badge, without a reload. Before the fix this stayed at 1,
  // advertising a review request for a connector that no longer exists.
  await expect(reviewEntry.locator(".wk-mcp-sidebar__badge")).toHaveCount(0);
});
