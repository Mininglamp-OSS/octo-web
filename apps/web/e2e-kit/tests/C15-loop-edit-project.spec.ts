/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C15-loop-edit-project

import { test, expect } from "../fixtures-authed";
import { installMswScenario } from "../_lib/mswScenario";

test("@C15 loop 编辑 project 详情 — 项目 tab → 点开 → 改 title → 保存", async ({
  authedPage,
}) => {
  await installMswScenario(authedPage, "one-project");
  await authedPage.goto("/loop?sid=e2etest");

  await authedPage.locator(".loop-sidebar__menu button", { hasText: "项目" }).click();

  // 点开 "Project Alpha" — 点项目名字标签避免打到 emoji 按钮
  await authedPage.locator(".loop-project-list__name", { hasText: "Project Alpha" }).click();

  // 详情页 title input
  const titleInput = authedPage.getByPlaceholder("项目名称，例如 增长实验");
  await expect(titleInput).toBeVisible();
  await titleInput.fill("Project Alpha Renamed");

  // 保存 (i18n loop.action.save = "保存")
  await authedPage.getByRole("button", { name: "保存" }).click();

  // 成功: toast "已保存"
  await expect(authedPage.getByText("已保存").first()).toBeVisible();
});
