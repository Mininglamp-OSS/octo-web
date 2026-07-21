/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C24-loop-remove-member
// @spec apps/web/e2e-kit/case-specs/C24-loop-remove-member.md

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C24 loop 移除 member — settings/成员 → 删除普通成员 → 行消失", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "member-remove");
  await authedPage.goto("/loop?sid=e2etest");

  // 进设置 → 切到成员管理 tab (i18n loop.settings.members = "成员管理")
  await authedPage.locator(".loop-sidebar__menu button", { hasText: "设置" }).click();
  await authedPage.getByRole("tab", { name: "成员管理" }).click();

  // 成员列表加载, 有两个 member: Admin User + Ordinary Member
  const ordRow = authedPage.locator("table tbody tr", { hasText: "Ordinary Member" });
  await expect(ordRow).toBeVisible();

  // 点该行的删除按钮 (last-child cell 里的 danger button, icon Trash2)
  await ordRow.locator("button.semi-button-danger").click();

  // 确认弹窗: (i18n loop.settings.removeMember = "移除成员") → 点确认 "删除"
  await expect(authedPage.getByText("移除成员").first()).toBeVisible();
  await authedPage.locator(".semi-modal button[aria-label=\"confirm\"]").click();

  // 成功: toast "已删除" + row 消失
  await expect(authedPage.getByText("已删除").first()).toBeVisible();
  await expect(ordRow).not.toBeVisible();
});
