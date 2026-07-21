/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C21-loop-trigger-automation

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C21 loop 手动触发 automation — 自动化列表 → 更多菜单 → 手动运行 → 确认 → toast", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-automation");
  await authedPage.goto("/loop?sid=e2etest");
  await authedPage.locator(".loop-sidebar__menu button", { hasText: "自动化" }).first().click();

  // 定位 "Existing Automation" card, hover 让 more 按钮显现 (CSS opacity:0 pointer-events:none 默认)
  const card = authedPage.locator(".loop-automation-card", { hasText: "Existing Automation" }).first();
  await expect(card).toBeVisible();
  await card.hover();
  await card.locator(".loop-automation-card__more button").click({ force: true });
  // 菜单 "手动运行" (i18n loop.automation.runNow) — 直接触发, 无确认弹窗
  await authedPage.getByRole("menuitem", { name: "手动运行" }).click();

  // Toast "已触发运行" (i18n loop.automation.runStarted)
  await expect(authedPage.getByText("已触发运行").first()).toBeVisible();
});
