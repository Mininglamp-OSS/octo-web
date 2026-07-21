/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C7-loop-workspace-settings-update
// @spec apps/web/e2e-kit/case-specs/C7-loop-workspace-settings-update.md

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C7 loop workspace 设置更新 — 进 settings tab → 改 name → 保存 → toast 出现", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-ws");
  await authedPage.goto("/loop?sid=e2etest");

  // 前置: 有 workspace, sidebar 显示
  await expect(authedPage.locator(".loop-sidebar__ws-name")).toHaveText(
    "Workspace A"
  );

  // 点 sidebar 里的 "设置" tab (i18n loop.nav.settings)
  await authedPage.locator(".loop-sidebar__menu button", { hasText: "设置" }).click();

  // Settings General tab 出现 —— 找 name 输入框 (i18n loop.workspace.namePlaceholder)
  const nameInput = authedPage.getByPlaceholder("工作区名称").first();
  await expect(nameInput).toBeVisible();
  await expect(nameInput).toHaveValue("Workspace A");

  // 改 name
  await nameInput.fill("Workspace A Renamed");

  // 点保存按钮 (i18n loop.action.save = "保存")
  await authedPage.getByRole("button", { name: "保存" }).click();

  // 成功: toast "已保存" 出现 (i18n loop.toast.saved)
  await expect(authedPage.getByText("已保存").first()).toBeVisible();
});
