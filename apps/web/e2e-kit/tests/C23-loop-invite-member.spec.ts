/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C23-loop-invite-member
// @spec apps/web/e2e-kit/case-specs/C23-loop-invite-member.md
// 只覆盖 octo-uid 直加路径 (email invite 目前在 UI 上没入口, 只能测这一条)

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C23 loop 添加成员 — settings/成员 → 下拉选 space 用户 → 添加成员", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "ws-with-members");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.locator(".loop-sidebar__menu button", { hasText: "设置" }).click();
  await authedPage.getByRole("tab", { name: "成员管理" }).click();

  // 候选下拉打开 (i18n loop.settings.selectMember = "搜索并选择 space 成员")
  const memberSelect = authedPage
    .locator(".loop-settings-invite .semi-select")
    .first();
  await memberSelect.click();

  // 选 "Newbie User" (SPACE_HUMANS 里唯一不在 members 的候选)
  await authedPage.getByRole("option", { name: "Newbie User" }).click();

  // 点添加 (i18n loop.settings.addMember = "添加成员")
  await authedPage.getByRole("button", { name: "添加成员" }).click();

  // 成功: toast (i18n loop.settings.added = "成员已添加") + 新成员出现在表格
  await expect(authedPage.getByText("成员已添加").first()).toBeVisible();
  await expect(
    authedPage.locator("table tbody tr", { hasText: "Newbie User" })
  ).toBeVisible();
});
