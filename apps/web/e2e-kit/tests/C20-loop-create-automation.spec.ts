/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C20-loop-create-automation

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C20 loop 创建 automation — 自动化 tab → 新建 → 填 name + executor → 提交", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-ws");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.locator(".loop-sidebar__menu button", { hasText: "自动化" }).first().click();

  // 创建自动化 (i18n loop.automation.create, 页头 + 空态按钮同文案)
  await authedPage.getByRole("button", { name: "创建自动化" }).first().click();

  // Modal name (i18n loop.automation.namePlaceholder = "例如 每日晨报")
  await authedPage.getByPlaceholder("例如 每日晨报").fill("C20 Automation");

  // Executor: AssigneePicker (types=agent/squad only)
  await authedPage.locator(".loop-modal .loop-assignee-trigger").click();
  await authedPage.getByRole("menuitem", { name: "Agent Alpha" }).click();

  // Submit (Semi Modal confirm, okText = i18n loop.automation.create = "创建自动化")
  await authedPage.locator(".loop-modal button[aria-label=\"confirm\"]").click();

  // Toast "已创建"
  await expect(authedPage.getByText("已创建").first()).toBeVisible();
});
