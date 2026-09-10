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

test("@RB1 @p1 @skills @market drawer rejection keeps failure feedback and guards dismissal", async ({ authedPage: page }, testInfo) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "skill-market-review-badge");
    sessionStorage.removeItem("__e2e_rb1_loaded");
    sessionStorage.setItem("__e2e_rb1_hold_reject", "1");
  });
  await page.goto("/mcp-market/review?sid=e2etest");
  await page.getByRole("button", { name: "发布风险雷达", exact: true }).click();
  const drawer = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "发布风险雷达", exact: true }) });
  await drawer.getByRole("button", { name: "拒绝", exact: true }).click();
  const reasonDialog = page.getByRole("dialog").filter({ has: page.getByRole("textbox", { name: "拒绝原因" }) });
  await reasonDialog.getByRole("textbox").fill("Please clarify the requested change.");
  await reasonDialog.getByRole("button", { name: "确认拒绝", exact: true }).click();
  await page.waitForFunction(() => typeof (globalThis as typeof globalThis & { __e2eRb1ReleaseReject?: () => void }).__e2eRb1ReleaseReject === "function");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();
  await expect(reasonDialog).toBeVisible();
  await expect(drawer.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await page.evaluate(() => (globalThis as typeof globalThis & { __e2eRb1ReleaseReject?: () => void }).__e2eRb1ReleaseReject?.());
  await expect(reasonDialog.getByText("This review was already decided.", { exact: true })).toBeVisible();
  await expect(reasonDialog.getByRole("textbox")).toHaveValue("Please clarify the requested change.");
  await page.screenshot({ path: testInfo.outputPath("drawer-reject-conflict.png") });
  await reasonDialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(reasonDialog).toHaveCount(0);
  await expect(drawer.getByText("This review was already decided.", { exact: true })).toBeVisible();
});

for (const action of ["approve", "reject"] as const) {
  test(`@RB1 @p1 @skills @market ${action} unlocks after a Space change with no event`, async ({ authedPage: page }, testInfo) => {
    await page.addInitScript((decision) => {
      sessionStorage.setItem("__e2e_scenario", "skill-market-review-badge");
      sessionStorage.removeItem("__e2e_rb1_loaded");
      sessionStorage.setItem(`__e2e_rb1_hold_${decision}`, "1");
      sessionStorage.setItem("__e2e_rb1_silent_space", "e2e-space-002");
    }, action);
    await page.goto("/mcp-market/review?sid=e2etest");
    await page.getByRole("button", { name: "发布风险雷达", exact: true }).click();
    const drawer = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "发布风险雷达", exact: true }) });
    if (action === "reject") {
      await drawer.getByRole("button", { name: "拒绝", exact: true }).click();
      await page.getByRole("textbox", { name: "拒绝原因" }).fill("Retain this reason after a Space switch.");
      await page.getByRole("button", { name: "确认拒绝", exact: true }).click();
    } else await drawer.getByRole("button", { name: "通过并上架", exact: true }).click();
    const releaseKey = action === "approve" ? "__e2eRb1ReleaseApprove" : "__e2eRb1ReleaseReject";
    await page.waitForFunction((key) => typeof (globalThis as unknown as Record<string, unknown>)[key] === "function", releaseKey);
    await expect(drawer.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
    await page.evaluate((key) => (globalThis as unknown as Record<string, () => void>)[key](), releaseKey);
    if (action === "reject") {
      const reasonDialog = page.getByRole("dialog").filter({ has: page.getByRole("textbox", { name: "拒绝原因" }) });
      await expect(reasonDialog.getByText(/组织已切换/)).toBeVisible();
      await expect(reasonDialog.getByRole("textbox")).toHaveValue("Retain this reason after a Space switch.");
      await reasonDialog.getByRole("button", { name: "取消", exact: true }).click();
    }
    await expect(drawer.getByText(/组织已切换/)).toBeVisible();
    await expect(drawer.getByRole("button", { name: "通过并上架", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`drawer-${action}-silent-space.png`) });
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });
}

test("@RB1 @p1 @skills @market queue approval failure remains visible after reconciliation", async ({ authedPage: page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "skill-market-review-badge");
    sessionStorage.removeItem("__e2e_rb1_loaded");
    sessionStorage.setItem("__e2e_rb1_approve_error", "1");
  });
  await page.goto("/mcp-market/review?sid=e2etest");
  const approve = page.getByRole("button", { name: "通过「发布风险雷达」的上架申请" });
  await approve.click();
  await expect(page.locator(".skill-market-review-queue__error")).toContainText("This review was already decided.");
  await expect(approve).toBeEnabled();
  await expect(page.locator(".skill-market-review-queue__error")).toBeVisible();
});
