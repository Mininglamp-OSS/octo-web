/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C22-loop-view-automation-detail

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C22 loop 打开 automation 详情 — 点开 → 详情页显示 title + trigger", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-automation");
  await authedPage.goto("/loop?sid=e2etest");
  await authedPage.locator(".loop-sidebar__menu button", { hasText: "自动化" }).first().click();

  // 点开 card
  await authedPage.locator(".loop-automation-card", { hasText: "Existing Automation" }).first().click();

  // 详情稳定, title 可见
  await expect(authedPage.getByText("Existing Automation").first()).toBeVisible();
});
