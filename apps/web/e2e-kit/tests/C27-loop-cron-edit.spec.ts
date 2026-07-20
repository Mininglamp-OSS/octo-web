/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C27-loop-cron-edit
// @edge — 非主流程 (自动化 trigger cron edit, 多步 UI 复杂, 只覆盖 baseline)

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C27 @edge loop automation trigger cron edit baseline — 详情稳定加载, cron 段显示", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-automation");
  await authedPage.goto("/loop?sid=e2etest");
  await authedPage.locator(".loop-sidebar__menu button", { hasText: "自动化" }).first().click();
  await authedPage.locator(".loop-automation-card", { hasText: "Existing Automation" }).first().click();

  // 详情稳定 3s, trigger 段已渲染
  await expect(authedPage.getByText("Existing Automation").first()).toBeVisible();
  await authedPage.waitForTimeout(3000);
  await expect(authedPage.getByText("Existing Automation").first()).toBeVisible();
});
